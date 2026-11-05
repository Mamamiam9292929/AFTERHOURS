-- P24 Etappe 2: Zusatz zur Gast-Antwort über den Teilen-Link. Nur mit eigenem Geheimnis und eigener Antwort,
-- nur solange Gäste erlaubt sind, nicht für Mitglieder; verfällt mit neuer Antwort; Crew sieht ihn,
-- Außenstehende nicht; kommt beim Übernehmen ins Konto mit.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Mallory');
select tests.make_user('Emil');

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew', '🎳')::text);
select tests.set_var('invite', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob');
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('mallory');
select public.create_crew('Fremde Crew');

select tests.login('alice');
select tests.set_var('plan', public.create_plan(tests.var('crew')::uuid, 'Bowling', now() + interval '3 days', p_confirmed => true)::text);
select tests.set_var('token', public.plan_share_token(tests.var('plan')::uuid));
select public.set_plan_guests(tests.var('plan')::uuid, true);

select tests.login_anon();
select public.guest_rsvp_shared_plan(tests.var('token'), repeat('e', 64), 'Emil', 'going');
select public.guest_rsvp_shared_plan(tests.var('token'), repeat('d', 64), 'Dana', 'maybe');

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(has_function_privilege('anon', 'public.guest_note_shared_plan(text, text, text)', 'execute'), 'Gäste ohne Konto dürfen aufrufen');

-- ---- Angriffe ------------------------------------------------------------------------------------
select throws_ok($$ select public.guest_note_shared_plan(repeat('0', 32), repeat('e', 64), 'hallo') $$, 'P0001', 'share_not_found',
  'geratener Link findet nichts');
select throws_ok($$ select public.guest_note_shared_plan('kein-token', repeat('e', 64), 'hallo') $$, 'P0001', 'share_not_found',
  'ungültiger Link findet nichts');
select throws_ok($$ select public.guest_note_shared_plan(tests.var('token'), repeat('f', 64), 'hallo') $$, 'P0001', 'plan_note_no_answer',
  'fremdes oder geratenes Geheimnis: kein Gast, kein Zusatz');
select throws_ok($$ select public.guest_note_shared_plan(tests.var('token'), 'kurz', 'hallo') $$, 'P0001', 'invalid_input',
  'ungültiges Geheimnis');
select throws_ok($$ select public.guest_note_shared_plan(tests.var('token'), repeat('e', 64), repeat('x', 201)) $$, 'P0001', 'invalid_input',
  'überlange Eingabe');
select throws_ok($$ update public.plan_guests set note = 'gehackt' $$, '42501', null, 'kein direktes Schreiben');
select tests.login('bob');
select throws_ok($$ select public.guest_note_shared_plan(tests.var('token'), repeat('b', 64), 'hallo') $$, 'P0001', 'plan_guest_member',
  'Mitglieder schreiben ihren Zusatz in der App');
select tests.logout();
select is((select count(*)::int from public.plan_guests where note is not null), 0, 'nach den Angriffen steht nirgends ein Zusatz');

-- ---- Zusatz setzen ------------------------------------------------------------------------------------
select tests.login_anon();
select is(public.guest_note_shared_plan(tests.var('token'), repeat('e', 64), E'  komme\n  später '), 'komme später', 'bereinigt gespeichert');
select is(public.shared_plan_rsvp(tests.var('token'), repeat('e', 64)) -> 'me' ->> 'note', 'komme später', 'Emil sieht seinen Zusatz auf der Karte');
select is(public.shared_plan_rsvp(tests.var('token'), repeat('d', 64)) -> 'me' ->> 'note', null, 'Dana sieht nur ihren eigenen (keinen)');
select is(public.shared_plan_rsvp(tests.var('token')) -> 'me', 'null'::jsonb, 'ohne Geheimnis kein „me“');
select tests.logout();
select is((select note from public.plan_guests where display_name = 'Dana'), null, 'Danas Antwort bleibt ohne Zusatz');

select tests.login('bob');
select is((select note from public.plan_guests where plan_id = tests.var('plan')::uuid and display_name = 'Emil'), 'komme später',
  'die Crew sieht den Zusatz');
select tests.login('mallory');
select is((select count(*)::int from public.plan_guests), 0, 'Außenstehende sehen keine Gäste und keine Zusätze');

-- Gleiche Antwort, anderer Name: Zusatz bleibt. Neue Antwort: Zusatz weg.
select tests.login_anon();
select public.guest_rsvp_shared_plan(tests.var('token'), repeat('e', 64), 'Emil K.', 'going');
select is(public.shared_plan_rsvp(tests.var('token'), repeat('e', 64)) -> 'me' ->> 'note', 'komme später', 'neuer Name: Zusatz bleibt');
select public.guest_rsvp_shared_plan(tests.var('token'), repeat('e', 64), 'Emil K.', 'maybe');
select is(public.shared_plan_rsvp(tests.var('token'), repeat('e', 64)) -> 'me' ->> 'note', null, 'neue Antwort: Zusatz verfällt');
select public.guest_note_shared_plan(tests.var('token'), repeat('e', 64), 'sag bis mittags Bescheid');
select is(public.guest_note_shared_plan(tests.var('token'), repeat('d', 64), ''), null, 'leerer Zusatz entfernt (hier: keiner da)');

-- ---- Ins Konto übernehmen: der Zusatz kommt mit ----------------------------------------------------------
select tests.login('emil');
select public.accept_crew_invitation(tests.var('invite'));
select is(public.claim_plan_guest(tests.var('plan')::uuid, repeat('e', 64), true) ->> 'status', 'maybe', 'Emil übernimmt seine Antwort');
select tests.logout();
select is((select attendance_status::text || '/' || coalesce(note, '-') from public.plan_participants
           where plan_id = tests.var('plan')::uuid and user_id = tests.uid('emil')), 'maybe/sag bis mittags Bescheid',
  'Antwort und Zusatz sind jetzt Emils eigene');

-- ---- Grenzen ------------------------------------------------------------------------------------
select tests.login('alice');
select public.set_plan_guests(tests.var('plan')::uuid, false);
select tests.login_anon();
select throws_ok($$ select public.guest_note_shared_plan(tests.var('token'), repeat('d', 64), 'hallo') $$, 'P0001', 'plan_guests_off',
  'ausgeschaltet: kein Zusatz mehr');
select tests.logout();
update public.plans set guests_allowed = true, status = 'cancelled' where id = tests.var('plan')::uuid;
select tests.login_anon();
select throws_ok($$ select public.guest_note_shared_plan(tests.var('token'), repeat('d', 64), 'hallo') $$, 'P0001', 'plan_locked',
  'abgesagt: kein Zusatz mehr');

select tests.logout();
select throws_ok($$ update public.plan_guests set note = repeat('x', 61) $$, '23514', null, 'höchstens 60 Zeichen');

select * from finish();
rollback;
