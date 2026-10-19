-- „Wann“ und „Wo“ als ein Ablauf (Roadmap P1 Etappe 3a): Orts-Abstimmung zur Termin-Abstimmung.
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
select tests.login('mallory');
select tests.set_var('other_crew', public.create_crew('Andere Crew')::text);
select tests.logout();

select tests.set_var('d1', ((now() at time zone 'Europe/Berlin')::date + 10)::text);
select tests.set_var('d2', ((now() at time zone 'Europe/Berlin')::date + 3)::text);

-- Termin-Abstimmung: d1 20:00 gewinnt (Alice und Bob dabei), d2 ohne Uhrzeit.
select tests.login('alice');
select tests.set_var('when', public.create_date_poll(tests.var('crew')::uuid, 'Wann könnt ihr?', now() + interval '1 day',
  jsonb_build_array(jsonb_build_object('date', tests.var('d1'), 'time', '20:00'), jsonb_build_object('date', tests.var('d2'))))::text);
select tests.set_var('place', public.create_poll(tests.var('crew')::uuid, 'Was machen wir?', now() + interval '1 day', '[{"title":"Kino"}]'::jsonb)::text);
select public.cast_vote((select id from public.poll_options where poll_id = tests.var('when')::uuid and proposed_time is not null), 'yes');
select tests.login('bob');
select public.cast_vote((select id from public.poll_options where poll_id = tests.var('when')::uuid and proposed_time is not null), 'yes');
select tests.logout();

-- ---- Rechte und Angriff von außen --------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.create_where_poll(uuid, text, timestamptz, jsonb, text, text, integer, integer)', 'execute'),
  'anon kann keine Orts-Abstimmung zum Termin anlegen');
select ok(has_function_privilege('authenticated', 'public.create_where_poll(uuid, text, timestamptz, jsonb, text, text, integer, integer)', 'execute'),
  'angemeldete Mitglieder dürfen');

select tests.login_anon();
select throws_ok(format($$ select public.create_where_poll(%L, 'Und wo?', now() + interval '1 day', '[{"title":"Bowling"}]') $$, tests.var('when')),
  '42501', null, 'anon scheitert');

-- Laufende Termin-Abstimmung: noch kein Termin.
select tests.login('alice');
select throws_ok(format($$ select public.create_where_poll(%L, 'Und wo?', now() + interval '1 day', '[{"title":"Bowling"}]') $$, tests.var('when')),
  'P0001', 'date_poll_undecided', 'solange über den Termin abgestimmt wird, gibt es kein „Und wo?“');
select public.close_poll(tests.var('when')::uuid);
select public.close_poll(tests.var('place')::uuid);
select tests.logout();

select tests.login('mallory');
select throws_ok(format($$ select public.create_where_poll(%L, 'Und wo?', now() + interval '1 day', '[{"title":"Bowling"}]') $$, tests.var('when')),
  '42501', 'forbidden', 'Außenstehende können keine Orts-Abstimmung für fremde Crews anlegen');
select throws_ok(format($$ select public.create_where_poll(%L, 'Und wo?', now() + interval '1 day', '[{"title":"Bowling"}]') $$, gen_random_uuid()),
  '42501', 'forbidden', 'unbekannte Abstimmung sieht aus wie eine fremde');
select is((select count(*)::int from public.polls where crew_id = tests.var('crew')::uuid), 0, 'Außenstehende haben nichts angelegt und sehen nichts');
select tests.logout();

-- ---- Eingaben ---------------------------------------------------------------------------------
select tests.login('bob');
select throws_ok(format($$ select public.create_where_poll(%L, 'Und wo?', now() + interval '1 day', '[{"title":"Bowling"}]') $$, tests.var('place')),
  'P0001', 'date_poll_undecided', 'eine Orts-Abstimmung ist keine Termin-Abstimmung');
select throws_ok(format($$ select public.create_where_poll(%L, 'Und wo?', now() + interval '1 day', '{"title":"Bowling"}') $$, tests.var('when')),
  'P0001', 'invalid_options', 'Vorschläge müssen eine Liste sein');
select throws_ok(format($$ select public.create_where_poll(%L, 'Und wo?', now() + interval '1 day', '["Bowling"]') $$, tests.var('when')),
  'P0001', 'invalid_options', 'jeder Vorschlag ist ein Objekt');
select throws_ok(format($$ select public.create_where_poll(%L, 'Und wo?', now() + interval '1 day', '[]') $$, tests.var('when')),
  'P0001', 'invalid_options', 'mindestens ein Vorschlag (Prüfung von create_poll)');
select throws_ok(format($$ select public.create_where_poll(%L, 'ab', now() + interval '1 day', '[{"title":"Bowling"}]') $$, tests.var('when')),
  'P0001', 'invalid_title', 'Titel wird wie bei jeder Abstimmung geprüft');
select throws_ok(format($$ select public.create_where_poll(%L, 'Und wo?', now() - interval '1 minute', '[{"title":"Bowling"}]') $$, tests.var('when')),
  'P0001', 'ends_in_past', 'Frist wird wie bei jeder Abstimmung geprüft');

-- ---- Anlegen: ein einfaches Mitglied darf, der Termin kommt vom Server ---------------------------
select tests.set_var('where', public.create_where_poll(tests.var('when')::uuid, 'Und wo?', now() + interval '1 day',
  jsonb_build_array(
    jsonb_build_object('title', 'Bowling', 'proposed_date', '2030-01-01', 'proposed_time', '11:00'),
    jsonb_build_object('title', 'Kino', 'estimated_price_cents', 1200)),
  p_meeting_point => 'Am Bahnhof')::text);
select is((select date_poll_id::text from public.polls where id = tests.var('where')::uuid), tests.var('when'), 'Orts-Abstimmung ist mit der Termin-Abstimmung verknüpft');
select is((select kind || ' ' || crew_id::text || ' ' || meeting_point from public.polls where id = tests.var('where')::uuid),
  'place ' || tests.var('crew') || ' Am Bahnhof', 'Art „place“, Crew der Termin-Abstimmung, übrige Angaben wie gewohnt');
select is(
  (select string_agg(title || ' ' || proposed_date::text || ' ' || to_char(proposed_time, 'HH24:MI'), ', ' order by position)
   from public.poll_options where poll_id = tests.var('where')::uuid),
  'Bowling ' || tests.var('d1') || ' 20:00, Kino ' || tests.var('d1') || ' 20:00',
  'jeder Vorschlag bekommt den Gewinner-Termin – ein mitgeschicktes Datum zählt nicht');
select is((select estimated_price_cents from public.poll_options where poll_id = tests.var('where')::uuid and title = 'Kino'), 1200, 'Preis bleibt erhalten');
select tests.login('alice'); -- Benachrichtigungen sieht nur die Empfängerin
select ok(exists (select 1 from public.notifications where user_id = tests.uid('alice') and type = 'poll_created' and related_entity_id = tests.var('where')::uuid),
  'die Crew wird wie bei jeder Abstimmung benachrichtigt');
select tests.login('bob');
select throws_ok(format($$ select public.create_where_poll(%L, 'Und wo?', now() + interval '1 day', '[{"title":"Minigolf"}]') $$, tests.var('when')),
  'P0001', 'where_poll_exists', 'kein zweites „Und wo?“, solange eines läuft');
select throws_ok($$ update public.polls set date_poll_id = null $$, '42501', null, 'die Verknüpfung ist nicht direkt änderbar');
select tests.login('mallory');
select is((select count(*)::int from public.polls where date_poll_id = tests.var('when')::uuid), 0, 'Außenstehende sehen die Orts-Abstimmung nicht');
select tests.logout();

-- ---- Plan: Termin und Ort aus beiden ------------------------------------------------------------
select tests.login('alice');
select public.cast_vote((select id from public.poll_options where poll_id = tests.var('where')::uuid and title = 'Bowling'), 'yes');
select public.close_poll(tests.var('where')::uuid);
select throws_ok(format($$ select public.create_where_poll(%L, 'Und wo?', now() + interval '1 day', '[{"title":"Minigolf"}]') $$, tests.var('when')),
  'P0001', 'where_poll_exists', 'auch nach der Entscheidung kein zweites „Und wo?“');
select tests.set_var('plan', public.create_plan_from_poll(tests.var('where')::uuid,
  (select winning_option_id from public.polls where id = tests.var('where')::uuid))::text);
select is((select title || ' ' || to_char(starts_at at time zone 'Europe/Berlin', 'YYYY-MM-DD HH24:MI') from public.plans where id = tests.var('plan')::uuid),
  'Bowling ' || tests.var('d1') || ' 20:00', 'Plan hat den Ort der Orts- und den Termin der Termin-Abstimmung');
select tests.logout();

-- ---- Neuer Versuch, wenn „Und wo?“ ohne Ergebnis endet; Termin ohne Uhrzeit ----------------------
select tests.login('alice');
select tests.set_var('when2', public.create_date_poll(tests.var('crew')::uuid, 'Wann geht Kino?', now() + interval '1 day',
  jsonb_build_array(jsonb_build_object('date', tests.var('d2')), jsonb_build_object('date', tests.var('d1'))))::text);
select public.cast_vote((select id from public.poll_options where poll_id = tests.var('when2')::uuid and proposed_date = tests.var('d2')::date), 'yes');
select public.close_poll(tests.var('when2')::uuid);
select tests.set_var('where2', public.create_where_poll(tests.var('when2')::uuid, 'Wo gehen wir hin?', now() + interval '1 day', '[{"title":"Kino"}]')::text);
select is((select proposed_date::text || ' ' || coalesce(proposed_time::text, 'offen') from public.poll_options where poll_id = tests.var('where2')::uuid),
  tests.var('d2') || ' offen', 'Termin ohne Uhrzeit bleibt ohne Uhrzeit');
select public.close_poll(tests.var('where2')::uuid); -- niemand dabei: kein Ergebnis, kein Gleichstand
select lives_ok(format($$ select public.create_where_poll(%L, 'Wo gehen wir hin?', now() + interval '1 day', '[{"title":"Bowling"}]') $$, tests.var('when2')),
  'endet „Und wo?“ ohne Ergebnis, darf die Crew es noch einmal versuchen');
select is((select count(*)::int from public.polls where date_poll_id = tests.var('when2')::uuid), 2, 'beide Versuche sind verknüpft');
select tests.logout();

-- ---- Termin schon vorbei -------------------------------------------------------------------------
select tests.login('alice');
select tests.set_var('when3', public.create_date_poll(tests.var('crew')::uuid, 'Wann geht Minigolf?', now() + interval '1 day',
  jsonb_build_array(jsonb_build_object('date', tests.var('d2')), jsonb_build_object('date', tests.var('d1'))))::text);
select public.cast_vote((select id from public.poll_options where poll_id = tests.var('when3')::uuid and proposed_date = tests.var('d2')::date), 'yes');
select public.close_poll(tests.var('when3')::uuid);
select tests.logout();
update public.poll_options set proposed_date = (now() at time zone 'Europe/Berlin')::date - 1
where id = (select winning_option_id from public.polls where id = tests.var('when3')::uuid);
select tests.login('alice');
select throws_ok(format($$ select public.create_where_poll(%L, 'Und wo?', now() + interval '1 day', '[{"title":"Minigolf"}]') $$, tests.var('when3')),
  'P0001', 'slot_in_past', 'liegt der Termin schon zurück, gibt es kein „Und wo?“ mehr');
select tests.logout();

-- ---- Löschen der Termin-Abstimmung bricht nichts --------------------------------------------------
delete from public.polls where id = tests.var('when2')::uuid;
select is((select count(*)::int from public.polls where id = tests.var('where2')::uuid and date_poll_id is null), 1,
  'wird die Termin-Abstimmung gelöscht, bleibt die Orts-Abstimmung ohne Verknüpfung');

select * from finish();
rollback;
