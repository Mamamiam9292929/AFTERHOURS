-- P51 Etappe 2: „Ich bring wen mit“ für Gäste über den Teilen-Link. Nur mit eigener Gast-Antwort „Bin dabei“
-- (Geheimnis), 0–3, nur vor Beginn, nur mit Gäste-Freigabe, nicht für Mitglieder; Begleitung zählt bei Mindestzahl,
-- Höchstzahl samt Nachrückliste und auf der Zusagekarte; jede andere Antwort setzt sie zurück; beim Übernehmen ins
-- Konto kommt sie mit; Außenstehende, anon ohne Geheimnis und fremde Geheimnisse kommen nicht heran.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Carol');
select tests.make_user('Gina');
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

-- Bob legt den Plan an (Organisator, ist dabei) und lässt Zusagen über den Link zu.
select tests.login('bob');
select tests.set_var('plan', public.create_plan(tests.var('crew')::uuid, 'Kartbahn', now() + interval '3 days', p_confirmed => true)::text);
select tests.set_var('token', public.plan_share_token(tests.var('plan')::uuid));
select public.set_plan_guests(tests.var('plan')::uuid, true);

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(has_function_privilege('anon', 'public.guest_plus_ones_shared_plan(text, text, integer)', 'execute'), 'Gäste ohne Konto dürfen aufrufen');
select ok(has_function_privilege('authenticated', 'public.guest_plus_ones_shared_plan(text, text, integer)', 'execute'), 'angemeldete auch (Außenstehende als Gast)');
select ok(not has_function_privilege('anon', 'app_private.plan_going_count(uuid)', 'execute'), 'Zählung ist nicht direkt aufrufbar');

-- ---- Eingaben und Angriffe ------------------------------------------------------------------------------------
select tests.login_anon();
select throws_ok($$ select public.guest_plus_ones_shared_plan('falsch', repeat('e', 64), 1) $$, 'P0001', 'share_not_found', 'unbekannter Link');
select throws_ok($$ select public.guest_plus_ones_shared_plan(tests.var('token'), repeat('e', 64), 1) $$, 'P0001', 'plan_plus_ones_not_going',
  'ohne Gast-Antwort keine Begleitung');
select public.guest_rsvp_shared_plan(tests.var('token'), repeat('e', 64), 'Emil', 'maybe');
select throws_ok($$ select public.guest_plus_ones_shared_plan(tests.var('token'), repeat('e', 64), 1) $$, 'P0001', 'plan_plus_ones_not_going',
  'bei „Vielleicht“ keine Begleitung');
select public.guest_rsvp_shared_plan(tests.var('token'), repeat('e', 64), 'Emil', 'going');
select throws_ok($$ select public.guest_plus_ones_shared_plan(tests.var('token'), repeat('e', 64), 4) $$, 'P0001', 'invalid_input', 'höchstens 3');
select throws_ok($$ select public.guest_plus_ones_shared_plan(tests.var('token'), repeat('e', 64), -1) $$, 'P0001', 'invalid_input', 'nicht negativ');
select throws_ok($$ select public.guest_plus_ones_shared_plan(tests.var('token'), repeat('e', 64), null) $$, 'P0001', 'invalid_input', 'nicht leer');
select throws_ok($$ select public.guest_plus_ones_shared_plan(tests.var('token'), 'kurz', 1) $$, 'P0001', 'invalid_input', 'Geheimnis im falschen Format');
select throws_ok($$ select public.guest_plus_ones_shared_plan(tests.var('token'), repeat('f', 64), 1) $$, 'P0001', 'plan_plus_ones_not_going',
  'fremdes Geheimnis ändert nicht Emils Begleitung');
select throws_ok($$ update public.plan_guests set plus_ones = 3 $$, '42501', null, 'anon schreibt nicht direkt');
select tests.login('carol');
select throws_ok($$ select public.guest_plus_ones_shared_plan(tests.var('token'), repeat('c', 64), 1) $$, 'P0001', 'plan_guest_member',
  'Mitglieder nehmen die App');
select throws_ok($$ update public.plan_guests set plus_ones = 3 where plan_id = tests.var('plan')::uuid $$, '42501', null,
  'Mitglieder schreiben nicht direkt');
select tests.logout();
select is((select plus_ones::int from public.plan_guests where plan_id = tests.var('plan')::uuid), 0, 'nach den Angriffen keine Begleitung');

-- ---- Zählen und Mindestzahl ------------------------------------------------------------------------------------
select tests.login('bob');
select public.set_plan_min_going(tests.var('plan')::uuid, 4);
select tests.login_anon();
select is(public.guest_plus_ones_shared_plan(tests.var('token'), repeat('e', 64), 1), 1, 'Emil bringt eine mit');
select is(public.guest_plus_ones_shared_plan(tests.var('token'), repeat('e', 64), 1), 1, 'noch einmal: bleibt bei einer');
select tests.logout();
select is(app_private.plan_going_count(tests.var('plan')::uuid), 3, 'Bob + Emil mit Begleitung');
select is((select count(*)::int from public.notifications where type = 'plan_quorum' and related_entity_id = tests.var('plan')::uuid), 0,
  '3 von 4: noch kein „Findet statt“');
select tests.login_anon();
select is(public.guest_plus_ones_shared_plan(tests.var('token'), repeat('e', 64), 2), 2, 'Emil bringt zwei mit');
select tests.logout();
select ok((select min_going_reached_at is not null from public.plans where id = tests.var('plan')::uuid), 'Begleitung des Gasts erreicht die Mindestzahl');
select ok((select count(*)::int from public.notifications where type = 'plan_quorum' and related_entity_id = tests.var('plan')::uuid) > 0,
  'Crew bekommt „Findet statt“');

select tests.login('carol');
select is((select plus_ones::int from public.plan_guests where plan_id = tests.var('plan')::uuid), 2, 'die Crew sieht „+2“ beim Gast');
select tests.login('mallory');
select is((select count(*)::int from public.plan_guests where plan_id = tests.var('plan')::uuid), 0, 'Außenstehende sehen keine Gäste');

select tests.login_anon();
select is((public.shared_plan_rsvp(tests.var('token'), repeat('e', 64)) -> 'counts' ->> 'going')::int, 4, 'Zusagekarte zählt 4 dabei');
select is((public.shared_plan_rsvp(tests.var('token'), repeat('e', 64)) -> 'me' ->> 'plus_ones')::int, 2, 'Emil sieht seine Begleitung');
select ok(not (public.shared_plan_rsvp(tests.var('token'), repeat('d', 64)) ? 'me') or public.shared_plan_rsvp(tests.var('token'), repeat('d', 64)) -> 'me' = 'null'::jsonb,
  'fremdes Gerät sieht keine eigene Antwort');
select public.guest_rsvp_shared_plan(tests.var('token'), repeat('d', 64), 'Dana', 'going');
select ok(not (public.shared_plan_rsvp(tests.var('token'), repeat('d', 64)) -> 'me' ? 'plus_ones'), 'ohne Begleitung fehlt plus_ones');
select is((public.preview_shared_plan(tests.var('token')) -> 'plan' ->> 'going_count')::int, 5, 'Messenger-Vorschau zählt die Begleitung mit');

-- ---- Höchstzahl und Nachrückliste ------------------------------------------------------------------------------------
select tests.login('bob');
select throws_ok($$ select public.set_plan_max_going(tests.var('plan')::uuid, 4) $$, 'P0001', 'plan_max_below_going', 'Höchstzahl nicht unter Zusagen mit Begleitung der Gäste');
select is(public.set_plan_max_going(tests.var('plan')::uuid, 5), 5, 'höchstens 5: voll');
select tests.login_anon();
select throws_ok($$ select public.guest_plus_ones_shared_plan(tests.var('token'), repeat('d', 64), 1) $$, 'P0001', 'plan_full', 'voll: Dana bringt niemanden mehr mit');
select tests.login('carol');
select public.set_attendance(tests.var('plan')::uuid, 'maybe');
select is(public.join_plan_waitlist(tests.var('plan')::uuid), 1, 'Carol auf der Nachrückliste');
select tests.login_anon();
select is(public.guest_plus_ones_shared_plan(tests.var('token'), repeat('e', 64), 1), 1, 'Emil bringt doch nur eine mit');
select tests.logout();
select is((select attendance_status::text from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = tests.uid('carol')),
  'going', 'freier Platz: Carol rückt nach');
select is(app_private.plan_going_count(tests.var('plan')::uuid), 5, 'Bob, Emil mit einer, Dana, Carol');

-- ---- Begleitung gehört zur Antwort ------------------------------------------------------------------------------------
select tests.login_anon();
select public.guest_rsvp_shared_plan(tests.var('token'), repeat('e', 64), 'Emil', 'maybe');
select tests.logout();
select is((select plus_ones::int from public.plan_guests where display_name = 'Emil'), 0, '„Vielleicht“: Begleitung des Gasts ist weg');
select tests.login('bob');
select public.set_plan_max_going(tests.var('plan')::uuid, null);
select tests.login_anon();
select public.guest_rsvp_shared_plan(tests.var('token'), repeat('e', 64), 'Emil', 'going');
select is(public.guest_plus_ones_shared_plan(tests.var('token'), repeat('e', 64), 3), 3, 'Emil wieder dabei, bringt drei mit');

-- ---- Übernahme ins Konto ------------------------------------------------------------------------------------
-- Emil heißt im Konto Gina: tritt der Crew bei und übernimmt die Gast-Antwort samt Begleitung.
select tests.login('gina');
select public.accept_crew_invitation(tests.var('invite'));
select is(public.claim_plan_guest(tests.var('plan')::uuid, repeat('e', 64), true) ->> 'status', 'going', 'Gina übernimmt „Bin dabei“');
select is((select plus_ones::int from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = auth.uid()), 3,
  'die Begleitung kommt mit');
select tests.logout();
select is((select count(*)::int from public.plan_guests where display_name = 'Emil'), 0, 'kein Gast mehr – niemand doppelt');
select is(app_private.plan_going_count(tests.var('plan')::uuid), 7, 'Zahl unverändert: Bob, Gina mit drei, Dana, Carol');

-- ---- Gesperrt ------------------------------------------------------------------------------------
select tests.login('bob');
select public.set_plan_guests(tests.var('plan')::uuid, false);
select tests.login_anon();
select throws_ok($$ select public.guest_plus_ones_shared_plan(tests.var('token'), repeat('d', 64), 1) $$, 'P0001', 'plan_guests_off', 'ohne Freigabe nicht');
select tests.login('bob');
select public.set_plan_guests(tests.var('plan')::uuid, true);
select tests.logout();
update public.plans set starts_at = now() - interval '1 hour' where id = tests.var('plan')::uuid;
select tests.login_anon();
select throws_ok($$ select public.guest_plus_ones_shared_plan(tests.var('token'), repeat('d', 64), 1) $$, 'P0001', 'plan_plus_ones_started', 'nach Beginn nicht mehr');
select tests.logout();
update public.plans set starts_at = now() + interval '1 day', status = 'cancelled' where id = tests.var('plan')::uuid;
select tests.login_anon();
select throws_ok($$ select public.guest_plus_ones_shared_plan(tests.var('token'), repeat('d', 64), 1) $$, 'P0001', 'plan_locked', 'abgesagt: gesperrt');

select * from finish();
rollback;
