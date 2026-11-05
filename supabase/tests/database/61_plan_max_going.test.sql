-- P26: „Nur 6 Plätze“ – Höchstzahl mit Nachrückliste. Setzen nur durch Organisator:in, Owner, Admins, nur vor
-- Beginn, nicht unter den Zusagen und nicht unter der Mindestzahl; volle Runde nimmt keine Zusage mehr an (auch
-- nicht von Gästen); Nachrückliste in Reihenfolge, Nachrücken bei Absage, „Vielleicht“, Austritt, gelöschter
-- Gast-Antwort und mehr Plätzen; Benachrichtigung genau einmal; nichts nach Beginn oder bei abgesagten Plänen.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Carol');
select tests.make_user('Dave');
select tests.make_user('Erin');
select tests.make_user('Frank');
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
select tests.login('erin');
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('frank');
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('mallory');
select public.create_crew('Fremde Crew');

-- Bob legt den Plan an (Organisator, ist dabei); Alice ist Owner der Crew.
select tests.login('bob');
select tests.set_var('plan', public.create_plan(tests.var('crew')::uuid, 'Bowling', now() + interval '3 days', p_confirmed => true)::text);
select tests.set_var('token', public.plan_share_token(tests.var('plan')::uuid));
select public.set_plan_guests(tests.var('plan')::uuid, true);

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.set_plan_max_going(uuid, integer)', 'execute'), 'anon setzt keine Höchstzahl');
select ok(not has_function_privilege('anon', 'public.join_plan_waitlist(uuid)', 'execute'), 'anon kommt nicht auf die Liste');
select ok(not has_function_privilege('anon', 'public.leave_plan_waitlist(uuid)', 'execute'), 'anon verlässt keine Liste');
select ok(has_function_privilege('authenticated', 'public.set_plan_max_going(uuid, integer)', 'execute'), 'angemeldete dürfen aufrufen');
select ok(not has_function_privilege('authenticated', 'app_private.promote_plan_waitlist(uuid)', 'execute'), 'Nachrücken ist nicht direkt aufrufbar');
select ok(not has_function_privilege('authenticated', 'app_private.plan_capacity_guard()', 'execute'), 'Trigger-Funktion ist nicht aufrufbar');
select ok(not has_function_privilege('authenticated', 'app_private.plan_capacity_hold(uuid)', 'execute'), 'Sperr-Prüfung ist nicht aufrufbar');
select tests.logout();
select tests.login_anon();
select throws_ok($$ select public.set_plan_max_going(tests.var('plan')::uuid, 3) $$, '42501', null, 'ohne Konto: verboten');

-- ---- Angriffe ------------------------------------------------------------------------------------
select tests.login('mallory');
select throws_ok($$ select public.set_plan_max_going(tests.var('plan')::uuid, 3) $$, '42501', null, 'Außenstehende setzen nichts');
select throws_ok($$ select public.join_plan_waitlist(tests.var('plan')::uuid) $$, '42501', null, 'Außenstehende kommen nicht auf die Liste');
select throws_ok($$ select public.leave_plan_waitlist(tests.var('plan')::uuid) $$, '42501', null, 'Außenstehende: auch nicht runter');
select throws_ok($$ select public.set_plan_max_going(gen_random_uuid(), 3) $$, '42501', null, 'unbekannter Plan verrät nichts');
select tests.login('carol');
select throws_ok($$ select public.set_plan_max_going(tests.var('plan')::uuid, 3) $$, '42501', null, 'einfache Mitglieder setzen nichts');
select throws_ok($$ update public.plans set max_going = 2 where id = tests.var('plan')::uuid $$, '42501', null,
  'kein direktes Schreiben an der Funktion vorbei');
select throws_ok($$ update public.plan_participants set waitlisted_at = now() where plan_id = tests.var('plan')::uuid and user_id = auth.uid() $$,
  '42501', null, 'kein direktes Vordrängeln auf der Liste');
select tests.logout();
select is((select max_going from public.plans where id = tests.var('plan')::uuid), null, 'nach den Angriffen keine Höchstzahl');

-- ---- Eingaben ------------------------------------------------------------------------------------
select tests.login('bob');
select throws_ok($$ select public.set_plan_max_going(tests.var('plan')::uuid, 1) $$, 'P0001', 'invalid_input', 'mindestens 2');
select throws_ok($$ select public.set_plan_max_going(tests.var('plan')::uuid, 51) $$, 'P0001', 'invalid_input', 'höchstens 50');
select tests.login('carol');
select throws_ok($$ select public.join_plan_waitlist(tests.var('plan')::uuid) $$, 'P0001', 'plan_not_full', 'ohne Höchstzahl keine Liste');

-- Alice und Carol sagen zu: 3 dabei (Bob, Alice, Carol).
select tests.login('alice');
select public.set_attendance(tests.var('plan')::uuid, 'going');
select tests.login('carol');
select public.set_attendance(tests.var('plan')::uuid, 'going');
select tests.login('bob');
select throws_ok($$ select public.set_plan_max_going(tests.var('plan')::uuid, 2) $$, 'P0001', 'plan_max_below_going', 'nicht unter den Zusagen');
select public.set_plan_min_going(tests.var('plan')::uuid, 4);
select throws_ok($$ select public.set_plan_max_going(tests.var('plan')::uuid, 3) $$, 'P0001', 'plan_capacity_conflict', 'nicht unter der Mindestzahl');
select public.set_plan_min_going(tests.var('plan')::uuid, null);

-- ---- Voll ------------------------------------------------------------------------------------
select is(public.set_plan_max_going(tests.var('plan')::uuid, 4), 3, 'Organisator setzt „höchstens 4“, liefert die Zusagen (3)');
select throws_ok($$ select public.set_plan_min_going(tests.var('plan')::uuid, 5) $$, 'P0001', 'plan_capacity_conflict', 'Mindestzahl nicht über der Höchstzahl');
select tests.login('carol');
select is((select max_going::int from public.plans where id = tests.var('plan')::uuid), 4, 'die Crew sieht die Höchstzahl');
select tests.login('dave');
select throws_ok($$ select public.join_plan_waitlist(tests.var('plan')::uuid) $$, 'P0001', 'plan_not_full', 'noch Platz: keine Liste, einfach zusagen');

-- Ein Gast nimmt den letzten Platz (4 von 4).
select tests.login_anon();
select public.guest_rsvp_shared_plan(tests.var('token'), repeat('e', 64), 'Emil', 'going');
select tests.logout();
select is(app_private.plan_going_count(tests.var('plan')::uuid), 4, 'Gast zählt mit: voll');

select tests.login('dave');
select throws_ok($$ select public.set_attendance(tests.var('plan')::uuid, 'going') $$, 'P0001', 'plan_full', 'voll: keine Zusage mehr');
select tests.login_anon();
select throws_ok($$ select public.guest_rsvp_shared_plan(tests.var('token'), repeat('d', 64), 'Dana', 'going') $$, 'P0001', 'plan_full',
  'voll: auch Gäste nicht');
select lives_ok($$ select public.guest_rsvp_shared_plan(tests.var('token'), repeat('d', 64), 'Dana', 'maybe') $$, 'Gast darf „Vielleicht“');
select throws_ok($$ select public.guest_rsvp_shared_plan(tests.var('token'), repeat('d', 64), 'Dana', 'going') $$, 'P0001', 'plan_full',
  'voll: auch nicht von „Vielleicht“ auf „Dabei“');
select tests.login('alice');
select lives_ok($$ select public.set_attendance(tests.var('plan')::uuid, 'going') $$, 'wer dabei ist, bleibt dabei');

-- ---- Nachrückliste in Reihenfolge ------------------------------------------------------------------------------------
select tests.login('dave');
select public.set_attendance(tests.var('plan')::uuid, 'declined');
select is(public.join_plan_waitlist(tests.var('plan')::uuid), 1, 'Dave ist Erster auf der Liste');
select is((select attendance_status::text from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = auth.uid()), 'maybe',
  'auf der Liste: „Vielleicht“ statt Absage');
select is(public.join_plan_waitlist(tests.var('plan')::uuid), 1, 'noch einmal: Platz bleibt');
select tests.login('erin');
select is(public.join_plan_waitlist(tests.var('plan')::uuid), 2, 'Erin ist Zweite');
select tests.login('frank');
select is(public.join_plan_waitlist(tests.var('plan')::uuid), 3, 'Frank ist Dritter');
select public.leave_plan_waitlist(tests.var('plan')::uuid);
select tests.login('carol');
select throws_ok($$ select public.join_plan_waitlist(tests.var('plan')::uuid) $$, 'P0001', 'plan_waitlist_going', 'wer dabei ist, braucht keine Liste');
select is((select array_agg(p.display_name order by pp.waitlisted_at) from public.plan_participants pp join public.profiles p on p.id = pp.user_id
           where pp.plan_id = tests.var('plan')::uuid and pp.waitlisted_at is not null),
          array['Dave', 'Erin'], 'die Crew sieht die Liste in Reihenfolge – Frank ist runter');
select tests.login('mallory');
select is((select count(*)::int from public.plan_participants where plan_id = tests.var('plan')::uuid), 0, 'Außenstehende sehen keine Liste');

-- ---- Nachrücken ------------------------------------------------------------------------------------
-- Carol sagt ab: Dave rückt nach.
select tests.login('carol');
select public.set_attendance(tests.var('plan')::uuid, 'declined');
select tests.logout();
select is((select attendance_status::text from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = tests.uid('dave')),
  'going', 'Absage: Dave rückt nach');
select is((select waitlisted_at from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = tests.uid('dave')), null,
  'Dave steht nicht mehr auf der Liste');
select is((select count(*)::int from public.notifications where type = 'plan_waitlist_promoted' and user_id = tests.uid('dave')), 1,
  'Dave bekommt „Du bist nachgerückt“');
select is((select payload ->> 'title' from public.notifications where type = 'plan_waitlist_promoted' and user_id = tests.uid('dave')), 'Bowling',
  'Nachricht nennt den Plan');
select is((select count(*)::int from public.notifications where type = 'plan_waitlist_promoted' and user_id <> tests.uid('dave')), 0,
  'sonst niemand');
select is(app_private.plan_going_count(tests.var('plan')::uuid), 4, 'wieder genau voll');

-- Alice wechselt auf „Vielleicht“: Erin rückt nach.
select tests.login('alice');
select public.set_attendance(tests.var('plan')::uuid, 'maybe');
select tests.logout();
select is((select attendance_status::text from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = tests.uid('erin')),
  'going', '„Vielleicht“: Erin rückt nach');
select is((select count(*)::int from public.plan_participants where plan_id = tests.var('plan')::uuid and waitlisted_at is not null), 0,
  'Liste ist leer');

-- Genau einmal: Dave sagt ab, stellt sich wieder an und rückt erneut nach – keine zweite Nachricht.
select tests.login('dave');
select public.set_attendance(tests.var('plan')::uuid, 'declined');
select tests.login('frank');
select public.set_attendance(tests.var('plan')::uuid, 'going');
select tests.login('dave');
select is(public.join_plan_waitlist(tests.var('plan')::uuid), 1, 'Dave stellt sich wieder an');
select tests.login('frank');
select public.set_attendance(tests.var('plan')::uuid, 'declined');
select tests.logout();
select is((select attendance_status::text from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = tests.uid('dave')),
  'going', 'Dave rückt erneut nach');
select is((select count(*)::int from public.notifications where type = 'plan_waitlist_promoted' and user_id = tests.uid('dave')), 1,
  'genau einmal je Plan und Person');

-- Gast-Antwort gelöscht: Platz frei, Alice (auf der Liste) rückt nach.
select tests.login('alice');
select is(public.join_plan_waitlist(tests.var('plan')::uuid), 1, 'Alice auf der Liste');
select tests.login_anon();
select public.guest_rsvp_shared_plan(tests.var('token'), repeat('e', 64), 'Emil', null);
select tests.logout();
select is((select attendance_status::text from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = tests.uid('alice')),
  'going', 'Gast zieht zurück: Alice rückt nach');

-- Austritt aus der Crew: Platz frei, Frank rückt nach.
select tests.login('frank');
select public.set_attendance(tests.var('plan')::uuid, 'maybe');
select is(public.join_plan_waitlist(tests.var('plan')::uuid), 1, 'Frank auf der Liste');
select tests.login('erin');
select public.leave_crew(tests.var('crew')::uuid);
select tests.logout();
select is((select attendance_status::text from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = tests.uid('frank')),
  'going', 'Austritt: Frank rückt nach');

-- Absage von der Liste: runter von der Liste.
select tests.login('carol');
select public.set_attendance(tests.var('plan')::uuid, 'maybe');
select is(public.join_plan_waitlist(tests.var('plan')::uuid), 1, 'Carol auf der Liste');
select public.set_attendance(tests.var('plan')::uuid, 'declined');
select tests.logout();
select is((select waitlisted_at from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = tests.uid('carol')), null,
  'Absage: nicht mehr auf der Liste');

-- Mehr Plätze: die Liste rückt nach.
select tests.login('carol');
select public.set_attendance(tests.var('plan')::uuid, 'maybe');
select public.join_plan_waitlist(tests.var('plan')::uuid);
select tests.login('bob');
select is(public.set_plan_max_going(tests.var('plan')::uuid, 5), 5, 'höchstens 5: Carol rückt nach, liefert 5');
select tests.logout();
select is((select attendance_status::text from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = tests.uid('carol')),
  'going', 'mehr Plätze: Carol ist dabei');
select is((select count(*)::int from public.audit_log where action = 'plan_max_going_set' and entity_id = tests.var('plan')::uuid), 2,
  'jede Änderung im Protokoll');

-- ---- Gast-Antwort übernehmen bei voller Runde ------------------------------------------------------------------------------------
-- Dana (Gast) sagt zu, als ein Platz frei wird; danach übernimmt Mallory nicht (fremd), aber ein neues Mitglied schon.
select tests.login('bob');
select public.set_plan_max_going(tests.var('plan')::uuid, 6);
select tests.login_anon();
select public.guest_rsvp_shared_plan(tests.var('token'), repeat('d', 64), 'Dana', 'going');
select tests.logout();
select is(app_private.plan_going_count(tests.var('plan')::uuid), 6, 'Dana nimmt den letzten Platz');
select tests.make_user('Dana');
select tests.login('dana');
select public.accept_crew_invitation(tests.var('invite'));
select is((public.claim_plan_guest(tests.var('plan')::uuid, repeat('d', 64), true) ->> 'claimed'), 'true',
  'volle Runde: Dana übernimmt ihren Platz als Mitglied');
select tests.logout();
select is((select attendance_status::text from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = tests.uid('dana')),
  'going', 'Dana ist dabei');
select is(app_private.plan_going_count(tests.var('plan')::uuid), 6, 'kein Platz doppelt');

-- ---- Alle neu fragen ------------------------------------------------------------------------------------
select tests.login('erin');
select public.accept_crew_invitation(tests.var('invite'));
select public.set_attendance(tests.var('plan')::uuid, 'maybe');
select public.join_plan_waitlist(tests.var('plan')::uuid);
select tests.login('bob');
select public.ask_plan_again(tests.var('plan')::uuid);
select tests.logout();
select is((select count(*)::int from public.plan_participants where plan_id = tests.var('plan')::uuid and attendance_status = 'going'), 1,
  'neu gefragt: niemand rückt automatisch nach (nur Bob bleibt dabei)');
select is((select count(*)::int from public.plan_participants where plan_id = tests.var('plan')::uuid and waitlisted_at is not null), 0,
  'neu gefragt: Liste ist leer');
select is((select count(*)::int from public.notifications where type = 'plan_waitlist_promoted' and user_id = tests.uid('erin')), 1,
  'Erin bekommt keine weitere Nachrück-Nachricht (nur die vom ersten Nachrücken)');

-- Keine Grenze mehr: alle auf der Liste rücken nach.
select tests.login('bob');
select public.set_plan_max_going(tests.var('plan')::uuid, 2);
select tests.login('carol');
select public.set_attendance(tests.var('plan')::uuid, 'going');
select tests.login('alice');
select public.set_attendance(tests.var('plan')::uuid, 'maybe');
select public.join_plan_waitlist(tests.var('plan')::uuid);
select tests.login('dave');
select public.join_plan_waitlist(tests.var('plan')::uuid);
select tests.login('bob');
select is(public.set_plan_max_going(tests.var('plan')::uuid, null), 4, 'keine Höchstzahl mehr: Alice und Dave rücken nach');

-- ---- Abgeschaltete Gruppe ------------------------------------------------------------------------------------
select tests.logout();
update public.user_settings set notification_preferences = '{"plan_waitlist_promoted": false}' where user_id = tests.uid('frank');
select tests.login('alice');
select tests.set_var('other', public.create_plan(tests.var('crew')::uuid, 'Kino', now() + interval '2 days', p_confirmed => true)::text);
select public.set_plan_max_going(tests.var('other')::uuid, 2);
select tests.login('carol');
select public.set_attendance(tests.var('other')::uuid, 'going');
select tests.login('frank');
select public.join_plan_waitlist(tests.var('other')::uuid);
select tests.login('carol');
select public.set_attendance(tests.var('other')::uuid, 'declined');
select tests.logout();
select is((select attendance_status::text from public.plan_participants where plan_id = tests.var('other')::uuid and user_id = tests.uid('frank')),
  'going', 'abgeschaltet: Frank rückt trotzdem nach');
select is((select count(*)::int from public.notifications where type = 'plan_waitlist_promoted' and related_entity_id = tests.var('other')::uuid), 0,
  'abgeschaltet: keine Nachricht');

-- ---- Nach Beginn, abgesagt ------------------------------------------------------------------------------------
select tests.login('dave');
select public.join_plan_waitlist(tests.var('other')::uuid);
select tests.logout();
update public.plans set starts_at = now() - interval '1 hour' where id = tests.var('other')::uuid;
select tests.login('frank');
select public.set_attendance(tests.var('other')::uuid, 'declined');
select tests.logout();
select is((select attendance_status::text from public.plan_participants where plan_id = tests.var('other')::uuid and user_id = tests.uid('dave')),
  'maybe', 'nach Beginn: niemand rückt mehr nach');
select tests.login('alice');
select throws_ok($$ select public.set_plan_max_going(tests.var('other')::uuid, 5) $$, 'P0001', 'plan_max_going_started', 'nach Beginn nicht mehr');
select tests.login('erin');
select throws_ok($$ select public.join_plan_waitlist(tests.var('other')::uuid) $$, 'P0001', 'plan_waitlist_started', 'nach Beginn keine Liste');
select tests.login('alice');
select public.set_plan_status(tests.var('plan')::uuid, 'cancelled');
select throws_ok($$ select public.set_plan_max_going(tests.var('plan')::uuid, 5) $$, 'P0001', 'plan_locked', 'abgesagt: nicht mehr');

-- Die Spalten lassen nur Gültiges zu.
select tests.logout();
select throws_ok($$ update public.plans set max_going = 1 where id = tests.var('plan')::uuid $$, '23514', null, 'Spalte: mindestens 2');
select throws_ok($$ update public.plans set min_going = 4, max_going = 3 where id = tests.var('plan')::uuid $$, 'P0001', 'plan_capacity_conflict',
  'Spalten: Mindestzahl nicht über Höchstzahl');

select * from finish();
rollback;
