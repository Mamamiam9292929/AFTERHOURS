-- P29: „Wie war’s?“ – Urteil nach dem Abend. Nur Mitglieder mit „Bin dabei“, nur nach dem Abschluss und
-- höchstens 30 Tage danach; die Crew sieht nur Zahlen, nie wer was gesagt hat; Außenstehende und anon nichts;
-- kein direktes Lesen oder Schreiben an den Funktionen vorbei; Export und Kontolöschung.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Carol');
select tests.make_user('Dave');
select tests.make_user('Mallory');

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew', '🎳')::text);
select tests.set_var('invite', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob');
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('carol');
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('dave');
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('mallory');
select public.create_crew('Fremde Crew');

select tests.login('alice');
select tests.set_var('plan', public.create_plan(tests.var('crew')::uuid, 'Bowling', now() + interval '3 days', p_confirmed => true)::text);
select tests.set_var('old', public.create_plan(tests.var('crew')::uuid, 'Kino', now() + interval '3 days', p_confirmed => true)::text);
select public.set_attendance(tests.var('plan')::uuid, 'going');
select public.set_attendance(tests.var('old')::uuid, 'going');
select tests.login('bob');
select public.set_attendance(tests.var('plan')::uuid, 'going');
select tests.login('carol');
select public.set_attendance(tests.var('plan')::uuid, 'going');
select tests.login('dave');
select public.set_attendance(tests.var('plan')::uuid, 'declined');

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.set_plan_feedback(uuid, text)', 'execute'), 'anon gibt kein Urteil ab');
select ok(not has_function_privilege('anon', 'public.plan_feedback_summary(uuid)', 'execute'), 'anon liest keine Urteile');
select ok(has_function_privilege('authenticated', 'public.set_plan_feedback(uuid, text)', 'execute'), 'angemeldete dürfen urteilen');
select ok(has_function_privilege('authenticated', 'public.plan_feedback_summary(uuid)', 'execute'), 'angemeldete dürfen Zahlen abfragen');
select ok(not has_function_privilege('authenticated', 'app_private.plan_feedback_open(public.plans)', 'execute'), 'interne Prüfung ist nicht aufrufbar');
select ok(not has_table_privilege('authenticated', 'public.plan_feedback', 'select'), 'Urteile sind nicht direkt lesbar');
select ok(not has_table_privilege('authenticated', 'public.plan_feedback', 'insert'), 'Urteile sind nicht direkt schreibbar');
select tests.logout();
select throws_ok($$ select public.set_plan_feedback(tests.var('plan')::uuid, 'again') $$, '42501', null, 'ohne Konto: verboten');

-- ---- Vor dem Abschluss ------------------------------------------------------------------------------------
select tests.login('bob');
select throws_ok($$ select public.set_plan_feedback(tests.var('plan')::uuid, 'again') $$, 'P0001', 'plan_feedback_closed',
  'vor dem Abschluss gibt es noch kein Urteil');
select is(public.plan_feedback_summary(tests.var('plan')::uuid) ->> 'open', 'false', 'Zahlen melden: noch nicht offen');
select is(public.plan_feedback_summary(tests.var('plan')::uuid) ->> 'can_answer', 'false', 'und niemand kann antworten');

-- Abend vorbei, Alice schließt ab.
select tests.logout();
update public.plans set starts_at = now() - interval '3 hours' where id in (tests.var('plan')::uuid, tests.var('old')::uuid);
select tests.login('alice');
select public.set_plan_status(tests.var('plan')::uuid, 'completed');
select public.set_plan_status(tests.var('old')::uuid, 'completed');

-- ---- Angriffe ------------------------------------------------------------------------------------
select tests.login('mallory');
select throws_ok($$ select public.set_plan_feedback(tests.var('plan')::uuid, 'meh') $$, '42501', null, 'Außenstehende urteilen nicht');
select throws_ok($$ select public.plan_feedback_summary(tests.var('plan')::uuid) $$, '42501', null, 'Außenstehende sehen keine Zahlen');
select throws_ok($$ select public.set_plan_feedback(gen_random_uuid(), 'again') $$, '42501', null, 'unbekannter Plan verrät nichts');
select throws_ok($$ select public.plan_feedback_summary(gen_random_uuid()) $$, '42501', null, 'unbekannter Plan: keine Zahlen');
select throws_ok($$ select * from public.plan_feedback $$, '42501', null, 'kein direktes Lesen');
select throws_ok($$ insert into public.plan_feedback (plan_id, user_id, verdict) values (tests.var('plan')::uuid, tests.uid('mallory'), 'meh') $$,
  '42501', null, 'kein direktes Schreiben');
-- Dave war nicht dabei.
select tests.login('dave');
select throws_ok($$ select public.set_plan_feedback(tests.var('plan')::uuid, 'meh') $$, 'P0001', 'plan_feedback_not_going',
  'wer nicht dabei war, urteilt nicht');
select is(public.plan_feedback_summary(tests.var('plan')::uuid) ->> 'can_answer', 'false', 'Dave kann nicht antworten');
select is(public.plan_feedback_summary(tests.var('plan')::uuid) ->> 'open', 'true', 'aber der Plan ist offen für Urteile');
select tests.login('bob');
select throws_ok($$ select public.set_plan_feedback(tests.var('plan')::uuid, 'super') $$, 'P0001', 'invalid_plan_feedback',
  'nur again, ok oder meh');
select tests.logout();
select is((select count(*)::int from public.plan_feedback), 0, 'nach den Angriffen steht kein Urteil');

-- ---- Urteilen ------------------------------------------------------------------------------------
select tests.login('bob');
select is(public.plan_feedback_summary(tests.var('plan')::uuid) ->> 'can_answer', 'true', 'Bob war dabei und kann antworten');
select lives_ok($$ select public.set_plan_feedback(tests.var('plan')::uuid, 'again') $$, 'Bob: „Nochmal!“');
select tests.login('carol');
select lives_ok($$ select public.set_plan_feedback(tests.var('plan')::uuid, 'meh') $$, 'Carol: „Eher nicht“');
select tests.login('alice');
select lives_ok($$ select public.set_plan_feedback(tests.var('plan')::uuid, 'again') $$, 'Alice: „Nochmal!“');
select is(public.plan_feedback_summary(tests.var('plan')::uuid) - 'open' - 'can_answer',
  '{"again": 2, "ok": 0, "meh": 1, "mine": "again"}'::jsonb, 'Zahlen und die eigene Antwort');
select tests.login('dave');
select is(public.plan_feedback_summary(tests.var('plan')::uuid) - 'open' - 'can_answer',
  '{"again": 2, "ok": 0, "meh": 1, "mine": null}'::jsonb, 'Dave sieht dieselben Zahlen, aber keine Namen');
select ok(not (public.plan_feedback_summary(tests.var('plan')::uuid)::text ~* (tests.uid('carol')::text || '|carol')),
  'die Zahlen verraten nicht, wer was gesagt hat');

-- Umentscheiden und zurückziehen.
select tests.login('carol');
select public.set_plan_feedback(tests.var('plan')::uuid, 'ok');
select is((public.plan_feedback_summary(tests.var('plan')::uuid) ->> 'meh')::int, 0, 'umentschieden: kein „Eher nicht“ mehr');
select is((public.plan_feedback_summary(tests.var('plan')::uuid) ->> 'ok')::int, 1, '… dafür „War okay“');
select public.set_plan_feedback(tests.var('plan')::uuid, 'ok');
select tests.logout();
select is((select count(*)::int from public.plan_feedback where user_id = tests.uid('carol')), 1, 'gleiche Antwort noch einmal: eine Zeile');
select tests.login('carol');
select public.set_plan_feedback(tests.var('plan')::uuid, null);
select is(public.plan_feedback_summary(tests.var('plan')::uuid) ->> 'mine', null, 'zurückgezogen: keine eigene Antwort');
select is((public.plan_feedback_summary(tests.var('plan')::uuid) ->> 'ok')::int, 0, 'und nicht mehr gezählt');
select public.set_plan_feedback(tests.var('plan')::uuid, 'ok');

-- Datenexport enthält das eigene Urteil, nicht das der anderen.
select is((select x ->> 'verdict' from jsonb_array_elements(public.export_my_data() -> 'plan_feedback') x
           where x ->> 'plan_id' = tests.var('plan')), 'ok', 'Urteil steht im eigenen Datenexport');
select is(jsonb_array_length(public.export_my_data() -> 'plan_feedback'), 1, 'nur das eigene');

-- ---- Grenzen ------------------------------------------------------------------------------------
-- Länger als 30 Tage her: Zahlen bleiben, antworten geht nicht mehr.
select tests.logout();
update public.plans set completed_at = now() - interval '31 days' where id = tests.var('old')::uuid;
select tests.login('alice');
select throws_ok($$ select public.set_plan_feedback(tests.var('old')::uuid, 'again') $$, 'P0001', 'plan_feedback_closed',
  'nach 30 Tagen ist Schluss');
select is(public.plan_feedback_summary(tests.var('old')::uuid) ->> 'can_answer', 'false', 'alter Plan: nicht mehr antworten');

-- Abgesagte Pläne bekommen kein Urteil.
select tests.set_var('cancelled', public.create_plan(tests.var('crew')::uuid, 'Billard', now() + interval '2 days', p_confirmed => true)::text);
select public.set_attendance(tests.var('cancelled')::uuid, 'going');
select public.set_plan_status(tests.var('cancelled')::uuid, 'cancelled');
select throws_ok($$ select public.set_plan_feedback(tests.var('cancelled')::uuid, 'meh') $$, 'P0001', 'plan_feedback_closed',
  'abgesagt: kein Urteil');

-- Austritt: Wer die Crew verlässt, urteilt nicht mehr und sieht keine Zahlen.
select tests.login('bob');
select public.leave_crew(tests.var('crew')::uuid);
select throws_ok($$ select public.set_plan_feedback(tests.var('plan')::uuid, 'ok') $$, '42501', null, 'nach dem Austritt kein Urteil');
select throws_ok($$ select public.plan_feedback_summary(tests.var('plan')::uuid) $$, '42501', null, 'und keine Zahlen');

-- Kontolöschung nimmt die eigenen Urteile mit.
select tests.login('carol');
select lives_ok($$ select public.delete_my_account('DELETE') $$, 'Carol löscht ihr Konto');
select tests.logout();
select is((select count(*)::int from public.plan_feedback where user_id = tests.uid('carol')), 0, 'Kontolöschung löscht die eigenen Urteile');
select is((select count(*)::int from public.plan_feedback where plan_id = tests.var('plan')::uuid), 1, 'Alices Urteil bleibt');

select * from finish();
rollback;
