-- P53 Etappe 2c: „Hab mein Ticket“ für Gäste über den Teilen-Link. Nur mit eigener Gast-Antwort (Geheimnis), nur mit
-- Gäste-Freigabe und eingeschaltetem Ticket-Check, nicht für Mitglieder, gesperrt nach Abschluss/Absage; die Angabe
-- bleibt bei einer Absage („Ticket übrig“), die Zusagekarte zeigt sie, die Crew sieht sie, beim Übernehmen ins Konto
-- kommt sie mit; Außenstehende, anon ohne Geheimnis und fremde Geheimnisse kommen nicht heran.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Carol');
select tests.make_user('Gina');
select tests.make_user('Mallory');

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Konzert Crew', '🎸')::text);
select tests.set_var('invite', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob');
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('carol');
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('mallory');
select public.create_crew('Fremde Crew');

-- Bob legt den Plan an und lässt Zusagen über den Link zu – der Ticket-Check ist noch aus.
select tests.login('bob');
select tests.set_var('plan', public.create_plan(tests.var('crew')::uuid, 'Konzert', now() + interval '10 days', p_confirmed => true)::text);
select tests.set_var('token', public.plan_share_token(tests.var('plan')::uuid));
select public.set_plan_guests(tests.var('plan')::uuid, true);

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(has_function_privilege('anon', 'public.guest_ticket_shared_plan(text, text, boolean)', 'execute'), 'Gäste ohne Konto dürfen aufrufen');
select ok(has_function_privilege('authenticated', 'public.guest_ticket_shared_plan(text, text, boolean)', 'execute'), 'angemeldete auch (Außenstehende als Gast)');
select ok(not has_function_privilege('anon', 'public.set_my_plan_ticket(uuid, boolean)', 'execute'), 'die Mitglieder-Funktion bleibt anon verschlossen');

-- ---- Ticket-Check aus ------------------------------------------------------------------------------------
select tests.login_anon();
select public.guest_rsvp_shared_plan(tests.var('token'), repeat('e', 64), 'Emil', 'going');
select throws_ok($$ select public.guest_ticket_shared_plan(tests.var('token'), repeat('e', 64), true) $$, 'P0001', 'plan_tickets_off', 'ohne Ticket-Check nicht');
select is(public.shared_plan_rsvp(tests.var('token'), repeat('e', 64)) -> 'plan' -> 'tickets_needed', 'false'::jsonb, 'Zusagekarte: Check aus');

select tests.login('bob');
select public.set_plan_tickets_needed(tests.var('plan')::uuid, true);

-- ---- Eingaben und Angriffe ------------------------------------------------------------------------------------
select tests.login_anon();
select is(public.shared_plan_rsvp(tests.var('token'), repeat('e', 64)) -> 'plan' -> 'tickets_needed', 'true'::jsonb, 'Zusagekarte: Check an');
select throws_ok($$ select public.guest_ticket_shared_plan('falsch', repeat('e', 64), true) $$, 'P0001', 'share_not_found', 'unbekannter Link');
select throws_ok($$ select public.guest_ticket_shared_plan(tests.var('token'), repeat('d', 64), true) $$, 'P0001', 'plan_guest_not_found',
  'ohne eigene Gast-Antwort keine Angabe (fremdes Geheimnis ändert nicht Emils Angabe)');
select throws_ok($$ select public.guest_ticket_shared_plan(tests.var('token'), 'kurz', true) $$, 'P0001', 'invalid_input', 'Geheimnis im falschen Format');
select throws_ok($$ select public.guest_ticket_shared_plan(tests.var('token'), repeat('e', 64), null) $$, 'P0001', 'invalid_input', 'Angabe nicht leer');
select throws_ok($$ update public.plan_guests set has_ticket = true $$, '42501', null, 'anon schreibt nicht direkt');
select tests.login('carol');
select throws_ok($$ select public.guest_ticket_shared_plan(tests.var('token'), repeat('c', 64), true) $$, 'P0001', 'plan_guest_member',
  'Mitglieder nehmen die App');
select throws_ok($$ update public.plan_guests set has_ticket = true where plan_id = tests.var('plan')::uuid $$, '42501', null,
  'Mitglieder schreiben nicht direkt');
select tests.logout();
select is((select has_ticket from public.plan_guests where display_name = 'Emil'), false, 'nach den Angriffen kein Ticket');

-- ---- Angabe setzen ------------------------------------------------------------------------------------
select tests.login_anon();
select is(public.guest_ticket_shared_plan(tests.var('token'), repeat('e', 64), true), true, 'Emil hat sein Ticket');
select is(public.guest_ticket_shared_plan(tests.var('token'), repeat('e', 64), true), true, 'noch einmal: bleibt so');
select is(public.shared_plan_rsvp(tests.var('token'), repeat('e', 64)) -> 'me' -> 'has_ticket', 'true'::jsonb, 'Emil sieht seine Angabe');
select public.guest_rsvp_shared_plan(tests.var('token'), repeat('d', 64), 'Dana', 'maybe');
select ok(not (public.shared_plan_rsvp(tests.var('token'), repeat('d', 64)) -> 'me' ? 'has_ticket'), 'ohne Ticket fehlt has_ticket');
select is(public.guest_ticket_shared_plan(tests.var('token'), repeat('d', 64), true), true, 'auch bei „Vielleicht“');
select is(public.guest_ticket_shared_plan(tests.var('token'), repeat('d', 64), false), false, 'und wieder zurück');

select tests.login('carol');
select is((select has_ticket from public.plan_guests where plan_id = tests.var('plan')::uuid and display_name = 'Emil'), true,
  'die Crew sieht Emils Ticket');
select tests.login('mallory');
select is((select count(*)::int from public.plan_guests where plan_id = tests.var('plan')::uuid), 0, 'Außenstehende sehen keine Gäste');

-- ---- Angabe hängt nicht an der Antwort ------------------------------------------------------------------------------------
select tests.login_anon();
select public.guest_rsvp_shared_plan(tests.var('token'), repeat('e', 64), 'Emil', 'declined');
select tests.logout();
select is((select has_ticket from public.plan_guests where display_name = 'Emil'), true, 'Absage: Ticket bleibt („Ticket übrig“)');
select tests.login_anon();
select is(public.guest_ticket_shared_plan(tests.var('token'), repeat('e', 64), false), false, 'übriges Ticket lässt sich zurücknehmen');
select public.guest_rsvp_shared_plan(tests.var('token'), repeat('e', 64), 'Emil', 'going');
select is(public.guest_ticket_shared_plan(tests.var('token'), repeat('e', 64), true), true, 'Emil wieder dabei, mit Ticket');

-- ---- Übernahme ins Konto ------------------------------------------------------------------------------------
-- Emil heißt im Konto Gina: tritt der Crew bei und übernimmt die Gast-Antwort samt Ticket.
select tests.login('gina');
select public.accept_crew_invitation(tests.var('invite'));
select is(public.claim_plan_guest(tests.var('plan')::uuid, repeat('e', 64), true) ->> 'status', 'going', 'Gina übernimmt „Bin dabei“');
select is((select has_ticket from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = auth.uid()), true,
  'das Ticket kommt mit');
-- Dana (ohne Ticket) löscht ihre Gast-Antwort statt sie zu übernehmen: nichts kommt mit.
select tests.login('carol');
select public.set_attendance(tests.var('plan')::uuid, 'going');
select public.claim_plan_guest(tests.var('plan')::uuid, repeat('d', 64), false);
select is((select has_ticket from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = auth.uid()), false,
  'gelöschte Gast-Antwort ohne Ticket ändert nichts');

-- ---- Gesperrt ------------------------------------------------------------------------------------
select tests.login_anon();
select public.guest_rsvp_shared_plan(tests.var('token'), repeat('f', 64), 'Fritz', 'going');
select tests.login('bob');
select public.set_plan_guests(tests.var('plan')::uuid, false);
select tests.login_anon();
select throws_ok($$ select public.guest_ticket_shared_plan(tests.var('token'), repeat('f', 64), true) $$, 'P0001', 'plan_guests_off', 'ohne Freigabe nicht');
select tests.login('bob');
select public.set_plan_guests(tests.var('plan')::uuid, true);
select tests.logout();
update public.plans set starts_at = now() - interval '1 hour' where id = tests.var('plan')::uuid;
select tests.login_anon();
select is(public.guest_ticket_shared_plan(tests.var('token'), repeat('f', 64), true), true, 'nach Beginn noch möglich (wie bei Mitgliedern)');
select tests.logout();
update public.plans set starts_at = now() + interval '1 day', status = 'cancelled' where id = tests.var('plan')::uuid;
select tests.login_anon();
select throws_ok($$ select public.guest_ticket_shared_plan(tests.var('token'), repeat('f', 64), false) $$, 'P0001', 'plan_locked', 'abgesagt: gesperrt');

select * from finish();
rollback;
