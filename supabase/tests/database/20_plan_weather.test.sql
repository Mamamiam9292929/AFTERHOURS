-- P5: Wetter zum Plan – nur Mitglieder fragen ab, nur die Edge Function speichert, Ort gerundet,
-- ohne Ort / zu weit weg / vorbei gibt es keine (erfundene) Vorhersage.
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
select tests.make_user('Mallory');

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew', '🎳')::text);
select tests.set_var('invite', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Bob tritt bei');

-- Orte und Pläne direkt anlegen (am RLS vorbei). Beginn 20:00 Berliner Zeit in 3 Tagen.
select tests.logout();
insert into public.activities (provider_id, external_id, name, category, city, latitude, longitude, setting, data_source) values
  ('manual', 'wetter-biergarten', 'Biergarten am See', 'outdoor', 'Leipzig', 51.340632, 12.374733, 'outdoor', 'manual'),
  ('manual', 'wetter-ohne-ort', 'Ort ohne Koordinaten', 'bar', 'Leipzig', null, null, null, 'manual');
select tests.set_var('start', (((now() at time zone 'Europe/Berlin')::date + 3 + time '20:00') at time zone 'Europe/Berlin')::text);
insert into public.plans (crew_id, created_by, title, starts_at, activity_id, status) values
  (tests.var('crew')::uuid, tests.uid('alice'), 'Biergarten', tests.var('start')::timestamptz,
   (select id from public.activities where external_id = 'wetter-biergarten'), 'confirmed'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Bar ohne Ort', now() + interval '2 days',
   (select id from public.activities where external_id = 'wetter-ohne-ort'), 'confirmed'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Grillen', now() + interval '2 days', null, 'proposed'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Silvester', now() + interval '20 days',
   (select id from public.activities where external_id = 'wetter-biergarten'), 'confirmed'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Gestern', now() - interval '1 day',
   (select id from public.activities where external_id = 'wetter-biergarten'), 'confirmed'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Abgesagt', now() + interval '2 days',
   (select id from public.activities where external_id = 'wetter-biergarten'), 'cancelled');
select tests.set_var('plan', (select id::text from public.plans where title = 'Biergarten'));

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.plan_weather(uuid)', 'execute'), 'anon fragt kein Wetter ab');
select ok(not has_function_privilege('authenticated', 'public.store_weather_forecast(numeric, numeric, date, jsonb)', 'execute'),
  'angemeldete Nutzer speichern keine Vorhersage');
select ok(not has_table_privilege('authenticated', 'public.weather_forecasts', 'select'), 'Vorhersage-Speicher ist für Nutzer nicht direkt lesbar');

select tests.login_anon();
select throws_ok(format('select public.plan_weather(%L)', tests.var('plan')), '42501', null, 'anon: kein Wetter');

-- ---- Angriff: Außenstehende ---------------------------------------------------------------------
select tests.login('mallory');
select throws_ok(format('select public.plan_weather(%L)', tests.var('plan')), '42501', null, 'Mallory (nicht in der Crew) bekommt keine Antwort – auch nicht den Ort');
select throws_ok(format('select public.plan_weather(%L)', gen_random_uuid()), '42501', null, 'unbekannter Plan: gleiche Antwort wie fremder Plan');
select throws_ok($$ select public.store_weather_forecast(51.34, 12.37, current_date, '[{"hour": 20, "temperature": 99}]'::jsonb) $$,
  '42501', null, 'Mallory kann keine Vorhersage fälschen');
select throws_ok('select * from public.weather_forecasts', '42501', null, 'Mallory liest den Speicher nicht');

-- ---- Mitglied: erste Abfrage --------------------------------------------------------------------
select tests.login('bob');
select tests.set_var('first', public.plan_weather(tests.var('plan')::uuid)::text);
select is(tests.var('first')::jsonb ->> 'status', 'fetch', 'ohne gespeicherte Vorhersage: die Function soll abfragen');
select is((tests.var('first')::jsonb ->> 'latitude')::numeric, 51.34, 'Breite auf zwei Stellen gerundet');
select is((tests.var('first')::jsonb ->> 'longitude')::numeric, 12.37, 'Länge auf zwei Stellen gerundet');
select is(tests.var('first')::jsonb ->> 'day', ((now() at time zone 'Europe/Berlin')::date + 3)::text, 'Tag in Berliner Zeit');
select is((tests.var('first')::jsonb ->> 'hour')::int, 20, 'Stunde in Berliner Zeit');
select is(tests.var('first')::jsonb ->> 'setting', 'outdoor', 'draußen/drinnen kommt mit');
select ok(tests.var('first')::jsonb -> 'hourly' = 'null'::jsonb, 'noch keine Stundenwerte');

-- ---- Edge Function speichert --------------------------------------------------------------------
select tests.login_service();
select throws_ok($$ select public.store_weather_forecast(51.34, 12.37, current_date, '{"hour": 1}'::jsonb) $$, 'P0001', 'invalid_forecast', 'kein Array: abgelehnt');
select throws_ok($$ select public.store_weather_forecast(51.34, 12.37, current_date, '[{"hour": 24}]'::jsonb) $$, 'P0001', 'invalid_forecast', 'Stunde 24: abgelehnt');
select throws_ok($$ select public.store_weather_forecast(51.34, 12.37, current_date, '[{"hour": "x"}]'::jsonb) $$, 'P0001', 'invalid_forecast', 'Stunde als Text: abgelehnt');
select throws_ok($$ select public.store_weather_forecast(51.34, 12.37, current_date, '[]'::jsonb) $$, 'P0001', 'invalid_forecast', 'leer: abgelehnt');
select lives_ok(format($$ select public.store_weather_forecast(51.3406, 12.3747, %L::date,
  '[{"hour": 19, "temperature": 15.1, "precipitation_probability": 10, "weather_code": 1, "wind_speed": 8},
    {"hour": 20, "temperature": 14.2, "precipitation_probability": 70, "weather_code": 61, "wind_speed": 12}]'::jsonb) $$,
  (now() at time zone 'Europe/Berlin')::date + 3), 'Function speichert die Stundenwerte');
select lives_ok($$ select public.store_weather_forecast(51.34, 12.37, current_date - 5, '[{"hour": 1}]'::jsonb) $$, 'alter Tag wird gespeichert …');

select tests.logout();
select is((select count(*)::int from public.weather_forecasts where day = current_date - 5), 0, '… und beim nächsten Speichern aufgeräumt');
select lives_ok($$ select public.store_weather_forecast(52.00, 13.00, current_date, '[{"hour": 1}]'::jsonb) $$, 'noch ein Speichern');
select is((select count(*)::int from public.weather_forecasts where day < current_date - 1), 0, 'vergangene Tage verschwinden');

-- ---- Mitglied: aus dem Speicher -----------------------------------------------------------------
select tests.login('alice');
select tests.set_var('second', public.plan_weather(tests.var('plan')::uuid)::text);
select is(tests.var('second')::jsonb ->> 'status', 'cached', 'frische Vorhersage kommt aus dem Speicher');
select is(jsonb_array_length(tests.var('second')::jsonb -> 'hourly'), 2, 'mit allen Stundenwerten');
select ok(tests.var('second')::jsonb ->> 'fetched_at' is not null, 'mit Abrufzeit');

select tests.logout();
update public.weather_forecasts set fetched_at = now() - interval '4 hours';
select tests.login('alice');
select is(public.plan_weather(tests.var('plan')::uuid) ->> 'status', 'fetch', 'nach 3 Stunden wird neu abgefragt');

-- ---- Kein Wetter, ohne zu raten ------------------------------------------------------------------
select is(public.plan_weather((select id from public.plans where title = 'Bar ohne Ort')) ->> 'status', 'no_location', 'Ort ohne Koordinaten: no_location');
select is(public.plan_weather((select id from public.plans where title = 'Grillen')) ->> 'status', 'no_location', 'Plan ohne Ort: no_location');
select tests.set_var('far', public.plan_weather((select id from public.plans where title = 'Silvester'))::text);
select is(tests.var('far')::jsonb ->> 'status', 'too_far', 'in 20 Tagen: too_far');
select ok((tests.var('far')::jsonb ->> 'available_from')::timestamptz between now() + interval '5 days' and now() + interval '7 days', 'sagt, ab wann es eine Vorhersage gibt');
select ok(not (tests.var('far')::jsonb ? 'latitude'), 'too_far verrät keine Koordinaten');
select is(public.plan_weather((select id from public.plans where title = 'Gestern')) ->> 'status', 'past', 'vorbei: past');
select is(public.plan_weather((select id from public.plans where title = 'Abgesagt')) ->> 'status', 'past', 'abgesagt: past');

-- ---- Rate Limit ---------------------------------------------------------------------------------
select tests.logout();
insert into public.rate_limit_hits (user_id, action) select tests.uid('bob'), 'plan_weather' from generate_series(1, 120);
select tests.login('bob');
select throws_ok(format('select public.plan_weather(%L)', tests.var('plan')), 'P0001', 'rate_limited', 'mehr als 120 Abfragen je Stunde: gebremst');

select * from finish();
rollback;
