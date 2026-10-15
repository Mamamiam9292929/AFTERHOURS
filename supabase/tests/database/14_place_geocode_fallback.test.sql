-- Stadtsuche mit Ersatz (Roadmap O2): gespeicherte Region nur für die Edge Function, Protokoll
-- trennt Stadtsuche und Overpass, Admins sehen beides.
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
insert into public.app_admins (user_id) values (tests.uid('alice'));

-- ---- Rechte -----------------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'public.known_place_region(text)', 'execute'),
  'angemeldete Nutzer können gespeicherte OSM-Kennungen nicht abfragen');
select ok(not has_function_privilege('anon', 'public.known_place_region(text)', 'execute'), 'anon auch nicht');
select ok(not has_function_privilege('authenticated', 'public.record_place_sync_run(text, uuid, text, text, jsonb, integer, jsonb, text)', 'execute'),
  'angemeldete Nutzer können keine Stadtsuche protokollieren');
select ok(not has_function_privilege('authenticated', 'app_private.clean_sync_attempts(jsonb, integer)', 'execute'), 'Hilfsfunktion ist intern');

-- ---- Angriff von außen --------------------------------------------------------------------------
select tests.login('mallory');
select throws_ok($$ select public.known_place_region('Leipzig') $$, '42501', null, 'Außenstehende lesen keine OSM-Kennungen');
select throws_ok($$ select public.record_place_sync_run('Leipzig', null, 'failed', 'osm_busy', '[]', 0, '[]', 'geocode') $$,
  '42501', null, 'Außenstehende können keine Ausfälle der Stadtsuche vortäuschen');
select tests.logout();
select tests.login_anon();
select throws_ok($$ select public.known_place_region('Leipzig') $$, '42501', null, 'anon liest keine OSM-Kennungen');
select tests.logout();

-- ---- Gespeicherte Region (Edge Function) --------------------------------------------------------
select tests.login_service();
select is(public.known_place_region('Leipzig'), null, 'unbekannte Stadt: nichts gespeichert');
select public.begin_place_sync('frankfurt', 'Frankfurt am Main', 'relation', 62400, 50.11, 8.68, null);
select is(public.known_place_region('  FRANKFURT ') ->> 'osm_id', '62400', 'früherer Suchbegriff findet die gespeicherte Kennung');
select is(public.known_place_region('Frankfurt am Main') - 'latitude' - 'longitude',
  '{"name": "Frankfurt am Main", "osm_type": "relation", "osm_id": 62400}'::jsonb, 'Name, Art und Kennung');
select throws_ok($$ select public.known_place_region('<script>') $$, 'P0001', 'invalid_city', 'ungültiger Stadtname wird abgelehnt');

-- ---- Protokoll ----------------------------------------------------------------------------------
select lives_ok($$ select public.record_place_sync_run('Leipzig', null, 'ready', null,
  '[{"host":"overpass-api.de","result":"ok","ms":3000}]', 4000,
  '[{"host":"nominatim.openstreetmap.org","result":"busy","ms":20},{"host":"photon.komoot.io","result":"ok","ms":300}]', null) $$,
  'Import mit Ersatz-Stadtsuche');
select lives_ok($$ select public.record_place_sync_run('Leipzig', null, 'ready', null,
  '[{"host":"overpass-api.de","result":"ok","ms":3000}]', 3100,
  '[{"host":"nominatim.openstreetmap.org","result":"ok","ms":200}]', null) $$,
  'Import über Nominatim');
select lives_ok($$ select public.record_place_sync_run('Halle', null, 'failed', 'osm_unavailable', '[]', 15100,
  '[{"host":"nominatim.openstreetmap.org","result":"unavailable","ms":15000},{"host":"photon.komoot.io","result":"timeout","ms":100}]', 'geocode') $$,
  'Stadtsuche gescheitert');
select lives_ok($$ select public.record_place_sync_run('Köln', null, 'failed', 'osm_busy',
  '[{"host":"overpass-api.de","result":"busy","ms":10}]', 9000,
  '[{"host":"nominatim.openstreetmap.org","result":"timeout","ms":15000},{"host":"db","result":"ok","ms":3}]', 'overpass') $$,
  'Overpass gescheitert, Stadt aus der gespeicherten Region');
select lives_ok($$ select public.record_place_sync_run('Jena', null, 'failed', 'osm_busy', '[]', 7,
  '[{"host":"<b>","result":"pwned"},{},{},{},{}]', 'überall') $$,
  'unsaubere Angaben werden bereinigt');
select tests.logout();

select is((select geocoder || '|' || geocode_fallback::text || '|' || coalesce(stage, '-') from public.place_sync_runs where duration_ms = 4000),
  'photon.komoot.io|true|-', 'Ersatz-Stadtsuche erkannt');
select is((select geocoder || '|' || geocode_fallback::text from public.place_sync_runs where duration_ms = 3100),
  'nominatim.openstreetmap.org|false', 'Nominatim: kein Ersatz');
select is((select coalesce(geocoder, '-') || '|' || stage || '|' || jsonb_array_length(geocode_attempts) from public.place_sync_runs where duration_ms = 15100),
  '-|geocode|2', 'gescheiterte Stadtsuche: Schritt und Versuche, kein Lieferant');
select is((select geocoder || '|' || geocode_fallback::text || '|' || stage from public.place_sync_runs where duration_ms = 9000),
  'db|true|overpass', 'Overpass-Ausfall nach Stadt aus der Datenbank');
select is((select coalesce(stage, '-') || '|' || jsonb_array_length(geocode_attempts) || '|' || (geocode_attempts -> 0 ->> 'host')
           || '|' || (geocode_attempts -> 0 ->> 'result') || '|' || coalesce(geocoder, '-') from public.place_sync_runs where duration_ms = 7),
  '-|3|unknown|unavailable|-', 'unbekannter Schritt, Host und Ergebnis werden neutralisiert, höchstens 3 Versuche');

-- Die bisherige Funktion mit 6 Angaben schreibt weiter (ältere Edge Function bis zum Deploy).
select tests.login_service();
select lives_ok($$ select public.record_place_sync_run('Leipzig', null, 'ready', null, '[{"host":"overpass-api.de","result":"ok","ms":1}]', 1) $$,
  'alte Signatur funktioniert weiter');
select tests.logout();
select is((select coalesce(stage, '-') || '|' || jsonb_array_length(geocode_attempts) || '|' || coalesce(geocoder, '-') from public.place_sync_runs where duration_ms = 1),
  '-|0|-', 'alte Einträge ohne Stadtsuche');

-- ---- Lesen (Admin) ------------------------------------------------------------------------------
select tests.login('alice');
select tests.set_var('health', public.admin_place_sync_health()::text);
select is((tests.var('health')::jsonb ->> 'runs')::int, 6, 'Admin: alle Importe');
select is(tests.var('health')::jsonb -> 'stages', '{"geocode": 1, "overpass": 1}'::jsonb, 'Admin: Fehlschläge nach Schritt');
select is((tests.var('health')::jsonb ->> 'geocode_fallback_runs')::int, 2, 'Admin: Stadt über Ersatz gefunden');
select is((select e ->> 'ok' || '/' || (e ->> 'attempts') from jsonb_array_elements(tests.var('health')::jsonb -> 'geocoders') e where e ->> 'host' = 'nominatim.openstreetmap.org'),
  '1/4', 'Admin: erfolgreiche Versuche je Stadtsuche-Server');
select is((select count(*)::int from jsonb_array_elements(tests.var('health')::jsonb -> 'endpoints') e where e ->> 'host' = 'photon.komoot.io'), 0,
  'Overpass-Server und Stadtsuche bleiben getrennt');
select tests.logout();

select tests.login('mallory');
select throws_ok($$ select public.admin_place_sync_health() $$, '42501', 'forbidden', 'Nicht-Admins sehen die Aufschlüsselung nicht');
select tests.logout();

select * from finish();
rollback;
