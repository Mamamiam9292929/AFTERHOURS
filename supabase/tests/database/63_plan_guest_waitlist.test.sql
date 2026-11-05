-- P26 Etappe 3b: Freunde ohne Konto stellen sich über den Teilen-Link auf dieselbe Nachrückliste wie die Crew.
-- Geprüft: nur bei voller Runde, nur mit Geheimnis und Namen, nicht für Mitglieder, nicht nach Beginn oder bei
-- abgesagten Plänen; gemeinsame Reihenfolge (Gast vor Mitglied zählt mit), Nachrücken eines Gasts mit Hinweis
-- auf der Karte und Nachricht an die Organisatorin, Hinweis weg bei eigener Änderung, von der Liste gehen,
-- Platz bleibt bei Übernahme ins Konto, Gäste rücken bei ausgeschalteten Gast-Zusagen nicht nach; Außenstehende
-- sehen die Liste nicht.
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
select tests.login('mallory');
select public.create_crew('Fremde Crew');

select tests.login('alice');
select tests.set_var('plan', public.create_plan(tests.var('crew')::uuid, 'Bowling', now() + interval '3 days', p_confirmed => true)::text);
select tests.set_var('token', public.plan_share_token(tests.var('plan')::uuid));
select public.set_plan_guests(tests.var('plan')::uuid, true);
select public.set_plan_max_going(tests.var('plan')::uuid, 3);
select tests.login('bob');
select public.set_attendance(tests.var('plan')::uuid, 'going');

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(has_function_privilege('anon', 'public.guest_waitlist_shared_plan(text, text, text, boolean)', 'execute'), 'ohne Konto aufrufbar');
select ok(not has_function_privilege('anon', 'app_private.plan_waitlist_position(uuid, uuid, uuid)', 'execute'), 'Positionsrechnung bleibt intern');
select ok(not has_function_privilege('authenticated', 'app_private.plan_waitlist_queue(uuid)', 'execute'), 'Liste bleibt intern');
select ok(not has_column_privilege('authenticated', 'public.plan_guests', 'promoted_at', 'select'), 'Hinweis „nachgerückt“ nur über die Karte');

-- ---- Noch Platz ------------------------------------------------------------------------------------
select tests.login_anon();
select throws_ok($$ select public.guest_waitlist_shared_plan(tests.var('token'), repeat('f', 64), 'Fritz', true) $$, 'P0001', 'plan_not_full',
  'noch Platz: keine Liste, einfach zusagen');
select public.guest_rsvp_shared_plan(tests.var('token'), repeat('e', 64), 'Emil', 'going');
select is((public.preview_shared_plan(tests.var('token')) -> 'plan' ->> 'going_count')::int, 3, 'voll: 3 von 3');

-- ---- Eingaben ------------------------------------------------------------------------------------
select throws_ok($$ select public.guest_waitlist_shared_plan(tests.var('token'), repeat('d', 64), null, true) $$, 'P0001', 'invalid_name', 'neu: Name nötig');
select throws_ok($$ select public.guest_waitlist_shared_plan(tests.var('token'), repeat('d', 64), ' x ', true) $$, 'P0001', 'invalid_name', 'Name zu kurz');
select throws_ok($$ select public.guest_waitlist_shared_plan(tests.var('token'), 'abc', 'Dana', true) $$, 'P0001', 'invalid_input', 'Geheimnis falsch');
select throws_ok($$ select public.guest_waitlist_shared_plan(tests.var('token'), repeat('d', 64), 'Dana', null) $$, 'P0001', 'invalid_input', 'ohne Richtung');
select throws_ok($$ select public.guest_waitlist_shared_plan('nichtda', repeat('d', 64), 'Dana', true) $$, 'P0001', 'share_not_found', 'unbekannter Link');
select throws_ok($$ select public.guest_waitlist_shared_plan(tests.var('token'), repeat('e', 64), 'Emil', true) $$, 'P0001', 'plan_waitlist_going',
  'wer dabei ist, braucht keine Liste');

-- ---- Gemeinsame Reihenfolge ------------------------------------------------------------------------------------
select is(public.guest_waitlist_shared_plan(tests.var('token'), repeat('d', 64), '  Dana  ', true), 1, 'Dana (Gast) ist Erste');
select is(public.shared_plan_rsvp(tests.var('token'), repeat('d', 64)) -> 'me', '{"name": "Dana", "status": "maybe", "waitlist": 1}'::jsonb,
  'Dana sieht ihren Platz auf der Karte');
select is(public.guest_waitlist_shared_plan(tests.var('token'), repeat('d', 64), null, true), 1, 'noch einmal: Platz bleibt');
select is(public.shared_plan_rsvp(tests.var('token'), repeat('e', 64)) -> 'me', '{"name": "Emil", "status": "going"}'::jsonb,
  'wer nicht auf der Liste steht: Karte wie bisher');

select tests.login('carol');
select is(public.join_plan_waitlist(tests.var('plan')::uuid), 2, 'Carol (Mitglied) ist Zweite – der Gast davor zählt mit');
select throws_ok($$ select public.guest_waitlist_shared_plan(tests.var('token'), repeat('c', 64), 'Carol', true) $$, 'P0001', 'plan_guest_member',
  'Mitglieder nehmen die App');

select tests.login('dave');  -- Konto, aber (noch) nicht in der Crew: darf als Gast
select is(public.guest_waitlist_shared_plan(tests.var('token'), repeat('a', 64), 'Dave', true), 3, 'Dave (Gast) ist Dritter');

select tests.login('mallory');
select is((select count(*)::int from public.plan_guests where plan_id = tests.var('plan')::uuid), 0, 'Außenstehende sehen keine Gäste und keine Liste');

select tests.login('bob');
select is((select array_agg(display_name order by waitlisted_at) from public.plan_guests
           where plan_id = tests.var('plan')::uuid and waitlisted_at is not null),
          array['Dana', 'Dave'], 'die Crew sieht Gäste auf der Liste in Reihenfolge');

-- ---- Gast rückt nach ------------------------------------------------------------------------------------
select public.set_attendance(tests.var('plan')::uuid, 'declined');
select tests.logout();
select is((select attendance_status::text from public.plan_guests where plan_id = tests.var('plan')::uuid and display_name = 'Dana'), 'going',
  'Bob sagt ab: Dana rückt nach');
select is((select waitlisted_at from public.plan_guests where plan_id = tests.var('plan')::uuid and display_name = 'Dana'), null,
  'Dana steht nicht mehr auf der Liste');
select is((select attendance_status::text from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = tests.uid('carol')), 'maybe',
  'Carol wartet weiter');
select is(app_private.plan_waitlist_position(tests.var('plan')::uuid, tests.uid('carol'), null), 1, 'Carol ist jetzt Erste');
select is((select count(*)::int from public.notifications
           where user_id = tests.uid('alice') and type = 'plan_attendance' and payload ->> 'guest' = 'Dana' and payload ->> 'status' = 'going'), 1,
  'Alice (organisiert) erfährt, dass Dana dabei ist');
select is((select count(*)::int from public.notifications where type = 'plan_waitlist_promoted'), 0, 'keine Nachrücken-Nachricht an Mitglieder');
select is(app_private.plan_going_count(tests.var('plan')::uuid), 3, 'wieder genau voll');

select tests.login_anon();
select is(public.shared_plan_rsvp(tests.var('token'), repeat('d', 64)) -> 'me', '{"name": "Dana", "status": "going", "promoted": true}'::jsonb,
  'Danas Karte: nachgerückt, dabei');

-- Dana ändert selbst auf „Vielleicht“: Hinweis weg, Carol rückt nach (mit Nachricht).
select public.guest_rsvp_shared_plan(tests.var('token'), repeat('d', 64), 'Dana', 'maybe');
select is(public.shared_plan_rsvp(tests.var('token'), repeat('d', 64)) -> 'me', '{"name": "Dana", "status": "maybe"}'::jsonb,
  'eigene Änderung: kein Hinweis, nicht auf der Liste');
select tests.logout();
select is((select attendance_status::text from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = tests.uid('carol')), 'going',
  'Carol rückt nach');
select is((select count(*)::int from public.notifications where type = 'plan_waitlist_promoted' and user_id = tests.uid('carol')), 1,
  'Carol bekommt „Du bist nachgerückt“');

-- ---- Von der Liste gehen ------------------------------------------------------------------------------------
select tests.login('dave');
select is(public.guest_waitlist_shared_plan(tests.var('token'), repeat('a', 64), null, false), null, 'Dave geht von der Liste');
select is(public.shared_plan_rsvp(tests.var('token'), repeat('a', 64)) -> 'me', '{"name": "Dave", "status": "maybe"}'::jsonb,
  '„Vielleicht“ bleibt stehen');
select is(public.guest_waitlist_shared_plan(tests.var('token'), repeat('a', 64), null, true), 1, 'wieder drauf, Name ist bekannt');

-- ---- Übernahme ins Konto: Platz bleibt ------------------------------------------------------------------------------------
select tests.login_anon();
select is(public.guest_waitlist_shared_plan(tests.var('token'), repeat('f', 64), 'Fritz', true), 2, 'Fritz (Gast) hinter Dave');
select tests.login('dave');
select public.accept_crew_invitation(tests.var('invite'));
select is(public.claim_plan_guest(tests.var('plan')::uuid, repeat('a', 64), true) ->> 'status', 'maybe', 'Dave übernimmt die Gast-Antwort');
select tests.logout();
select is(app_private.plan_waitlist_position(tests.var('plan')::uuid, tests.uid('dave'), null), 1, 'Dave behält seinen Platz – jetzt als Mitglied');
select is((select count(*)::int from public.plan_guests where plan_id = tests.var('plan')::uuid and display_name = 'Dave'), 0, 'Gast-Eintrag ist weg');

-- ---- Gast-Zusagen aus: Gäste rücken nicht nach ------------------------------------------------------------------------------------
select tests.login('dave');
select public.leave_plan_waitlist(tests.var('plan')::uuid);
select tests.login('alice');
select public.set_plan_guests(tests.var('plan')::uuid, false);
select tests.login_anon();
select throws_ok($$ select public.guest_waitlist_shared_plan(tests.var('token'), repeat('f', 64), null, true) $$, 'P0001', 'plan_guests_off',
  'ausgeschaltet: keine Liste über den Link');
select tests.login('carol');
select public.set_attendance(tests.var('plan')::uuid, 'declined');
select tests.logout();
select is((select attendance_status::text from public.plan_guests where plan_id = tests.var('plan')::uuid and display_name = 'Fritz'), 'maybe',
  'ausgeschaltet: Fritz rückt nicht nach');
select ok((select waitlisted_at is not null from public.plan_guests where plan_id = tests.var('plan')::uuid and display_name = 'Fritz'),
  'Fritz bleibt auf der Liste stehen');
select is(app_private.plan_going_count(tests.var('plan')::uuid), 2, 'Platz bleibt frei');

-- ---- Nach Beginn, abgesagt ------------------------------------------------------------------------------------
select tests.login('alice');
select public.set_plan_guests(tests.var('plan')::uuid, true);
select tests.logout();
update public.plans set starts_at = now() - interval '1 hour' where id = tests.var('plan')::uuid;
select tests.login_anon();
select throws_ok($$ select public.guest_waitlist_shared_plan(tests.var('token'), repeat('f', 64), null, false) $$, 'P0001', 'plan_waitlist_started',
  'nach Beginn: Liste geschlossen');
select tests.logout();
update public.plans set starts_at = now() + interval '1 day', status = 'cancelled' where id = tests.var('plan')::uuid;
select tests.login_anon();
select throws_ok($$ select public.guest_waitlist_shared_plan(tests.var('token'), repeat('f', 64), null, false) $$, 'P0001', 'plan_locked',
  'abgesagt: nichts mehr');

select * from finish();
rollback;
