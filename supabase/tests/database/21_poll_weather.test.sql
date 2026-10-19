-- P5 Etappe 2: Wetter je Vorschlag einer laufenden Abstimmung – nur Mitglieder, nur Vorschläge mit
-- Ort (Koordinaten) und Termin, nichts für Vergangenes, zu weit voraus nur „ab wann“, ohne Ort.
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

-- Orte, Abstimmungen und Vorschläge direkt anlegen (am RLS vorbei).
select tests.logout();
select tests.set_var('today', ((now() at time zone 'Europe/Berlin')::date)::text);
insert into public.activities (provider_id, external_id, name, category, city, latitude, longitude, setting, data_source) values
  ('manual', 'pw-biergarten', 'Biergarten am See', 'outdoor', 'Leipzig', 51.340632, 12.374733, 'outdoor', 'manual'),
  ('manual', 'pw-ohne-ort', 'Ort ohne Koordinaten', 'bar', 'Leipzig', null, null, null, 'manual');
select tests.set_var('biergarten', (select id::text from public.activities where external_id = 'pw-biergarten'));

insert into public.polls (crew_id, created_by, title, ends_at) values
  (tests.var('crew')::uuid, tests.uid('alice'), 'Was machen wir am Samstag?', now() + interval '2 days');
insert into public.polls (crew_id, created_by, title, ends_at, status, closed_at) values
  (tests.var('crew')::uuid, tests.uid('alice'), 'Schon entschieden', now() - interval '1 hour', 'closed', now());
insert into public.polls (crew_id, created_by, title, ends_at) values
  (tests.var('crew')::uuid, tests.uid('alice'), 'Nur eigene Vorschläge', now() + interval '2 days');
select tests.set_var('poll', (select id::text from public.polls where title = 'Was machen wir am Samstag?'));
select tests.set_var('closed', (select id::text from public.polls where title = 'Schon entschieden'));
select tests.set_var('own', (select id::text from public.polls where title = 'Nur eigene Vorschläge'));

insert into public.poll_options (poll_id, activity_id, title, proposed_date, proposed_time, position) values
  (tests.var('poll')::uuid, tests.var('biergarten')::uuid, 'Biergarten 20 Uhr', tests.var('today')::date + 3, '20:00', 0),
  (tests.var('poll')::uuid, tests.var('biergarten')::uuid, 'Biergarten ganztags', tests.var('today')::date + 3, null, 1),
  (tests.var('poll')::uuid, (select id from public.activities where external_id = 'pw-ohne-ort'), 'Bar ohne Ort', tests.var('today')::date + 3, '20:00', 2),
  (tests.var('poll')::uuid, null, 'Grillen bei Bob', tests.var('today')::date + 3, '18:00', 3),
  (tests.var('poll')::uuid, tests.var('biergarten')::uuid, 'Biergarten in drei Wochen', tests.var('today')::date + 20, '19:00', 4),
  (tests.var('poll')::uuid, tests.var('biergarten')::uuid, 'Biergarten gestern', tests.var('today')::date - 1, '19:00', 5),
  (tests.var('poll')::uuid, tests.var('biergarten')::uuid, 'Biergarten irgendwann', null, null, 6),
  (tests.var('closed')::uuid, tests.var('biergarten')::uuid, 'Biergarten', tests.var('today')::date + 3, '20:00', 0),
  (tests.var('own')::uuid, null, 'Grillen bei Bob', tests.var('today')::date + 3, '18:00', 0);

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.poll_weather(uuid)', 'execute'), 'anon fragt kein Wetter für Abstimmungen ab');
select ok(has_function_privilege('authenticated', 'public.poll_weather(uuid)', 'execute'), 'angemeldete Nutzer dürfen fragen (die Funktion prüft die Crew)');

select tests.login_anon();
select throws_ok(format('select public.poll_weather(%L)', tests.var('poll')), '42501', null, 'anon: kein Wetter');

-- ---- Angriff: Außenstehende ---------------------------------------------------------------------
select tests.login('mallory');
select throws_ok(format('select public.poll_weather(%L)', tests.var('poll')), '42501', null, 'Mallory (nicht in der Crew) bekommt nichts – keine Orte, keine Termine');
select throws_ok(format('select public.poll_weather(%L)', gen_random_uuid()), '42501', null, 'unbekannte Abstimmung: gleiche Antwort wie eine fremde');
select throws_ok(format('select public.poll_weather(%L)', tests.var('closed')), '42501', null, 'auch abgeschlossene fremde Abstimmungen verraten nicht, dass sie zu sind');

-- ---- Mitglied: erste Abfrage --------------------------------------------------------------------
select tests.login('bob');
select tests.set_var('first', public.poll_weather(tests.var('poll')::uuid)::text);
select is(tests.var('first')::jsonb ->> 'status', 'open', 'laufende Abstimmung');
select is(jsonb_array_length(tests.var('first')::jsonb -> 'options'), 3, 'nur Vorschläge mit Ort, Koordinaten und anstehendem Termin (zwei am Tag, einer zu weit)');
select is(
  (select array_agg(o ->> 'option_id' order by ord) from jsonb_array_elements(tests.var('first')::jsonb -> 'options') with ordinality as x(o, ord)),
  (select array_agg(id::text order by position) from public.poll_options
    where poll_id = tests.var('poll')::uuid and title in ('Biergarten 20 Uhr', 'Biergarten ganztags', 'Biergarten in drei Wochen')),
  'Reihenfolge wie in der Abstimmung, ohne eigene Vorschläge, Orte ohne Koordinaten, Gestern und ohne Datum');

select tests.set_var('o1', (select o::text from jsonb_array_elements(tests.var('first')::jsonb -> 'options') o
  where o ->> 'option_id' = (select id::text from public.poll_options where title = 'Biergarten 20 Uhr')));
select is(tests.var('o1')::jsonb ->> 'status', 'fetch', 'ohne gespeicherte Vorhersage: die Function soll abfragen');
select is((tests.var('o1')::jsonb ->> 'latitude')::numeric, 51.34, 'Breite auf zwei Stellen gerundet');
select is((tests.var('o1')::jsonb ->> 'longitude')::numeric, 12.37, 'Länge auf zwei Stellen gerundet');
select is(tests.var('o1')::jsonb ->> 'day', (tests.var('today')::date + 3)::text, 'Tag des Vorschlags');
select is((tests.var('o1')::jsonb ->> 'hour')::int, 20, 'Stunde des Vorschlags');
select is(tests.var('o1')::jsonb ->> 'setting', 'outdoor', 'draußen/drinnen kommt mit');
select ok(tests.var('o1')::jsonb -> 'hourly' = 'null'::jsonb, 'noch keine Stundenwerte');
select ok(not (tests.var('o1')::jsonb ?| array['title', 'activity_id', 'crew_id', 'created_by']), 'keine Titel, Orts-IDs oder Personen in der Antwort');

select tests.set_var('o2', (select o::text from jsonb_array_elements(tests.var('first')::jsonb -> 'options') o
  where o ->> 'option_id' = (select id::text from public.poll_options where title = 'Biergarten ganztags')));
select ok(tests.var('o2')::jsonb -> 'hour' = 'null'::jsonb, 'ohne Uhrzeit: keine Stunde (die App fasst den Tag zusammen)');

select tests.set_var('far', (select o::text from jsonb_array_elements(tests.var('first')::jsonb -> 'options') o
  where o ->> 'option_id' = (select id::text from public.poll_options where title = 'Biergarten in drei Wochen')));
select is(tests.var('far')::jsonb ->> 'status', 'too_far', 'in 20 Tagen: too_far');
select is(tests.var('far')::jsonb ->> 'available_from', (tests.var('today')::date + 6)::text, 'sagt, ab wann es eine Vorhersage gibt (14 Tage vorher)');
select ok(not (tests.var('far')::jsonb ?| array['latitude', 'longitude', 'day']), 'too_far verrät keine Koordinaten');

-- ---- Speicher wird geteilt (gleicher Ort und Tag wie ein Plan) -----------------------------------
select tests.login_service();
select lives_ok(format($$ select public.store_weather_forecast(51.3406, 12.3747, %L::date,
  '[{"hour": 19, "temperature": 15.1, "precipitation_probability": 10, "weather_code": 1, "wind_speed": 8},
    {"hour": 20, "temperature": 14.2, "precipitation_probability": 70, "weather_code": 61, "wind_speed": 12}]'::jsonb) $$,
  tests.var('today')::date + 3), 'Function speichert den Tag');

select tests.login('alice');
select tests.set_var('second', public.poll_weather(tests.var('poll')::uuid)::text);
select is(
  (select count(*)::int from jsonb_array_elements(tests.var('second')::jsonb -> 'options') o where o ->> 'status' = 'cached'),
  2, 'beide Vorschläge am gespeicherten Ort und Tag kommen aus dem Speicher');
select is(
  (select jsonb_array_length(o -> 'hourly') from jsonb_array_elements(tests.var('second')::jsonb -> 'options') o where o ->> 'status' = 'cached' limit 1),
  2, 'mit allen Stundenwerten');

select tests.logout();
update public.weather_forecasts set fetched_at = now() - interval '4 hours';
select tests.login('alice');
select is(
  (select count(*)::int from jsonb_array_elements(public.poll_weather(tests.var('poll')::uuid) -> 'options') o where o ->> 'status' = 'fetch'),
  2, 'nach 3 Stunden wird neu abgefragt');

-- ---- Kein Wetter, ohne zu raten ------------------------------------------------------------------
select is(public.poll_weather(tests.var('closed')::uuid), '{"status": "closed"}'::jsonb, 'abgeschlossene Abstimmung: nur closed, keine Orte');
select is(public.poll_weather(tests.var('own')::uuid), '{"status": "open", "options": []}'::jsonb, 'nur eigene Vorschläge: nichts abzufragen');

-- ---- Rate Limit ---------------------------------------------------------------------------------
select tests.logout();
insert into public.rate_limit_hits (user_id, action) select tests.uid('bob'), 'poll_weather' from generate_series(1, 120);
select tests.login('bob');
select throws_ok(format('select public.poll_weather(%L)', tests.var('poll')), 'P0001', 'rate_limited', 'mehr als 120 Abfragen je Stunde: gebremst');
select tests.login('alice');
select lives_ok(format('select public.poll_weather(%L)', tests.var('poll')), 'das Limit gilt je Person');

select * from finish();
rollback;
