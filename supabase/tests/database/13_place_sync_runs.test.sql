-- OSM-Importprotokoll (Roadmap O1): nur die Edge Function schreibt, nur Admins lesen die Fehlerquote.
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
select ok(not has_function_privilege('authenticated', 'public.record_place_sync_run(text, uuid, text, text, jsonb, integer)', 'execute'),
  'angemeldete Nutzer können keine Importe protokollieren');
select ok(not has_function_privilege('anon', 'public.admin_place_sync_health(integer)', 'execute'), 'anon kann die Fehlerquote nicht abfragen');
select ok(not has_table_privilege('authenticated', 'public.place_sync_runs', 'select'), 'Protokoll ist für Nutzer nicht direkt lesbar');
select ok(not has_table_privilege('authenticated', 'public.place_sync_runs', 'insert'), 'Protokoll ist für Nutzer nicht beschreibbar');

-- ---- Angriff von außen --------------------------------------------------------------------------
select tests.login('mallory');
select throws_ok($$ select public.record_place_sync_run('Leipzig', null, 'failed', 'osm_busy', '[]', 0) $$,
  '42501', null, 'Außenstehende können keine Fehlschläge vortäuschen');
select throws_ok($$ select public.admin_place_sync_health() $$, '42501', 'forbidden', 'Nicht-Admins sehen die Fehlerquote nicht');
select throws_ok($$ select * from public.place_sync_runs $$, '42501', null, 'direktes Lesen ist gesperrt');
select tests.logout();

select tests.login_anon();
select throws_ok($$ select public.record_place_sync_run('Leipzig', null, 'ready', null, '[]', 0) $$, '42501', null, 'anon kann nichts protokollieren');
select tests.logout();

-- ---- Schreiben (Edge Function) ------------------------------------------------------------------
select tests.login_service();
select tests.set_var('region', (public.begin_place_sync('Leipzig', 'Leipzig', 'relation', 62649, 51.34, 12.37, null) ->> 'id'));
select lives_ok(format($$ select public.record_place_sync_run('  LEIPZIG ', %L, 'ready', null,
  '[{"host":"overpass-api.de","result":"timeout","ms":60000},{"host":"Overpass.Private.Coffee","result":"ok","ms":4200}]', 64300) $$, tests.var('region')),
  'Import über den Ersatzserver wird protokolliert');
select lives_ok($$ select public.record_place_sync_run('Leipzig', null, 'ready', null, '[{"host":"overpass-api.de","result":"ok","ms":3000}]', 3500) $$,
  'Import über den Hauptserver');
select lives_ok($$ select public.record_place_sync_run('Halle', null, 'failed', 'osm_busy',
  '[{"host":"overpass-api.de","result":"busy","ms":10},{"host":"overpass.private.coffee","result":"timeout","ms":60000}]', 60100) $$,
  'fehlgeschlagener Import');
select lives_ok($$ select public.record_place_sync_run('<script>', '00000000-0000-0000-0000-000000000000', 'failed', 'DROP TABLE x;',
  '[{"host":"evil.example/../x","result":"pwned","ms":"viel"},"kein objekt",{},{},{},{}]', -50) $$,
  'unsaubere Eingaben werden bereinigt statt gespeichert');
select throws_ok($$ select public.record_place_sync_run('Leipzig', null, 'gelöscht', null, '[]', 0) $$, 'P0001', 'invalid_request', 'unbekanntes Ergebnis wird abgelehnt');
select tests.logout();

select is((select city || '|' || endpoint || '|' || fallback_used::text || '|' || (region_id = tests.var('region')::uuid)::text
           from public.place_sync_runs where duration_ms = 64300),
  'leipzig|overpass.private.coffee|true|true', 'Stadt normalisiert, Ersatzserver erkannt, Region verknüpft');
select is((select fallback_used from public.place_sync_runs where duration_ms = 3500), false, 'Hauptserver: kein Ersatz');
select is((select error from public.place_sync_runs where duration_ms = 60100), 'osm_busy', 'Fehlercode gespeichert');
select is((select coalesce(city, '-') || '|' || error || '|' || coalesce(region_id::text, '-') || '|' || duration_ms
           || '|' || jsonb_array_length(attempts) || '|' || (attempts -> 0 ->> 'host') || '|' || (attempts -> 0 ->> 'result') || '|' || (attempts -> 0 ->> 'ms')
           from public.place_sync_runs where outcome = 'failed' and error <> 'osm_busy'),
  '-|unknown|-|0|4|unknown|unavailable|0', 'ungültige Stadt, Fehlertext, Region, Server, Ergebnis und Dauer werden neutralisiert, höchstens 4 Versuche');

-- Alte Einträge verfallen nach 90 Tagen.
update public.place_sync_runs set created_at = now() - interval '91 days' where duration_ms = 3500;
select tests.login_service();
select public.record_place_sync_run('Leipzig', null, 'ready', null, '[{"host":"overpass-api.de","result":"ok","ms":100}]', 100);
select tests.logout();
select is((select count(*)::int from public.place_sync_runs where duration_ms = 3500), 0, 'Einträge älter als 90 Tage werden gelöscht');

-- ---- Lesen (Admin) ------------------------------------------------------------------------------
select tests.login('alice');
select tests.set_var('health', public.admin_place_sync_health()::text);
select is((tests.var('health')::jsonb ->> 'runs')::int, 4, 'Admin: Zahl der Importe (7 Tage)');
select is((tests.var('health')::jsonb ->> 'failed')::int, 2, 'Admin: davon fehlgeschlagen');
select is((tests.var('health')::jsonb ->> 'failure_rate')::numeric, 50.0, 'Admin: Fehlerquote in Prozent');
select is((tests.var('health')::jsonb ->> 'over_threshold')::boolean, true, 'Admin: Schwelle von 2 % überschritten');
select is((tests.var('health')::jsonb ->> 'fallback_runs')::int, 1, 'Admin: Importe über den Ersatzserver');
select is(tests.var('health')::jsonb -> 'errors', '{"osm_busy": 1, "unknown": 1}'::jsonb, 'Admin: Fehler nach Art');
select is((select e ->> 'ok' from jsonb_array_elements(tests.var('health')::jsonb -> 'endpoints') e where e ->> 'host' = 'overpass-api.de'), '1',
  'Admin: erfolgreiche Versuche je Server');
select is(public.admin_place_sync_health(500) ->> 'days', '90', 'Zeitraum ist auf 90 Tage begrenzt');
select tests.logout();

delete from public.place_sync_runs;
select tests.login('alice');
select is(public.admin_place_sync_health() ->> 'failure_rate', null, 'ohne Importe keine Quote (statt 0 %)');
select is((public.admin_place_sync_health() ->> 'over_threshold')::boolean, false, 'ohne Importe kein Alarm');
select tests.logout();

select * from finish();
rollback;
