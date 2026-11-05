-- P24: Zusatz zur Antwort. Nur eigene Antwort, nur Mitglieder, nur mit Antwort, nicht bei abgeschlossenen
-- oder abgesagten Plänen; verfällt mit jeder Änderung der Antwort (auch „Alle neu fragen“); Export.
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

select tests.login('alice');
select tests.set_var('plan', public.create_plan(tests.var('crew')::uuid, 'Bowling', now() + interval '3 days', p_confirmed => true)::text);
select tests.set_var('done', public.create_plan(tests.var('crew')::uuid, 'Kino', now() + interval '1 day', p_confirmed => true)::text);
select public.set_attendance(tests.var('plan')::uuid, 'going');
select public.set_attendance(tests.var('done')::uuid, 'going');
select tests.login('bob');
select public.set_attendance(tests.var('plan')::uuid, 'going');

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.set_plan_answer_note(uuid, text)', 'execute'), 'anon schreibt keinen Zusatz');
select ok(has_function_privilege('authenticated', 'public.set_plan_answer_note(uuid, text)', 'execute'), 'angemeldete dürfen aufrufen');
select ok(not has_function_privilege('authenticated', 'app_private.plan_participant_note_reset()', 'execute'), 'Trigger-Funktion ist nicht aufrufbar');
select tests.logout();
select throws_ok($$ select public.set_plan_answer_note(tests.var('plan')::uuid, 'hallo') $$, '42501', null, 'ohne Konto: verboten');

-- ---- Angriffe ------------------------------------------------------------------------------------
select tests.login('mallory');
select throws_ok($$ select public.set_plan_answer_note(tests.var('plan')::uuid, 'hallo') $$, '42501', null, 'Außenstehende schreiben nichts');
select throws_ok($$ select public.set_plan_answer_note(gen_random_uuid(), 'hallo') $$, '42501', null, 'unbekannter Plan verrät nichts');
select is((select count(*)::int from public.plan_participants where plan_id = tests.var('plan')::uuid), 0,
  'Außenstehende sehen keine Antworten und keine Zusätze');
select throws_ok($$ update public.plan_participants set note = 'gehackt' where plan_id = tests.var('plan')::uuid $$, '42501', null,
  'kein direktes Schreiben an der Funktion vorbei');
-- Carol hat noch nicht geantwortet: kein Zusatz ohne Antwort.
select tests.login('carol');
select throws_ok($$ select public.set_plan_answer_note(tests.var('plan')::uuid, 'vielleicht später') $$, 'P0001', 'plan_note_no_answer',
  'ohne Antwort kein Zusatz');
select tests.logout();
select is((select count(*)::int from public.plan_participants where note is not null), 0, 'nach den Angriffen steht nirgends ein Zusatz');

-- ---- Zusatz setzen ------------------------------------------------------------------------------------
select tests.login('bob');
select is(public.set_plan_answer_note(tests.var('plan')::uuid, E'  komme   erst\num 21 Uhr  '), 'komme erst um 21 Uhr',
  'Leerzeichen und Umbrüche werden bereinigt');
select is(public.set_plan_answer_note(tests.var('plan')::uuid, repeat('x', 80)), repeat('x', 60), 'auf 60 Zeichen gekürzt');
select throws_ok($$ select public.set_plan_answer_note(tests.var('plan')::uuid, repeat('x', 201)) $$, 'P0001', 'invalid_input',
  'überlange Eingaben werden abgewiesen');
select public.set_plan_answer_note(tests.var('plan')::uuid, 'komme später');
select tests.login('carol');
select is((select note from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = tests.uid('bob')), 'komme später',
  'die Crew sieht Bobs Zusatz');
select tests.login('alice');
select public.set_plan_answer_note(tests.var('plan')::uuid, 'reserviere die Bahn');
select tests.logout();
select is((select note from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = tests.uid('bob')), 'komme später',
  'Alices Zusatz ändert nur ihre eigene Zeile');

-- Dieselbe Antwort noch einmal (z. B. doppelter Tipp) lässt den Zusatz stehen.
select tests.login('bob');
select public.set_attendance(tests.var('plan')::uuid, 'going');
select is((select note from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = tests.uid('bob')), 'komme später',
  'gleiche Antwort: Zusatz bleibt');
-- Andere Antwort: Zusatz ist weg.
select public.set_attendance(tests.var('plan')::uuid, 'maybe');
select is((select note from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = tests.uid('bob')), null,
  'neue Antwort: Zusatz verfällt');
select public.set_plan_answer_note(tests.var('plan')::uuid, 'sag bis mittags Bescheid');
select is(public.set_plan_answer_note(tests.var('plan')::uuid, '   '), null, 'leerer Zusatz entfernt ihn');
select public.set_plan_answer_note(tests.var('plan')::uuid, 'sag bis mittags Bescheid');

-- Datenexport enthält den eigenen Zusatz.
select is((select x ->> 'note' from jsonb_array_elements(public.export_my_data() -> 'plans') x
           where x ->> 'plan_id' = tests.var('plan')), 'sag bis mittags Bescheid', 'Zusatz steht im eigenen Datenexport');

-- „Alle neu fragen“ (P23): Antwort und Zusatz gelten für die alte Zeit.
select tests.login('alice');
select public.update_plan(tests.var('plan')::uuid, 'Bowling', now() + interval '4 days');
select public.ask_plan_again(tests.var('plan')::uuid);
select tests.logout();
select is((select attendance_status::text || '/' || coalesce(note, '-') from public.plan_participants
           where plan_id = tests.var('plan')::uuid and user_id = tests.uid('bob')), 'invited/-', 'neu gefragt: Bobs Zusatz ist weg');
select is((select note from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = tests.uid('alice')),
  'reserviere die Bahn', 'die eigene Antwort der Organisatorin bleibt mit Zusatz');
select tests.login('bob');
select throws_ok($$ select public.set_plan_answer_note(tests.var('plan')::uuid, 'komme später') $$, 'P0001', 'plan_note_no_answer',
  'nach „Alle neu fragen“ erst wieder antworten');

-- ---- Grenzen ------------------------------------------------------------------------------------
select tests.login('alice');
select public.set_plan_status(tests.var('done')::uuid, 'cancelled');
select throws_ok($$ select public.set_plan_answer_note(tests.var('done')::uuid, 'schade') $$, 'P0001', 'plan_locked',
  'abgesagte Pläne bleiben, wie sie sind');

-- Austritt: Wer die Crew verlässt, schreibt nichts mehr.
select tests.login('carol');
select public.set_attendance(tests.var('plan')::uuid, 'declined');
select public.set_plan_answer_note(tests.var('plan')::uuid, 'nächstes Mal!');
select public.leave_crew(tests.var('crew')::uuid);
select throws_ok($$ select public.set_plan_answer_note(tests.var('plan')::uuid, 'doch noch') $$, '42501', null,
  'nach dem Austritt kein Zusatz mehr');

-- Die Spalte selbst lässt keine überlangen oder leeren Werte zu.
select tests.logout();
select throws_ok($$ update public.plan_participants set note = '' where user_id = tests.uid('alice') $$, '23514', null, 'leerer Zusatz in der Tabelle unmöglich');
select throws_ok($$ update public.plan_participants set note = repeat('x', 61) where user_id = tests.uid('alice') $$, '23514', null, 'höchstens 60 Zeichen');

select * from finish();
rollback;
