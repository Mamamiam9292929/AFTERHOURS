-- Termin-Abstimmung „Wann könnt ihr?“ (Roadmap P1): Anlegen, Prüfungen, Titel, Stichwahl, Plan.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Mallory'); -- Außenstehende

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew')::text);
select tests.set_var('token', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob'); select public.accept_crew_invitation(tests.var('token'));
select tests.logout();

-- Feste Termine weit in der Zukunft relativ zu heute (Berliner Zeit).
select tests.set_var('d1', ((now() at time zone 'Europe/Berlin')::date + 10)::text);
select tests.set_var('d2', ((now() at time zone 'Europe/Berlin')::date + 3)::text);
select tests.set_var('l1', app_private.german_date_label(tests.var('d1')::date));
select tests.set_var('l2', app_private.german_date_label(tests.var('d2')::date));

-- ---- Rechte und Angriff von außen --------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.create_date_poll(uuid, text, timestamptz, jsonb, text)', 'execute'), 'anon kann keine Termin-Abstimmung anlegen');
select ok(not has_function_privilege('authenticated', 'app_private.german_date_label(date)', 'execute'), 'Hilfsfunktion ist intern');

select tests.login('mallory');
select throws_ok(format($$ select public.create_date_poll(%L, 'Wann könnt ihr?', now() + interval '1 day', '[{"date":"%s"},{"date":"%s"}]') $$,
  tests.var('crew'), tests.var('d1'), tests.var('d2')), '42501', 'forbidden', 'Außenstehende können keine Termin-Abstimmung starten');
select throws_ok($$ update public.polls set kind = 'date' $$, '42501', null, 'die Art einer Abstimmung ist nicht direkt änderbar');
select tests.logout();

-- ---- Eingaben ---------------------------------------------------------------------------------
select tests.login('alice');
select throws_ok(format($$ select public.create_date_poll(%L, 'Wann könnt ihr?', now() + interval '1 day', '[{"date":"%s"}]') $$, tests.var('crew'), tests.var('d1')),
  'P0001', 'invalid_slots', 'ein einzelner Termin ist keine Abstimmung');
select throws_ok(format($$ select public.create_date_poll(%L, 'Wann könnt ihr?', now() + interval '1 day', %L) $$, tests.var('crew'),
  (select jsonb_agg(jsonb_build_object('date', ((now() at time zone 'Europe/Berlin')::date + g)::text)) from generate_series(1, 11) g)),
  'P0001', 'invalid_slots', 'höchstens zehn Termine');
select throws_ok(format($$ select public.create_date_poll(%L, 'Wann könnt ihr?', now() + interval '1 day', '[{"date":"%s","time":"20:00"},{"date":"%s","time":"20:00"}]') $$, tests.var('crew'), tests.var('d1'), tests.var('d1')),
  'P0001', 'invalid_slots', 'doppelte Termine werden abgelehnt');
select throws_ok(format($$ select public.create_date_poll(%L, 'Wann könnt ihr?', now() + interval '1 day', '[{"date":"kein datum"},{"date":"%s"}]') $$, tests.var('crew'), tests.var('d1')),
  'P0001', 'invalid_slots', 'ungültiges Datum wird abgelehnt');
select throws_ok(format($$ select public.create_date_poll(%L, 'Wann könnt ihr?', now() + interval '1 day', '[{"date":"%s","time":"25:99"},{"date":"%s"}]') $$, tests.var('crew'), tests.var('d1'), tests.var('d2')),
  'P0001', 'invalid_slots', 'ungültige Uhrzeit wird abgelehnt');
select throws_ok(format($$ select public.create_date_poll(%L, 'Wann könnt ihr?', now() + interval '1 day', '[{"date":"%s"},{"date":"%s"}]') $$, tests.var('crew'),
  ((now() at time zone 'Europe/Berlin')::date - 1)::text, tests.var('d1')),
  'P0001', 'slot_in_past', 'Termin in der Vergangenheit wird abgelehnt');
select throws_ok(format($$ select public.create_date_poll(%L, 'Wann könnt ihr?', now() + interval '1 day', '[{"date":"%s"},{"date":"%s"}]') $$, tests.var('crew'),
  ((now() at time zone 'Europe/Berlin')::date + 400)::text, tests.var('d1')),
  'P0001', 'invalid_slots', 'Termine höchstens ein Jahr voraus');
select throws_ok(format($$ select public.create_date_poll(%L, 'ab', now() + interval '1 day', '[{"date":"%s"},{"date":"%s"}]') $$, tests.var('crew'), tests.var('d1'), tests.var('d2')),
  'P0001', 'invalid_title', 'Prüfungen von create_poll gelten weiter (Titel)');
select throws_ok(format($$ select public.create_date_poll(%L, 'Wann könnt ihr?', now() - interval '1 minute', '[{"date":"%s"},{"date":"%s"}]') $$, tests.var('crew'), tests.var('d1'), tests.var('d2')),
  'P0001', 'ends_in_past', 'Prüfungen von create_poll gelten weiter (Frist)');

-- ---- Anlegen ----------------------------------------------------------------------------------
select tests.set_var('poll', public.create_date_poll(tests.var('crew')::uuid, 'Wann geht Bowling?', now() + interval '1 day',
  jsonb_build_array(
    jsonb_build_object('date', tests.var('d1'), 'time', '20:00'),
    jsonb_build_object('date', tests.var('d2')),
    jsonb_build_object('date', tests.var('d1'), 'time', '18:30')),
  'Ort klären wir danach.')::text);
select is((select kind from public.polls where id = tests.var('poll')::uuid), 'date', 'Art „date“ gespeichert');
select is((select count(*)::int from public.poll_options where poll_id = tests.var('poll')::uuid), 3, 'drei Termine');
select is(
  (select string_agg(coalesce(proposed_date::text, '') || ' ' || coalesce(to_char(proposed_time, 'HH24:MI'), '-'), ', ' order by position)
   from public.poll_options where poll_id = tests.var('poll')::uuid),
  tests.var('d2') || ' -, ' || tests.var('d1') || ' 18:30, ' || tests.var('d1') || ' 20:00',
  'Termine chronologisch sortiert, Uhrzeit optional');
select is((select title from public.poll_options where poll_id = tests.var('poll')::uuid and position = 1),
  tests.var('l2'), 'Titel der Option ist das Datum auf Deutsch');
select is((select count(*)::int from public.poll_options where poll_id = tests.var('poll')::uuid and (activity_id is not null or estimated_price_cents is not null)), 0,
  'Termine haben weder Ort noch Preis');
select tests.logout();
select is(app_private.german_date_label('2026-10-17'), 'Samstag, 17. Oktober', 'deutsches Datum: Wochentag, Tag, Monat');
select is(app_private.german_date_label('2027-03-01'), 'Montag, 1. März', 'deutsches Datum mit Umlaut');

-- Bob sieht die Abstimmung und stimmt wie gewohnt ab.
select tests.login('bob');
select is((select kind from public.polls where id = tests.var('poll')::uuid), 'date', 'Mitglieder sehen die Art');
select lives_ok(format($$ select public.cast_vote(%L, 'yes') $$, (select id from public.poll_options where poll_id = tests.var('poll')::uuid and position = 2)), 'Abstimmen wie bei Orten');
select tests.login('mallory');
select is((select count(*)::int from public.polls where id = tests.var('poll')::uuid), 0, 'Außenstehende sehen die Termin-Abstimmung nicht');
select tests.logout();

-- ---- Ergebnis, Plan -----------------------------------------------------------------------------
select tests.login('alice');
select public.close_poll(tests.var('poll')::uuid);
select is((select title from public.poll_options where id = (select winning_option_id from public.polls where id = tests.var('poll')::uuid)),
  tests.var('l1'), 'Termin mit den meisten Zusagen gewinnt');
select tests.set_var('plan', public.create_plan_from_poll(tests.var('poll')::uuid,
  (select winning_option_id from public.polls where id = tests.var('poll')::uuid), p_title => 'Bowling')::text);
select is((select title || ' ' || to_char(starts_at at time zone 'Europe/Berlin', 'YYYY-MM-DD HH24:MI') from public.plans where id = tests.var('plan')::uuid),
  'Bowling ' || tests.var('d1') || ' 18:30', 'Plan aus dem Gewinner-Termin: eigener Titel, Datum und Uhrzeit des Termins');
select tests.logout();

-- ---- Stichwahl erbt die Art -----------------------------------------------------------------------
select tests.login('alice');
select tests.set_var('tie', public.create_date_poll(tests.var('crew')::uuid, 'Wann geht Kino?', now() + interval '1 day',
  jsonb_build_array(jsonb_build_object('date', tests.var('d1')), jsonb_build_object('date', tests.var('d2'))))::text);
select public.cast_vote((select id from public.poll_options where poll_id = tests.var('tie')::uuid and position = 1), 'yes');
select tests.login('bob');
select public.cast_vote((select id from public.poll_options where poll_id = tests.var('tie')::uuid and position = 2), 'yes');
select tests.login('alice');
select public.close_poll(tests.var('tie')::uuid);
select is((select is_tie from public.polls where id = tests.var('tie')::uuid), true, 'je eine Zusage: Gleichstand');
select tests.set_var('runoff', public.start_runoff_poll(tests.var('tie')::uuid, 'Wann geht Kino? Stichwahl', now() + interval '1 day')::text);
select is((select kind from public.polls where id = tests.var('runoff')::uuid), 'date', 'Stichwahl einer Termin-Abstimmung ist wieder eine Termin-Abstimmung');
select tests.set_var('normal', public.create_poll(tests.var('crew')::uuid, 'Was machen wir?', now() + interval '1 day', '[{"title":"Kino"}]'::jsonb)::text);
select is((select kind from public.polls where id = tests.var('normal')::uuid), 'place',
  'normale Abstimmung bleibt „place“');
select tests.logout();

select * from finish();
rollback;
