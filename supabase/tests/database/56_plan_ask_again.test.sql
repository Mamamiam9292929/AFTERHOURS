-- P23: Neue Uhrzeit – alle neu fragen. Nur Organisator:in/Owner/Admin, nur vor Beginn, alte Antworten gehen
-- auf „eingeladen“ zurück (alte Antwort als Hinweis), eigene bleibt, Gäste fallen weg, keine doppelte
-- Benachrichtigung.
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
select tests.set_var('past', public.create_plan(tests.var('crew')::uuid, 'Kino', now() + interval '1 day', p_confirmed => true)::text);
select public.set_attendance(tests.var('plan')::uuid, 'going');
select tests.set_var('token', public.plan_share_token(tests.var('plan')::uuid));
select public.set_plan_guests(tests.var('plan')::uuid, true);

select tests.login('bob');
select public.set_attendance(tests.var('plan')::uuid, 'going');
select tests.login('carol');
select public.set_attendance(tests.var('plan')::uuid, 'declined');
-- Dave antwortet nicht.
select tests.login_anon();
select public.guest_rsvp_shared_plan(tests.var('token'), repeat('e', 64), 'Emil', 'going');

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.ask_plan_again(uuid)', 'execute'), 'anon fragt nicht neu');
select ok(has_function_privilege('authenticated', 'public.ask_plan_again(uuid)', 'execute'), 'angemeldete dürfen aufrufen (Rolle prüft die Funktion)');
select throws_ok($$ select public.ask_plan_again(tests.var('plan')::uuid) $$, '42501', null, 'ohne Konto: verboten');

-- ---- Angriffe ------------------------------------------------------------------------------------
select tests.login('mallory');
select throws_ok($$ select public.ask_plan_again(tests.var('plan')::uuid) $$, '42501', null, 'Außenstehende setzen keine Antworten zurück');
select throws_ok($$ select public.ask_plan_again(gen_random_uuid()) $$, '42501', null, 'unbekannter Plan verrät nichts');
select tests.login('bob');
select throws_ok($$ select public.ask_plan_again(tests.var('plan')::uuid) $$, '42501', null, 'einfache Mitglieder setzen keine Antworten zurück');
select tests.logout();
select is((select count(*)::int from public.plan_participants where plan_id = tests.var('plan')::uuid and attendance_status <> 'invited'), 3,
  'nach den Angriffen sind alle Antworten noch da');

-- ---- Verschieben und neu fragen ----------------------------------------------------------------------
select tests.login('alice');
select public.update_plan(tests.var('plan')::uuid, 'Bowling', now() + interval '4 days');
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'plan_changed' and related_entity_id = tests.var('plan')::uuid), 3,
  'update_plan benachrichtigt Bob, Carol und Dave');
select tests.login('alice');
select is(public.ask_plan_again(tests.var('plan')::uuid), 3, 'zwei Mitglieder mit Antwort und ein Gast werden neu gefragt');

select tests.logout();
select is((select attendance_status::text from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = tests.uid('alice')),
  'going', 'die eigene Antwort der Organisatorin bleibt');
select is((select attendance_status::text || '/' || previous_status::text from public.plan_participants
           where plan_id = tests.var('plan')::uuid and user_id = tests.uid('bob')), 'invited/going', 'Bob ist wieder offen, vorher dabei');
select is((select attendance_status::text || '/' || previous_status::text from public.plan_participants
           where plan_id = tests.var('plan')::uuid and user_id = tests.uid('carol')), 'invited/declined', 'Carol ist wieder offen, vorher abgesagt');
select is((select responded_at from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = tests.uid('bob')), null,
  'ohne Zeitpunkt der Antwort');
select is((select previous_status from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = tests.uid('dave')), null,
  'Dave hatte nicht geantwortet – kein alter Stand');
select is((select count(*)::int from public.plan_guests where plan_id = tests.var('plan')::uuid), 0, 'Gast-Antworten für die alte Zeit sind weg');
select is((select count(*)::int from public.notifications where type = 'plan_changed' and related_entity_id = tests.var('plan')::uuid), 3,
  'keine zweite Benachrichtigung');
select is((select count(*)::int from public.notifications where type = 'plan_changed' and related_entity_id = tests.var('plan')::uuid
           and (payload ->> 'asked_again')::boolean), 2, 'Bob und Carol werden ausdrücklich neu gefragt');
select is((select payload ->> 'asked_again' from public.notifications where type = 'plan_changed' and user_id = tests.uid('dave')), null,
  'Dave (ohne Antwort) bekommt nur „Plan geändert“');
select is((select count(*)::int from public.audit_log where action = 'plan_asked_again' and actor_id = tests.uid('alice')), 1, 'steht im Audit-Log');

-- Bob antwortet neu; Carol schon gelesen → beim nächsten Mal eine neue Benachrichtigung statt der alten.
select tests.login('bob');
select public.set_attendance(tests.var('plan')::uuid, 'maybe');
select tests.logout();
update public.notifications set read_at = now() where related_entity_id = tests.var('plan')::uuid;
select tests.login('alice');
select is(public.ask_plan_again(tests.var('plan')::uuid), 1, 'nur Bob hat seitdem geantwortet');
select tests.logout();
select is((select previous_status::text from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = tests.uid('bob')),
  'maybe', 'alter Stand ist die letzte Antwort');
select is((select count(*)::int from public.notifications where user_id = tests.uid('bob') and type = 'plan_changed'
           and read_at is null and (payload ->> 'asked_again')::boolean), 1, 'gelesene bleibt gelesen, Bob bekommt eine neue');

-- ---- Grenzen ------------------------------------------------------------------------------------
-- Owner/Admin dürfen auch Pläne anderer neu fragen.
select tests.login('bob');
select tests.set_var('bobs', public.create_plan(tests.var('crew')::uuid, 'Pizza', now() + interval '5 days', p_confirmed => true)::text);
select tests.login('carol');
select public.set_attendance(tests.var('bobs')::uuid, 'going');
select tests.login('alice');
select is(public.ask_plan_again(tests.var('bobs')::uuid), 2, 'Owner fragt beim Plan von Bob neu – auch Bob selbst, er hat nicht verschoben');

select tests.logout();
update public.plans set starts_at = now() - interval '1 hour' where id = tests.var('past')::uuid;
select tests.login('alice');
select throws_ok($$ select public.ask_plan_again(tests.var('past')::uuid) $$, 'P0001', 'plan_already_started', 'nach Beginn nicht mehr');
select tests.logout();
update public.plans set status = 'cancelled' where id = tests.var('bobs')::uuid;
select tests.login('alice');
select throws_ok($$ select public.ask_plan_again(tests.var('bobs')::uuid) $$, 'P0001', 'plan_locked', 'abgesagte Pläne bleiben, wie sie sind');

-- Der Hinweis-Wert ist nie „eingeladen“.
select tests.logout();
select throws_ok($$ update public.plan_participants set previous_status = 'invited' where user_id = tests.uid('bob') $$, '23514', null,
  'previous_status ist nie „eingeladen“');

select * from finish();
rollback;
