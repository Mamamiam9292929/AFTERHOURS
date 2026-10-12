-- Echte Orte aus OpenStreetMap: Regionen, Import-Sperre, Kontingent, Suche, Rechte.
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
select tests.make_user('Bob');

-- ---- Rechte -----------------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'public.begin_place_sync(text, text, text, bigint, double precision, double precision, uuid)', 'execute'),
  'angemeldete Nutzer können keinen Import beginnen');
select ok(not has_function_privilege('authenticated', 'public.ingest_place_batch(uuid, timestamptz, jsonb)', 'execute'),
  'angemeldete Nutzer können keine Orte schreiben');
select ok(not has_function_privilege('authenticated', 'public.complete_place_sync(uuid, timestamptz)', 'execute'),
  'angemeldete Nutzer können keinen Import abschließen');
select ok(not has_function_privilege('authenticated', 'public.fail_place_sync(uuid, timestamptz, text)', 'execute'),
  'angemeldete Nutzer können keinen Import als fehlgeschlagen markieren');
select ok(has_function_privilege('service_role', 'public.ingest_place_batch(uuid, timestamptz, jsonb)', 'execute'),
  'die Edge Function (service_role) darf Orte schreiben');
select ok(not has_column_privilege('authenticated', 'public.place_regions', 'requested_by', 'select'),
  'wer einen Import angestoßen hat, ist nicht sichtbar');
select ok(not has_table_privilege('authenticated', 'public.place_regions', 'insert'), 'Regionen sind für Nutzer schreibgeschützt');

select tests.login_anon();
select throws_ok($$ select public.place_region_status('Leipzig') $$, '42501', null, 'anon kann den Stand einer Stadt nicht abfragen');
select throws_ok($$ select public.search_activities('Leipzig') $$, '42501', null, 'anon kann keine Orte suchen');
select tests.logout();

-- ---- Eingaben ---------------------------------------------------------------------------------
select tests.login('alice');
select throws_ok($$ select public.place_region_status('x') $$, 'P0001', 'invalid_city', 'zu kurzer Stadtname wird abgelehnt');
select throws_ok($$ select public.request_place_sync('<script>') $$, 'P0001', 'invalid_city', 'Sonderzeichen im Stadtnamen werden abgelehnt');
select is(public.place_region_status('Leipzig') ->> 'status', 'none', 'unbekannte Stadt: Status none');
select is(public.request_place_sync('  Leipzig ') ->> 'action', 'sync', 'erster Abruf: Import nötig');
select tests.logout();
select is((select count(*)::int from public.rate_limit_hits where action = 'place_sync' and user_id = tests.uid('alice')), 1, 'Import-Anfrage wird gezählt');

-- ---- Import (service_role) --------------------------------------------------------------------
select tests.login_service();
select tests.set_var('begin', public.begin_place_sync('leipzig', 'Leipzig', 'relation', 62649, 51.34, 12.37, tests.uid('alice'))::text);
select is(tests.var('begin')::jsonb ->> 'action', 'sync', 'Import beginnt');
select tests.set_var('region', tests.var('begin')::jsonb ->> 'id');
select tests.set_var('started', tests.var('begin')::jsonb ->> 'started_at');

select is(public.begin_place_sync('Leipzig', 'Leipzig', 'relation', 62649, 51.34, 12.37, null) ->> 'action', 'busy',
  'zweiter Import derselben Stadt während eines laufenden: busy');

select throws_ok(
  format($$ select public.ingest_place_batch(%L, now(), '[]'::jsonb) $$, tests.var('region')),
  'P0001', 'sync_token_invalid', 'Import ohne gültiges Sperr-Token wird abgelehnt');

select is(public.ingest_place_batch(tests.var('region')::uuid, tests.var('started')::timestamptz, $json$[
  {"external_id":"node/1","name":"Kaffeehaus Riquet","category":"cafe","address":"Schuhmachergäßchen 1, 04109 Leipzig",
   "latitude":51.34,"longitude":12.377,"opening_hours":{"mon":[["09:00","19:00"]]},"opening_hours_raw":"Mo 09:00-19:00",
   "website_url":"https://example.org","phone":"+49 341 0000","setting":null,"source_url":"https://www.openstreetmap.org/node/1","quality":6},
  {"external_id":"way/2","name":"Bowlingtreff","category":"bowling","latitude":51.33,"longitude":12.38,
   "website_url":"http://unsicher.example","setting":"indoor","source_url":"https://evil.example/x","quality":2},
  {"external_id":"node/3","name":"Ungültige Kategorie","category":"casino","latitude":51.3,"longitude":12.3},
  {"external_id":"../etc","name":"Ungültige ID","category":"bar","latitude":51.3,"longitude":12.3},
  {"external_id":"node/4","name":"X","category":"bar","latitude":51.3,"longitude":12.3},
  {"external_id":"node/5","name":"Alte Bar","category":"bar","latitude":51.31,"longitude":12.31,"quality":1}
]$json$::jsonb), 3, 'gültige Orte werden geschrieben, ungültige übersprungen');

select is((select website_url from public.activities where external_id = 'way/2'), null, 'Website ohne https wird nicht übernommen');
select is((select source_url from public.activities where external_id = 'way/2'), null, 'Quell-Link muss auf openstreetmap.org zeigen');
select is((select data_source::text || '/' || provider_id || '/' || city from public.activities where external_id = 'node/1'),
  'provider/osm/Leipzig', 'importierte Orte: Quelle provider/osm, Stadt = Regionsname');

select is(public.complete_place_sync(tests.var('region')::uuid, tests.var('started')::timestamptz) ->> 'place_count', '3', 'Abschluss zählt die aktiven Orte');
select is((select status from public.place_regions where id = tests.var('region')::uuid), 'ready', 'Region ist danach bereit');
select throws_ok(
  format($$ select public.complete_place_sync(%L, %L) $$, tests.var('region'), tests.var('started')),
  'P0001', 'sync_token_invalid', 'ein abgeschlossener Import kann nicht erneut abgeschlossen werden');
select tests.logout();

-- ---- Abruf durch Nutzer -----------------------------------------------------------------------
select tests.login('bob');
select is(public.place_region_status('LEIPZIG') ->> 'status', 'ready', 'Status ist unabhängig von Groß-/Kleinschreibung');
select is(public.request_place_sync('leipzig') ->> 'action', 'ready', 'frische Daten: kein neuer Import');

select is((public.search_activities('Leipzig') ->> 'total')::int, 3, 'Suche liefert alle aktiven Orte der Stadt');
select is(public.search_activities('Leipzig') -> 'items' -> 0 ->> 'name', 'Kaffeehaus Riquet', 'vollständigere Orte stehen oben');
select is((public.search_activities('leipzig', 'bar') ->> 'total')::int, 1, 'Filter nach Kategorie');
select is((public.search_activities('Leipzig', null, 'riquet') ->> 'total')::int, 1, 'Suche im Namen');
select is((public.search_activities('Leipzig', null, 'gäßchen') ->> 'total')::int, 1, 'Suche in der Adresse');
select is((public.search_activities('Leipzig', null, '%') ->> 'total')::int, 0, 'Platzhalterzeichen werden wörtlich gesucht');
select is((public.search_activities('Leipzig') -> 'categories' ->> 'cafe')::int, 1, 'Anzahl je Kategorie');
select is((public.search_activities('Leipzig', null, null, 1) -> 'items')::jsonb ->> 1, null, 'Limit wird eingehalten');
select tests.logout();
select is((select count(*)::int from public.rate_limit_hits where action = 'place_sync' and user_id = tests.uid('bob')), 0, 'ohne Import wird kein Kontingent verbraucht');


-- Demo-Orte verschwinden in Städten mit echten Daten.
insert into public.activities (name, category, city, data_source) values ('Demo-Kino', 'cinema', 'Leipzig', 'demo'), ('Demo-Café', 'cafe', 'Demotown', 'demo');
select tests.login('bob');
select is((public.search_activities('Leipzig', 'cinema') ->> 'total')::int, 0, 'Demo-Ort wird neben echten Orten ausgeblendet');
select is((public.search_activities('Demotown') ->> 'total')::int, 1, 'ohne echte Orte bleiben Demo-Orte sichtbar');
select tests.logout();

-- ---- Aktualisierung und Alias ------------------------------------------------------------------
update public.place_regions set synced_at = now() - interval '31 days' where id = tests.var('region')::uuid;
select tests.login('bob');
select is(public.place_region_status('Leipzig') ->> 'stale', 'true', 'nach 30 Tagen gelten Daten als veraltet');
select is(public.request_place_sync('Leipzig') ->> 'action', 'sync', 'veraltete Daten: neuer Import');
select tests.logout();

select tests.login_service();
select tests.set_var('begin2', public.begin_place_sync('Leipzig Stadt', 'Leipzig', 'relation', 62649, 51.34, 12.37, tests.uid('bob'))::text);
select is(tests.var('begin2')::jsonb ->> 'action', 'sync', 'Aktualisierung beginnt');
select is(public.ingest_place_batch(tests.var('region')::uuid, (tests.var('begin2')::jsonb ->> 'started_at')::timestamptz, $json$[
  {"external_id":"node/1","name":"Kaffeehaus Riquet","category":"cafe","latitude":51.34,"longitude":12.377,"quality":3}
]$json$::jsonb), 1, 'erneuter Import aktualisiert vorhandene Orte');
select is(public.complete_place_sync(tests.var('region')::uuid, (tests.var('begin2')::jsonb ->> 'started_at')::timestamptz) ->> 'place_count', '1',
  'nicht mehr gelieferte Orte zählen nicht mehr');
select tests.logout();

select is((select count(*)::int from public.activities where provider_id = 'osm' and external_id in ('way/2', 'node/5') and not is_active), 2,
  'verschwundene Orte werden deaktiviert, nicht gelöscht');
select is((select count(*)::int from public.activities where external_id = 'node/1'), 1, 'kein Duplikat beim erneuten Import');

select tests.login('alice');
select is(public.place_region_status('leipzig stadt') ->> 'name', 'Leipzig', 'die Schreibweise der Suche wird als Alias gemerkt');
select tests.logout();

-- ---- Fehler und Kontingent --------------------------------------------------------------------
select tests.login_service();
select tests.set_var('begin3', public.begin_place_sync('Halle', 'Halle (Saale)', 'relation', 62638, 51.48, 11.97, tests.uid('alice'))::text);
select lives_ok(format($$ select public.fail_place_sync(%L, %L, 'overpass_timeout') $$,
  tests.var('begin3')::jsonb ->> 'id', tests.var('begin3')::jsonb ->> 'started_at'), 'fehlgeschlagener Import wird vermerkt');
select tests.logout();
select is((select status || ':' || last_error from public.place_regions where name = 'Halle (Saale)'), 'failed:overpass_timeout', 'Status failed mit Fehlercode');

select tests.login('alice');
select is(public.place_region_status('halle') ->> 'status', 'failed', 'Alias führt auch zu fehlgeschlagenen Regionen');
select lives_ok($$ select public.request_place_sync('Ort' || g) from generate_series(1, 9) g $$, 'bis zu zehn Importe pro Stunde');
select throws_ok($$ select public.request_place_sync('Noch eine Stadt') $$, 'P0001', 'rate_limited', 'der elfte Import in einer Stunde wird abgelehnt');
select tests.logout();

select * from finish();
rollback;
