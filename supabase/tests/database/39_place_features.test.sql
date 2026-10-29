-- P11 Etappe 2f: Merkmale von Orten (activities.features) beim Import aus OpenStreetMap.
begin;
\ir helpers.inc
select no_plan();

grant usage on schema tests to service_role;
grant select, insert, update on tests.vars to service_role;
grant select on tests.users to service_role;

create function tests.login_service() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('role', 'service_role', true);
end $$;

select tests.make_user('Alice');
select tests.make_user('Mallory');

-- ---- Rechte -----------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'app_private.clean_place_features(jsonb)', 'execute'), 'anon kann die Bereinigung nicht aufrufen');
select ok(not has_function_privilege('authenticated', 'app_private.clean_place_features(jsonb)', 'execute'), 'angemeldete Nutzer können die Bereinigung nicht aufrufen');
select ok(not has_function_privilege('authenticated', 'public.ingest_place_batch(uuid, timestamptz, jsonb)', 'execute'), 'angemeldete Nutzer können keine Merkmale importieren');

-- ---- Import ------------------------------------------------------------------------------------
select tests.login_service();
select tests.set_var('begin', public.begin_place_sync('leipzig', 'Leipzig', 'relation', 62649, 51.34, 12.37, tests.uid('alice'))::text);
select tests.set_var('region', tests.var('begin')::jsonb ->> 'id');
select tests.set_var('started', tests.var('begin')::jsonb ->> 'started_at');

select is(public.ingest_place_batch(tests.var('region')::uuid, tests.var('started')::timestamptz, $json$[
  {"external_id":"node/1","name":"Pizzeria am Markt","category":"restaurant","latitude":51.34,"longitude":12.38,
   "description":"Küche: Italienisch, Pizza. Außenplätze.",
   "features":{"cuisine":["italian","pizza"],"outdoor_seating":true,"about_en":"Cosy pizzeria"}},
  {"external_id":"node/2","name":"Unsauber","category":"bar","latitude":51.34,"longitude":12.38,
   "features":{"cuisine":["italian","Italian","<script>","italian",7],"sport":"climbing","vegan":"maybe","outdoor_seating":"yes",
               "wheelchair":"limited","about_de":"  Zwei   Räume  ","about_en":["x"],"evil":"x"}},
  {"external_id":"node/3","name":"Nur Müll","category":"bar","latitude":51.34,"longitude":12.38,"features":{"vegan":"no","evil":true}},
  {"external_id":"node/4","name":"Kein Objekt","category":"cafe","latitude":51.34,"longitude":12.38,"features":["italian"]},
  {"external_id":"node/5","name":"Ohne Merkmale","category":"cafe","latitude":51.34,"longitude":12.38}
]$json$::jsonb), 5, 'alle Orte werden geschrieben – unbrauchbare Merkmale kosten nicht den Ort');

select is((select features from public.activities where external_id = 'node/1'),
  '{"cuisine":["italian","pizza"],"outdoor_seating":true,"about_en":"Cosy pizzeria"}'::jsonb, 'gültige Merkmale werden übernommen');
select is((select description from public.activities where external_id = 'node/1'),
  'Küche: Italienisch, Pizza. Außenplätze.', 'der deutsche Satz bleibt daneben gespeichert');
select is((select features from public.activities where external_id = 'node/2'),
  '{"cuisine":["italian"],"wheelchair":"limited","about_de":"Zwei Räume"}'::jsonb,
  'nur bekannte Felder in fester Form: Schlüssel klein, ohne Dubletten, Text bereinigt, Unbekanntes verworfen');
select is((select count(*)::int from public.activities where external_id in ('node/3', 'node/4', 'node/5') and features is null),
  3, 'ohne brauchbare Merkmale bleibt das Feld leer');
select public.complete_place_sync(tests.var('region')::uuid, tests.var('started')::timestamptz);
select tests.logout();
update public.place_regions set synced_at = now() - interval '31 days' where id = tests.var('region')::uuid;
select tests.login_service();

-- Erneuter Import: Merkmale werden ersetzt, weggefallene entfernt.
select tests.set_var('begin2', public.begin_place_sync('leipzig', 'Leipzig', 'relation', 62649, 51.34, 12.37, null)::text);
select is(public.ingest_place_batch(tests.var('region')::uuid, (tests.var('begin2')::jsonb ->> 'started_at')::timestamptz, $json$[
  {"external_id":"node/1","name":"Pizzeria am Markt","category":"restaurant","latitude":51.34,"longitude":12.38,"features":{"vegan":"yes"}},
  {"external_id":"node/2","name":"Unsauber","category":"bar","latitude":51.34,"longitude":12.38}
]$json$::jsonb), 2, 'Orte werden aktualisiert');
select is((select features from public.activities where external_id = 'node/1'), '{"vegan":"yes"}'::jsonb, 'Merkmale werden beim nächsten Import ersetzt');
select is((select features from public.activities where external_id = 'node/2'), null, 'entfernte Merkmale werden beim nächsten Import entfernt');
select tests.logout();

-- ---- Direkte Schreibversuche --------------------------------------------------------------------
select tests.login('mallory');
select throws_ok(
  format($$ select public.ingest_place_batch(%L, now(), '[]'::jsonb) $$, tests.var('region')),
  '42501', null, 'Außenstehende können über den Import keine Merkmale setzen');
update public.activities set features = '{"about_en":"Free beer"}' where external_id = 'node/1';
select tests.logout();
select is((select features from public.activities where external_id = 'node/1'), '{"vegan":"yes"}'::jsonb,
  'Nutzer ohne Adminrolle können Merkmale nicht ändern (RLS)');

-- Die Spalte nimmt nur Objekte begrenzter Größe an – auch von Admins und direkten Einträgen.
select throws_ok($$ update public.activities set features = '["x"]' where external_id = 'node/1' $$,
  '23514', null, 'Merkmale müssen ein Objekt sein');
select throws_ok(format($$ update public.activities set features = %L where external_id = 'node/1' $$,
  jsonb_build_object('about_en', repeat('x', 5000))),
  '23514', null, 'Merkmale sind in der Größe begrenzt');

-- Angemeldete lesen die Merkmale wie alle anderen Angaben eines Ortes; anon sieht keine Orte.
select tests.login('alice');
select is((select features ->> 'vegan' from public.activities where external_id = 'node/1'), 'yes', 'angemeldete Nutzer lesen die Merkmale');
select tests.logout();
select tests.login_anon();
select throws_ok($$ select features from public.activities $$, '42501', null, 'anon liest keine Orte und keine Merkmale');
select tests.logout();

select * from finish();
rollback;
