-- P46: „Sagt bis Donnerstag Bescheid“ – Antwortfrist für Pläne. Setzen nur durch Organisator:in, Owner, Admins,
-- nur vor Beginn, nicht bei abgeschlossenen/abgesagten Plänen; Frist in der Zukunft und spätestens 1 h vor Beginn;
-- beim Verschieben fällt eine Frist weg, die nicht mehr passt; die Frist sperrt keine Antwort.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Carol');
select tests.make_user('Mallory');

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew', '🎳')::text);
select tests.set_var('invite', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob');
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('carol');
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('mallory');
select public.create_crew('Fremde Crew');

-- Bob legt den Plan an (Organisator); Alice ist Owner der Crew.
select tests.login('bob');
select tests.set_var('plan', public.create_plan(tests.var('crew')::uuid, 'Bowling', now() + interval '3 days', p_confirmed => true)::text);
select tests.set_var('at', (now() + interval '2 days')::text);

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.set_plan_answer_by(uuid, timestamptz)', 'execute'), 'anon setzt keine Frist');
select ok(has_function_privilege('authenticated', 'public.set_plan_answer_by(uuid, timestamptz)', 'execute'), 'angemeldete dürfen aufrufen');
select ok(not has_function_privilege('authenticated', 'app_private.plan_answer_by_guard()', 'execute'), 'Trigger-Funktion ist nicht aufrufbar');
select tests.logout();
select tests.login_anon();
select throws_ok($$ select public.set_plan_answer_by(tests.var('plan')::uuid, tests.var('at')::timestamptz) $$, '42501', null, 'ohne Konto: verboten');

-- ---- Angriffe ------------------------------------------------------------------------------------
select tests.login('mallory');
select throws_ok($$ select public.set_plan_answer_by(tests.var('plan')::uuid, tests.var('at')::timestamptz) $$, '42501', null, 'Außenstehende setzen nichts');
select throws_ok($$ select public.set_plan_answer_by(gen_random_uuid(), tests.var('at')::timestamptz) $$, '42501', null, 'unbekannter Plan verrät nichts');
select is((select count(*)::int from public.plans where id = tests.var('plan')::uuid), 0, 'Außenstehende sehen den Plan (und die Frist) nicht');
select tests.login('carol');
select throws_ok($$ select public.set_plan_answer_by(tests.var('plan')::uuid, tests.var('at')::timestamptz) $$, '42501', null, 'einfache Mitglieder setzen nichts');
select throws_ok($$ update public.plans set answer_by = tests.var('at')::timestamptz where id = tests.var('plan')::uuid $$, '42501', null,
  'kein direktes Schreiben an der Funktion vorbei');
select tests.logout();
select is((select answer_by from public.plans where id = tests.var('plan')::uuid), null, 'nach den Angriffen keine Frist');

-- ---- Eingaben ------------------------------------------------------------------------------------
select tests.login('bob');
select throws_ok($$ select public.set_plan_answer_by(tests.var('plan')::uuid, now() - interval '1 minute') $$, 'P0001', 'plan_answer_by_invalid', 'nicht in der Vergangenheit');
select throws_ok($$ select public.set_plan_answer_by(tests.var('plan')::uuid, now() + interval '3 days' - interval '30 minutes') $$, 'P0001', 'plan_answer_by_invalid',
  'nicht weniger als 1 h vor Beginn');
select throws_ok($$ select public.set_plan_answer_by(tests.var('plan')::uuid, now() + interval '4 days') $$, 'P0001', 'plan_answer_by_invalid', 'nicht nach Beginn');

-- ---- Setzen ------------------------------------------------------------------------------------
select is(public.set_plan_answer_by(tests.var('plan')::uuid, tests.var('at')::timestamptz), tests.var('at')::timestamptz, 'Organisator setzt die Frist, liefert sie zurück');
select tests.login('carol');
select is((select answer_by from public.plans where id = tests.var('plan')::uuid), tests.var('at')::timestamptz, 'die Crew sieht die Frist');
select tests.logout();
select is((select count(*)::int from public.audit_log where action = 'plan_answer_by_set' and entity_id = tests.var('plan')::uuid), 1, 'im Protokoll');
select tests.login('bob');
select public.set_plan_answer_by(tests.var('plan')::uuid, tests.var('at')::timestamptz);
select tests.logout();
select is((select count(*)::int from public.audit_log where action = 'plan_answer_by_set' and entity_id = tests.var('plan')::uuid), 1, 'gleiche Frist: kein neuer Eintrag');

-- Owner (nicht Organisator) darf ändern, entfernen und wieder setzen.
select tests.login('alice');
select is(public.set_plan_answer_by(tests.var('plan')::uuid, null), null, 'Owner entfernt die Frist');
select is((select answer_by from public.plans where id = tests.var('plan')::uuid), null, 'Frist weg');
select public.set_plan_answer_by(tests.var('plan')::uuid, tests.var('at')::timestamptz);
select is((select answer_by from public.plans where id = tests.var('plan')::uuid), tests.var('at')::timestamptz, 'Owner setzt sie wieder');

-- ---- Keine Sperre ------------------------------------------------------------------------------------
-- Auch nach Ablauf darf man antworten (Frist künstlich in die Vergangenheit gelegt).
select tests.logout();
update public.plans set answer_by = now() - interval '1 hour' where id = tests.var('plan')::uuid;
select tests.login('carol');
select lives_ok($$ select public.set_attendance(tests.var('plan')::uuid, 'going') $$, 'nach Ablauf der Frist lässt sich weiter antworten');
select is((select attendance_status::text from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = tests.uid('carol')),
  'going', 'Antwort gespeichert');

-- ---- Verschieben ------------------------------------------------------------------------------------
select tests.login('bob');
select public.set_plan_answer_by(tests.var('plan')::uuid, tests.var('at')::timestamptz);
select public.update_plan(tests.var('plan')::uuid, 'Bowling', now() + interval '5 days');
select is((select answer_by from public.plans where id = tests.var('plan')::uuid), tests.var('at')::timestamptz, 'später verschoben: Frist bleibt');
select public.update_plan(tests.var('plan')::uuid, 'Bowling', tests.var('at')::timestamptz + interval '30 minutes');
select is((select answer_by from public.plans where id = tests.var('plan')::uuid), null, 'so früh verschoben, dass die Frist nicht mehr 1 h vorher liegt: sie fällt weg');

-- ---- Gesperrte Pläne ------------------------------------------------------------------------------------
select public.update_plan(tests.var('plan')::uuid, 'Bowling', now() + interval '3 days');
select public.set_plan_status(tests.var('plan')::uuid, 'cancelled');
select throws_ok($$ select public.set_plan_answer_by(tests.var('plan')::uuid, tests.var('at')::timestamptz) $$, 'P0001', 'plan_locked', 'abgesagt: keine Frist mehr');

select tests.set_var('started', public.create_plan(tests.var('crew')::uuid, 'Kino', now() + interval '2 days', p_confirmed => true)::text);
select tests.logout();
update public.plans set starts_at = now() - interval '10 minutes' where id = tests.var('started')::uuid;
select tests.login('bob');
select throws_ok($$ select public.set_plan_answer_by(tests.var('started')::uuid, null) $$, 'P0001', 'plan_answer_by_started', 'nach Beginn: keine Änderung');

select * from finish();
rollback;
