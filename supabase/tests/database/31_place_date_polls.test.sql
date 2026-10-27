-- P5 Etappe 3: „Wann könnt ihr?“ für einen festen Ort – jede Option trägt den Ort, das Wetter kommt je
-- Termin, der Plan übernimmt Ort und Adresse. Angriffe von anon und Außenstehenden scheitern.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Mallory'); -- Außenstehende

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew', '🎳')::text);
select tests.set_var('invite', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Bob tritt bei');

-- Orte direkt anlegen (am RLS vorbei).
select tests.logout();
insert into public.activities (provider_id, external_id, name, category, city, address, latitude, longitude, setting, data_source) values
  ('manual', 'pdp-biergarten', 'Biergarten am See', 'outdoor', 'Leipzig', 'Seeweg 1, Leipzig', 51.340632, 12.374733, 'outdoor', 'manual');
insert into public.activities (provider_id, external_id, name, category, city, data_source, is_active) values
  ('manual', 'pdp-zu', 'Geschlossene Bar', 'bar', 'Leipzig', 'manual', false);
select tests.set_var('place', (select id::text from public.activities where external_id = 'pdp-biergarten'));
select tests.set_var('inactive', (select id::text from public.activities where external_id = 'pdp-zu'));
select tests.set_var('d1', ((now() at time zone 'Europe/Berlin')::date + 3)::text);
select tests.set_var('d2', ((now() at time zone 'Europe/Berlin')::date + 4)::text);
select tests.set_var('l1', app_private.german_date_label(tests.var('d1')::date));
select tests.set_var('l2', app_private.german_date_label(tests.var('d2')::date));
select tests.set_var('slots', jsonb_build_array(
  jsonb_build_object('date', tests.var('d1'), 'time', '19:30'),
  jsonb_build_object('date', tests.var('d2')))::text);

-- ---- Rechte und Angriffe von außen --------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.create_place_date_poll(uuid, text, timestamptz, jsonb, uuid, text)', 'execute'),
  'anon kann keine Termin-Abstimmung mit Ort anlegen');
select ok(has_function_privilege('authenticated', 'public.create_place_date_poll(uuid, text, timestamptz, jsonb, uuid, text)', 'execute'),
  'angemeldete Nutzer dürfen (die Funktion prüft die Crew)');

select tests.login_anon();
select throws_ok(format($$ select public.create_place_date_poll(%L, 'Wann könnt ihr?', now() + interval '1 day', %L, %L) $$,
  tests.var('crew'), tests.var('slots'), tests.var('place')), '42501', null, 'anon: abgewiesen');

select tests.login('mallory');
select throws_ok(format($$ select public.create_place_date_poll(%L, 'Wann könnt ihr?', now() + interval '1 day', %L, %L) $$,
  tests.var('crew'), tests.var('slots'), tests.var('place')), '42501', 'forbidden', 'Außenstehende können keine Abstimmung in fremden Crews starten');
select throws_ok(format($$ select public.create_place_date_poll(%L, 'Wann könnt ihr?', now() + interval '1 day', %L, %L) $$,
  tests.var('crew'), tests.var('slots'), gen_random_uuid()), '42501', 'forbidden', 'auch mit unbekanntem Ort: erst die Crew, nichts über Orte verraten');
select is((select count(*)::int from public.polls where crew_id = tests.var('crew')::uuid), 0, 'keine Abstimmung entstanden');

-- ---- Eingaben -----------------------------------------------------------------------------------
select tests.login('alice');
select throws_ok(format($$ select public.create_place_date_poll(%L, 'Wann könnt ihr?', now() + interval '1 day', %L, %L) $$,
  tests.var('crew'), tests.var('slots'), gen_random_uuid()), 'P0001', 'unknown_activity', 'unbekannter Ort wird abgelehnt');
select throws_ok(format($$ select public.create_place_date_poll(%L, 'Wann könnt ihr?', now() + interval '1 day', %L, %L) $$,
  tests.var('crew'), tests.var('slots'), tests.var('inactive')), 'P0001', 'unknown_activity', 'abgeschalteter Ort wird abgelehnt');
select throws_ok(format($$ select public.create_place_date_poll(%L, 'Wann könnt ihr?', now() + interval '1 day', null, %L) $$,
  tests.var('crew'), tests.var('place')), 'P0001', 'invalid_slots', 'Prüfungen der Termin-Abstimmung gelten weiter (Termine)');
select throws_ok(format($$ select public.create_place_date_poll(%L, 'ab', now() + interval '1 day', %L, %L) $$,
  tests.var('crew'), tests.var('slots'), tests.var('place')), 'P0001', 'invalid_title', 'Prüfungen von create_poll gelten weiter (Titel)');
select is((select count(*)::int from public.polls where crew_id = tests.var('crew')::uuid), 0, 'abgelehnte Versuche hinterlassen nichts');

-- ---- Anlegen ------------------------------------------------------------------------------------
select tests.set_var('poll', public.create_place_date_poll(tests.var('crew')::uuid, 'Wann geht Biergarten?', now() + interval '1 day',
  tests.var('slots')::jsonb, tests.var('place')::uuid, 'Ort steht schon.')::text);
select is((select kind from public.polls where id = tests.var('poll')::uuid), 'date', 'es ist eine Termin-Abstimmung');
select is((select count(*)::int from public.poll_options where poll_id = tests.var('poll')::uuid), 2, 'zwei Termine');
select is((select count(*)::int from public.poll_options where poll_id = tests.var('poll')::uuid and activity_id = tests.var('place')::uuid), 2,
  'jeder Termin trägt den Ort');
select is((select string_agg(title, ' | ' order by position) from public.poll_options where poll_id = tests.var('poll')::uuid),
  tests.var('l1') || ' | ' || tests.var('l2'),
  'Titel der Optionen bleiben das Datum');
select is((select count(*)::int from public.notifications where entity_id = tests.var('poll')::uuid and user_id = tests.uid('bob')), 1,
  'die Crew erfährt davon wie bei jeder Abstimmung');

-- ---- Wetter je Termin ---------------------------------------------------------------------------
select tests.login('bob');
select tests.set_var('weather', public.poll_weather(tests.var('poll')::uuid)::text);
select is(jsonb_array_length(tests.var('weather')::jsonb -> 'options'), 2, 'Wetter für beide Termine');
select is((select string_agg((o ->> 'day') || ' ' || coalesce(o ->> 'hour', '-') || ' ' || (o ->> 'setting'), ', ')
           from jsonb_array_elements(tests.var('weather')::jsonb -> 'options') o),
  tests.var('d1') || ' 19 outdoor, ' || tests.var('d2') || ' - outdoor', 'Tag, Stunde (wenn bekannt) und draußen – am festen Ort');
select is((select count(*)::int from jsonb_array_elements(tests.var('weather')::jsonb -> 'options') o where o ->> 'latitude' = '51.34' and o ->> 'longitude' = '12.37'), 2,
  'Ort gerundet wie bei jeder Wetterabfrage');
select tests.login('mallory');
select throws_ok(format('select public.poll_weather(%L)', tests.var('poll')), '42501', null, 'Außenstehende bekommen kein Wetter (und damit keinen Ort)');
select is((select count(*)::int from public.poll_options where poll_id = tests.var('poll')::uuid), 0, 'Außenstehende sehen die Termine nicht');

-- ---- Plan aus dem Gewinner-Termin übernimmt den Ort ----------------------------------------------
select tests.login('bob');
select public.cast_vote((select id from public.poll_options where poll_id = tests.var('poll')::uuid and position = 1), 'yes');
select tests.login('alice');
select public.close_poll(tests.var('poll')::uuid);
select tests.set_var('plan', public.create_plan_from_poll(tests.var('poll')::uuid,
  (select winning_option_id from public.polls where id = tests.var('poll')::uuid), p_title => 'Biergarten')::text);
select is((select activity_id::text || ' | ' || address || ' | ' || to_char(starts_at at time zone 'Europe/Berlin', 'YYYY-MM-DD HH24:MI') from public.plans where id = tests.var('plan')::uuid),
  tests.var('place') || ' | Seeweg 1, Leipzig | ' || tests.var('d1') || ' 19:30', 'Plan mit Ort, Adresse und Termin');
select tests.logout();

select * from finish();
rollback;
