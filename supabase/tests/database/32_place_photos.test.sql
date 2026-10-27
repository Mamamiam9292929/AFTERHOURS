-- P7 Etappe 1: Foto-Verweise (Wikimedia Commons, Wikidata) beim Import aus OpenStreetMap.
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
select ok(not has_function_privilege('anon', 'public.ingest_place_batch(uuid, timestamptz, jsonb)', 'execute'),
  'anon kann keine Orte (und damit keine Foto-Verweise) schreiben');
select ok(not has_function_privilege('authenticated', 'public.ingest_place_batch(uuid, timestamptz, jsonb)', 'execute'),
  'angemeldete Nutzer können keine Foto-Verweise schreiben');
select ok(has_function_privilege('service_role', 'public.ingest_place_batch(uuid, timestamptz, jsonb)', 'execute'),
  'die Edge Function (service_role) darf weiter Orte schreiben');

-- ---- Import ------------------------------------------------------------------------------------
select tests.login_service();
select tests.set_var('begin', public.begin_place_sync('leipzig', 'Leipzig', 'relation', 62649, 51.34, 12.37, tests.uid('alice'))::text);
select tests.set_var('region', tests.var('begin')::jsonb ->> 'id');
select tests.set_var('started', tests.var('begin')::jsonb ->> 'started_at');

select is(public.ingest_place_batch(tests.var('region')::uuid, tests.var('started')::timestamptz, $json$[
  {"external_id":"node/1","name":"Moritzbastei","category":"bar","latitude":51.34,"longitude":12.38,
   "source_url":"https://www.openstreetmap.org/node/1","commons_file":"File:Moritzbastei Leipzig.jpg","wikidata_id":"Q1952536"},
  {"external_id":"node/2","name":"Nur Wikidata","category":"cinema","latitude":51.34,"longitude":12.38,"wikidata_id":"Q42"},
  {"external_id":"node/3","name":"Pfad im Namen","category":"bar","latitude":51.34,"longitude":12.38,"commons_file":"File:../../etc/passwd.jpg"},
  {"external_id":"node/4","name":"Fremde Adresse","category":"bar","latitude":51.34,"longitude":12.38,"commons_file":"https://evil.example/x.jpg","wikidata_id":"Q0"},
  {"external_id":"node/5","name":"Vektorgrafik","category":"bar","latitude":51.34,"longitude":12.38,"commons_file":"File:Logo.svg","wikidata_id":"P18"},
  {"external_id":"node/6","name":"HTML im Namen","category":"bar","latitude":51.34,"longitude":12.38,"commons_file":"File:<img src=x>.jpg"},
  {"external_id":"node/7","name":"Ohne Verweis","category":"cafe","latitude":51.34,"longitude":12.38}
]$json$::jsonb), 7, 'alle Orte werden geschrieben – ungültige Verweise kosten nicht den Ort');

select is((select commons_file || '|' || wikidata_id from public.activities where external_id = 'node/1'),
  'File:Moritzbastei Leipzig.jpg|Q1952536', 'gültige Commons-Datei und Wikidata-Kennung werden übernommen');
select is((select coalesce(commons_file, '-') || '|' || wikidata_id from public.activities where external_id = 'node/2'),
  '-|Q42', 'Wikidata allein reicht');
select is((select count(*)::int from public.activities where external_id in ('node/3', 'node/4', 'node/5', 'node/6') and commons_file is null),
  4, 'Pfade, fremde Adressen, Vektorgrafiken und HTML werden als Datei verworfen');
select is((select count(*)::int from public.activities where external_id in ('node/4', 'node/5') and wikidata_id is null),
  2, 'ungültige Wikidata-Kennungen werden verworfen');
select is((select coalesce(commons_file, '-') || '|' || coalesce(wikidata_id, '-') from public.activities where external_id = 'node/7'),
  '-|-', 'ohne Verweis bleibt alles leer');
select public.complete_place_sync(tests.var('region')::uuid, tests.var('started')::timestamptz);
select tests.logout();
update public.place_regions set synced_at = now() - interval '31 days' where id = tests.var('region')::uuid;
select tests.login_service();

-- Erneuter Import: Fällt der Verweis in OSM weg, verschwindet er auch hier.
select tests.set_var('begin2', public.begin_place_sync('leipzig', 'Leipzig', 'relation', 62649, 51.34, 12.37, null)::text);
select is(tests.var('begin2')::jsonb ->> 'action', 'sync', 'zweiter Import beginnt');
select is(public.ingest_place_batch(tests.var('region')::uuid, (tests.var('begin2')::jsonb ->> 'started_at')::timestamptz, $json$[
  {"external_id":"node/1","name":"Moritzbastei","category":"bar","latitude":51.34,"longitude":12.38}
]$json$::jsonb), 1, 'Ort wird aktualisiert');
select is((select coalesce(commons_file, '-') || '|' || coalesce(wikidata_id, '-') from public.activities where external_id = 'node/1'),
  '-|-', 'entfernter Verweis wird beim nächsten Import entfernt');
select tests.logout();

-- ---- Direkte Schreibversuche --------------------------------------------------------------------
select tests.login('mallory');
select throws_ok(
  format($$ select public.ingest_place_batch(%L, now(), '[]'::jsonb) $$, tests.var('region')),
  '42501', null, 'Außenstehende können über den Import keine Verweise setzen');
update public.activities set commons_file = 'File:Fake.jpg' where external_id = 'node/2';
select tests.logout();
select is((select coalesce(commons_file, '-') from public.activities where external_id = 'node/2'), '-',
  'Nutzer ohne Adminrolle können Foto-Verweise nicht ändern (RLS)');

-- Die Prüfung gilt auch für Admins und direkte Einträge.
select throws_ok(
  $$ update public.activities set commons_file = 'File:../x.jpg' where external_id = 'node/2' $$,
  '23514', null, 'Spalte lässt nur gültige Commons-Dateien zu');
select throws_ok(
  $$ update public.activities set wikidata_id = 'Q01' where external_id = 'node/2' $$,
  '23514', null, 'Spalte lässt nur gültige Wikidata-Kennungen zu');

-- Angemeldete sehen die Verweise wie alle anderen Angaben eines Ortes; anon sieht keine Orte.
select tests.login('alice');
select is((select wikidata_id from public.activities where external_id = 'node/2'), 'Q42', 'angemeldete Nutzer lesen den Verweis');
select tests.logout();
select tests.login_anon();
select throws_ok($$ select wikidata_id from public.activities $$, '42501', null, 'anon liest keine Orte und keine Verweise');
select tests.logout();

select * from finish();
rollback;
