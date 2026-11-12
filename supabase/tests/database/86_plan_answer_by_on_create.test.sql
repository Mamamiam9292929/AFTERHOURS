-- P47: Antwortfrist gleich beim Erstellen – create_plan_with_answer_by und create_plan_from_poll_with_answer_by.
-- Gleiche Prüfungen wie set_plan_answer_by; ungültige Frist = kein Plan, keine Benachrichtigung; Außenstehende
-- und einfache Mitglieder (bei der Abstimmung) legen nichts an.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Mallory');

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew', '🎳')::text);
select tests.set_var('invite', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob');
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('mallory');
select public.create_crew('Fremde Crew');

select tests.set_var('start', (now() + interval '3 days')::text);
select tests.set_var('at', (now() + interval '2 days')::text);

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon',
  'public.create_plan_with_answer_by(uuid, text, timestamptz, timestamptz, uuid, text, text, text, integer, integer, timestamptz, boolean)', 'execute'),
  'anon legt keinen Plan mit Frist an');
select ok(has_function_privilege('authenticated',
  'public.create_plan_with_answer_by(uuid, text, timestamptz, timestamptz, uuid, text, text, text, integer, integer, timestamptz, boolean)', 'execute'),
  'angemeldete dürfen aufrufen');
select ok(not has_function_privilege('anon',
  'public.create_plan_from_poll_with_answer_by(uuid, uuid, timestamptz, timestamptz, text, text, text, text, integer)', 'execute'),
  'anon macht keinen Plan aus einer Abstimmung');
select ok(has_function_privilege('authenticated',
  'public.create_plan_from_poll_with_answer_by(uuid, uuid, timestamptz, timestamptz, text, text, text, text, integer)', 'execute'),
  'angemeldete dürfen aufrufen (Abstimmung)');
select tests.logout();
select tests.login_anon();
select throws_ok($$ select public.create_plan_with_answer_by(tests.var('crew')::uuid, 'Kino', tests.var('start')::timestamptz, tests.var('at')::timestamptz) $$,
  '42501', null, 'ohne Konto: verboten');

-- ---- Angriffe ------------------------------------------------------------------------------------
select tests.login('mallory');
select throws_ok($$ select public.create_plan_with_answer_by(tests.var('crew')::uuid, 'Kino', tests.var('start')::timestamptz, tests.var('at')::timestamptz) $$,
  '42501', 'forbidden', 'Außenstehende legen in fremden Crews nichts an');
select tests.logout();
select is((select count(*)::int from public.plans where crew_id = tests.var('crew')::uuid), 0, 'nach dem Angriff kein Plan');

-- ---- Grenzen: ungültige Frist = kein Plan ------------------------------------------------------------
select tests.login('bob');
select throws_ok($$ select public.create_plan_with_answer_by(tests.var('crew')::uuid, 'Kino', tests.var('start')::timestamptz, now() - interval '1 minute') $$,
  'P0001', 'plan_answer_by_invalid', 'Frist in der Vergangenheit');
select throws_ok($$ select public.create_plan_with_answer_by(tests.var('crew')::uuid, 'Kino', tests.var('start')::timestamptz,
  tests.var('start')::timestamptz - interval '30 minutes') $$, 'P0001', 'plan_answer_by_invalid', 'weniger als 1 h vor Beginn');
select throws_ok($$ select public.create_plan_with_answer_by(tests.var('crew')::uuid, 'Kino', tests.var('start')::timestamptz,
  tests.var('start')::timestamptz + interval '1 day') $$, 'P0001', 'plan_answer_by_invalid', 'nach Beginn');
select tests.logout();
select is((select count(*)::int from public.plans where crew_id = tests.var('crew')::uuid), 0, 'ungültige Frist: auch kein Plan');
select is((select count(*)::int from public.notifications where type = 'plan_created' and user_id = tests.uid('alice')), 0,
  'ungültige Frist: niemand bekommt Bescheid');

-- ---- Anlegen ------------------------------------------------------------------------------------
select tests.login('bob');
select tests.set_var('plan', public.create_plan_with_answer_by(tests.var('crew')::uuid, 'Kino', tests.var('start')::timestamptz,
  tests.var('at')::timestamptz, p_confirmed => true)::text);
select tests.login('alice');
select is((select answer_by from public.plans where id = tests.var('plan')::uuid), tests.var('at')::timestamptz, 'Plan mit Frist – die Crew sieht sie');
select is((select status::text from public.plans where id = tests.var('plan')::uuid), 'confirmed', 'übrige Angaben wie bei create_plan');
select is((select created_by from public.plans where id = tests.var('plan')::uuid), tests.uid('bob'), 'Bob organisiert');
select tests.logout();
select is((select count(*)::int from public.audit_log where action = 'plan_answer_by_set' and entity_id = tests.var('plan')::uuid), 1, 'Frist im Protokoll');

select tests.login('bob');
select tests.set_var('plain', public.create_plan_with_answer_by(tests.var('crew')::uuid, 'Bowling', tests.var('start')::timestamptz, null)::text);
select is((select answer_by from public.plans where id = tests.var('plain')::uuid), null, 'ohne Frist: wie create_plan');

-- ---- Plan aus Abstimmung ----------------------------------------------------------------------------
select tests.login('alice');
select tests.set_var('poll', public.create_poll(tests.var('crew')::uuid, 'Was machen wir Samstag?', now() + interval '2 days',
  jsonb_build_array(
    jsonb_build_object('title', 'Bowling', 'proposed_date', '2031-06-14', 'proposed_time', '19:30'),
    jsonb_build_object('title', 'Kino', 'proposed_date', '2031-06-14')))::text);
select tests.set_var('opt1', (select id::text from public.poll_options where poll_id = tests.var('poll')::uuid and position = 1));
select public.cast_vote(tests.var('opt1')::uuid, 'yes');
select public.close_poll(tests.var('poll')::uuid);
select tests.set_var('poll_start', ('2031-06-14 19:30'::timestamp at time zone 'Europe/Berlin')::text);

select tests.login('bob');
select throws_ok($$ select public.create_plan_from_poll_with_answer_by(tests.var('poll')::uuid, tests.var('opt1')::uuid, tests.var('at')::timestamptz) $$,
  '42501', 'forbidden', 'einfache Mitglieder machen aus fremden Abstimmungen keinen Plan');
select tests.login('mallory');
select throws_ok($$ select public.create_plan_from_poll_with_answer_by(tests.var('poll')::uuid, tests.var('opt1')::uuid, tests.var('at')::timestamptz) $$,
  '42501', 'forbidden', 'Außenstehende erst recht nicht');

select tests.login('alice');
select throws_ok($$ select public.create_plan_from_poll_with_answer_by(tests.var('poll')::uuid, tests.var('opt1')::uuid,
  tests.var('poll_start')::timestamptz - interval '10 minutes') $$, 'P0001', 'plan_answer_by_invalid', 'Abstimmung: Frist zu knapp vor Beginn');
select is((select count(*)::int from public.plans where poll_id = tests.var('poll')::uuid), 0, 'ungültige Frist: kein Plan aus der Abstimmung');

select tests.set_var('poll_plan', public.create_plan_from_poll_with_answer_by(tests.var('poll')::uuid, tests.var('opt1')::uuid,
  tests.var('poll_start')::timestamptz - interval '2 days')::text);
select is((select answer_by from public.plans where id = tests.var('poll_plan')::uuid), tests.var('poll_start')::timestamptz - interval '2 days',
  'Plan aus der Abstimmung mit Frist');
select is((select starts_at from public.plans where id = tests.var('poll_plan')::uuid), tests.var('poll_start')::timestamptz, 'Beginn aus dem Gewinner-Termin');
select throws_ok($$ select public.create_plan_from_poll_with_answer_by(tests.var('poll')::uuid, tests.var('opt1')::uuid, null) $$,
  'P0001', 'plan_exists', 'kein zweiter Plan aus derselben Abstimmung');

select * from finish();
rollback;
