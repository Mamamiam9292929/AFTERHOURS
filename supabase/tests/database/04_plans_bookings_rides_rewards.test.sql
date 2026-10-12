-- Pläne, Teilnahmen, Reservierungs-Workflow, Fahrgemeinschaften und Rewards.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');   -- Organisatorin
select tests.make_user('Bob');
select tests.make_user('Carol');
select tests.make_user('Dave');    -- tritt später bei
select tests.make_user('Mallory'); -- Außenstehende

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew')::text);
select tests.set_var('token', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob');   select public.accept_crew_invitation(tests.var('token'));
select tests.login('carol'); select public.accept_crew_invitation(tests.var('token'));
select tests.logout();
select tests.set_var('bowling', (select id::text from public.activities where external_id = 'ber-strike-district'));

-- Abstimmung -> Ergebnis
select tests.login('alice');
select tests.set_var('poll', public.create_poll(tests.var('crew')::uuid, 'Was machen wir Samstag?', now() + interval '2 days',
  jsonb_build_array(
    jsonb_build_object('activity_id', tests.var('bowling'), 'proposed_date', '2031-06-14', 'proposed_time', '19:30', 'estimated_price_cents', 1800),
    jsonb_build_object('title', 'Kino', 'proposed_date', '2031-06-14')),
  p_meeting_point => 'U-Bahn Ausgang Nord')::text);
select tests.set_var('opt1', (select id::text from public.poll_options where poll_id = tests.var('poll')::uuid and position = 1));
select tests.set_var('opt2', (select id::text from public.poll_options where poll_id = tests.var('poll')::uuid and position = 2));
select public.cast_vote(tests.var('opt1')::uuid, 'yes');
select tests.login('bob'); select public.cast_vote(tests.var('opt1')::uuid, 'yes');
select tests.login('alice'); select public.close_poll(tests.var('poll')::uuid);

-- ---- Plan aus Abstimmung ----------------------------------------------------------------------------
select tests.login('bob');
select throws_ok($$ select public.create_plan_from_poll(tests.var('poll')::uuid, tests.var('opt1')::uuid) $$, '42501', 'forbidden', 'nur Erstellerin oder Admins machen aus dem Ergebnis einen Plan');
select tests.login('mallory');
select throws_ok($$ select public.create_plan_from_poll(tests.var('poll')::uuid, tests.var('opt1')::uuid) $$, '42501', 'forbidden', 'Außenstehende erst recht nicht');
select tests.login('alice');
select throws_ok($$ select public.create_plan_from_poll(tests.var('poll')::uuid, gen_random_uuid()) $$, 'P0001', 'invalid_option', 'die Option muss zur Abstimmung gehören');
select tests.set_var('plan', public.create_plan_from_poll(tests.var('poll')::uuid, tests.var('opt1')::uuid)::text);
select throws_ok($$ select public.create_plan_from_poll(tests.var('poll')::uuid, tests.var('opt2')::uuid) $$, 'P0001', 'plan_exists', 'pro Abstimmung entsteht genau ein Plan');

select is((select status::text from public.plans where id = tests.var('plan')::uuid), 'confirmed', 'Plan aus Abstimmung ist bestätigt');
select is((select title from public.plans where id = tests.var('plan')::uuid), 'Strike District Bowling', 'Titel stammt aus der gewählten Option');
select is((select starts_at from public.plans where id = tests.var('plan')::uuid), timestamptz '2031-06-14 19:30:00 Europe/Berlin', 'Beginn = Datum/Uhrzeit der Option in Europe/Berlin');
select is((select address from public.plans where id = tests.var('plan')::uuid), 'Demochaussee 220, 10365 Berlin', 'Adresse stammt aus der Aktivität');
select is((select meeting_point from public.plans where id = tests.var('plan')::uuid), 'U-Bahn Ausgang Nord', 'Treffpunkt stammt aus der Abstimmung');
select is((select estimated_cost_per_person_cents from public.plans where id = tests.var('plan')::uuid), 1800, 'Kostenschätzung stammt aus der Option');
select is((select count(*)::int from public.plan_participants where plan_id = tests.var('plan')::uuid), 3, 'alle Crew-Mitglieder sind eingeladen');
select is((select attendance_status::text from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = tests.uid('alice')), 'going', 'die Organisatorin ist dabei');
select is((select attendance_status::text from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = tests.uid('bob')), 'invited', 'alle anderen müssen selbst zusagen');
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'plan_created' and user_id in (tests.uid('bob'), tests.uid('carol'))), 2, 'die Crew wird über den Plan informiert');

-- ---- Zugriff ------------------------------------------------------------------------------------------
select tests.login('mallory');
select is((select count(*)::int from public.plans), 0, 'Außenstehende sehen keine Pläne');
select is((select count(*)::int from public.plan_participants), 0, 'Außenstehende sehen keine Teilnehmer');
select throws_ok($$ select public.set_attendance(tests.var('plan')::uuid, 'going') $$, '42501', 'forbidden', 'Außenstehende können nicht zusagen');
select throws_ok($$ select public.update_plan(tests.var('plan')::uuid, 'Gekapert', now() + interval '3 days') $$, '42501', 'forbidden', 'Außenstehende können Pläne nicht ändern');
select throws_ok($$ select public.set_plan_status(tests.var('plan')::uuid, 'cancelled') $$, '42501', 'forbidden', 'Außenstehende können Pläne nicht absagen');

-- ---- Zusagen ------------------------------------------------------------------------------------------
select tests.login('bob');
select lives_ok($$ select public.set_attendance(tests.var('plan')::uuid, 'going') $$, 'Bob sagt zu');
select throws_ok($$ select public.set_attendance(tests.var('plan')::uuid, 'invited') $$, 'P0001', 'invalid_status', '"eingeladen" ist keine wählbare Antwort');
select throws_ok($$ update public.plan_participants set attendance_status = 'declined' $$, '42501', null, 'Teilnahmen anderer lassen sich nicht direkt ändern');
select throws_ok($$ update public.plans set title = 'Gekapert' $$, '42501', null, 'Pläne lassen sich nicht direkt ändern');
select throws_ok($$ select public.update_plan(tests.var('plan')::uuid, 'Gekapert', now() + interval '3 days') $$, '42501', 'forbidden', 'einfache Mitglieder ändern fremde Pläne nicht');
select throws_ok($$ select public.set_plan_status(tests.var('plan')::uuid, 'cancelled') $$, '42501', 'forbidden', 'einfache Mitglieder sagen fremde Pläne nicht ab');
select tests.login('carol');
select lives_ok($$ select public.set_attendance(tests.var('plan')::uuid, 'declined') $$, 'Carol sagt ab');
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'plan_attendance' and user_id = tests.uid('alice')), 2, 'die Organisatorin erfährt von Zu- und Absagen');

-- ---- Ändern -------------------------------------------------------------------------------------------
select tests.login('alice');
select throws_ok($$ select public.update_plan(tests.var('plan')::uuid, 'Bowling', now() - interval '1 day') $$, 'P0001', 'starts_in_past', 'Beginn in der Vergangenheit wird abgelehnt');
select lives_ok($$ select public.update_plan(tests.var('plan')::uuid, 'Bowling-Abend', timestamptz '2031-06-14 20:00:00 Europe/Berlin', null, 'Demochaussee 220, 10365 Berlin', 'Vor dem Eingang', 'Socken nicht vergessen', 2000) $$, 'Organisatorin ändert den Plan');
select tests.logout();
select is((select payload -> 'changed' from public.notifications where type = 'plan_changed' and user_id = tests.uid('bob')), '["starts_at", "meeting_point", "cost"]'::jsonb, 'wesentliche Änderungen werden gemeldet – und nur diese');
select is((select count(*)::int from public.notifications where type = 'plan_changed' and user_id = tests.uid('alice')), 0, 'wer ändert, wird nicht selbst benachrichtigt');

-- ---- Beitritt und Austritt wirken auf anstehende Pläne ---------------------------------------------------
select tests.login('dave');
select public.accept_crew_invitation(tests.var('token'));
select is((select attendance_status::text from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = tests.uid('dave')), 'invited', 'neue Mitglieder werden zu anstehenden Plänen eingeladen');
select public.set_attendance(tests.var('plan')::uuid, 'going');
select public.leave_crew(tests.var('crew')::uuid);
select tests.logout();
select is((select count(*)::int from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = tests.uid('dave')), 0, 'wer austritt, steht nicht mehr auf künftigen Plänen');

-- ---- Reservierungs-Workflow ----------------------------------------------------------------------------------
select tests.login('bob');
select throws_ok($$ select public.create_booking_request(tests.var('plan')::uuid, '2031-06-14', '20:00', 4) $$, '42501', 'forbidden', 'nur Organisatorin oder Admins bereiten Reservierungen vor');
select tests.login('alice');
select throws_ok($$ select public.create_booking_request(tests.var('plan')::uuid, '2031-06-14', '20:00', 0) $$, 'P0001', 'invalid_booking', 'Personenzahl muss plausibel sein');
select tests.set_var('booking', public.create_booking_request(tests.var('plan')::uuid, '2031-06-14', '20:00', 4, 'Bahn am Rand')::text);
select is((select status::text from public.booking_requests where id = tests.var('booking')::uuid), 'not_started', 'eine vorbereitete Anfrage löst nichts aus');
select is((select is_test from public.booking_requests where id = tests.var('booking')::uuid), true, 'Anfragen an Demo-Orte sind als Test markiert');
select is((select status::text from public.plans where id = tests.var('plan')::uuid), 'confirmed', 'der Plan bleibt bis zur Freigabe unverändert');
select throws_ok($$ select public.create_booking_request(tests.var('plan')::uuid, '2031-06-14', '21:00', 4) $$, 'P0001', 'booking_exists', 'nur eine laufende Anfrage pro Plan');
select throws_ok($$ select public.record_booking_outcome(tests.var('booking')::uuid, 'confirmed', 'ABC-1') $$, 'P0001', 'invalid_transition', 'ohne ausdrückliche Freigabe kann nichts als bestätigt gelten');
select throws_ok($$ update public.booking_requests set status = 'confirmed' $$, '42501', null, 'der Status lässt sich nicht direkt setzen');
select tests.login('bob');
select throws_ok($$ select public.confirm_booking_request(tests.var('booking')::uuid) $$, '42501', 'forbidden', 'Freigabe nur durch Organisatorin oder Admins');
select tests.login('alice');
select lives_ok($$ select public.confirm_booking_request(tests.var('booking')::uuid) $$, 'ausdrückliche Freigabe');
select is((select status::text from public.plans where id = tests.var('plan')::uuid), 'booking_pending', 'Plan: Reservierung ausstehend');
select ok((select confirmed_by_user_at is not null from public.booking_requests where id = tests.var('booking')::uuid), 'Zeitpunkt der Freigabe ist festgehalten');
select throws_ok($$ select public.record_booking_outcome(tests.var('booking')::uuid, 'in_progress') $$, 'P0001', 'invalid_transition', 'nur echte Ergebnisse sind eintragbar');
select lives_ok($$ select public.record_booking_outcome(tests.var('booking')::uuid, 'awaiting_response') $$, 'Rückmeldung ausstehend');
select lives_ok($$ select public.record_booking_outcome(tests.var('booking')::uuid, 'confirmed', '  ABC-123 ') $$, 'Bestätigung des Anbieters eingetragen');
select is((select status::text || '/' || booking_status::text from public.plans where id = tests.var('plan')::uuid), 'booked/confirmed', 'Plan: gebucht');
select is((select provider_confirmation_reference from public.booking_requests where id = tests.var('booking')::uuid), 'ABC-123', 'Bestätigungsnummer gespeichert');
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'booking_status' and user_id = tests.uid('bob')), 1, 'Teilnehmende erfahren vom Ergebnis (nicht von Zwischenständen)');
select tests.login('alice');
select lives_ok($$ select public.cancel_booking_request(tests.var('booking')::uuid) $$, 'Reservierung storniert');
select is((select status::text || '/' || booking_status::text from public.plans where id = tests.var('plan')::uuid), 'confirmed/cancelled_by_user', 'Plan fällt auf "bestätigt" zurück');
select tests.set_var('booking2', public.create_booking_request(tests.var('plan')::uuid, '2031-06-14', '20:00', 4)::text);
select public.confirm_booking_request(tests.var('booking2')::uuid);
select lives_ok($$ select public.record_booking_outcome(tests.var('booking2')::uuid, 'unavailable') $$, 'Anbieter hat nichts frei');
select is((select status::text || '/' || booking_status::text from public.plans where id = tests.var('plan')::uuid), 'confirmed/unavailable', 'Plan bleibt bestätigt, Reservierung "nicht verfügbar"');

-- ---- Fahrgemeinschaften ----------------------------------------------------------------------------------------
select tests.login('mallory');
select throws_ok($$ select public.create_ride_offer(tests.var('plan')::uuid, 'Bahnhof', now() + interval '1 day', 3) $$, '42501', 'forbidden', 'Außenstehende bieten keine Fahrt an');
select tests.login('alice');
select tests.set_var('offer', public.create_ride_offer(tests.var('plan')::uuid, 'Bahnhof Ostkreuz', timestamptz '2031-06-14 19:15:00 Europe/Berlin', 1)::text);
select throws_ok($$ select public.request_ride(tests.var('offer')::uuid) $$, '42501', 'forbidden', 'man kann nicht bei sich selbst mitfahren');
select tests.login('bob');
select tests.set_var('req_bob', public.request_ride(tests.var('offer')::uuid)::text);
select throws_ok($$ select public.respond_ride_request(tests.var('req_bob')::uuid, true) $$, '42501', 'forbidden', 'Mitfahrende können sich nicht selbst bestätigen');
select throws_ok($$ update public.ride_requests set status = 'accepted' $$, '42501', null, 'auch nicht an der RPC vorbei');
select tests.login('carol');
select tests.set_var('req_carol', public.request_ride(tests.var('offer')::uuid)::text);
select tests.login('mallory');
select is((select count(*)::int from public.ride_offers) + (select count(*)::int from public.ride_requests), 0, 'Außenstehende sehen weder Angebote noch Anfragen');
select tests.login('alice');
select lives_ok($$ select public.respond_ride_request(tests.var('req_bob')::uuid, true) $$, 'Fahrerin bestätigt Bob');
select throws_ok($$ select public.respond_ride_request(tests.var('req_carol')::uuid, true) $$, 'P0001', 'no_seats_left', 'mehr Zusagen als freie Plätze sind nicht möglich');
select lives_ok($$ select public.respond_ride_request(tests.var('req_carol')::uuid, false) $$, 'Fahrerin lehnt Carol ab');
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'ride_request' and user_id = tests.uid('alice')), 2, 'die Fahrerin erfährt von Anfragen');
select is((select (payload ->> 'accepted')::boolean from public.notifications where type = 'ride_confirmed' and user_id = tests.uid('bob')), true, 'Bob erfährt von der Zusage');

-- ---- Abschluss und Rewards ------------------------------------------------------------------------------------------
select tests.login('alice');
select throws_ok($$ select public.set_plan_status(tests.var('plan')::uuid, 'completed') $$, 'P0001', 'plan_not_started', 'ein Plan lässt sich nicht vor Beginn abschließen');
select throws_ok($$ select public.set_plan_status(tests.var('plan')::uuid, 'booked') $$, 'P0001', 'invalid_transition', '"gebucht" entsteht nur über den Reservierungs-Workflow');
select throws_ok($$ insert into public.reward_transactions (user_id, points_delta, reason) values (tests.uid('alice'), 100000, 'admin_adjustment') $$, '42501', null, 'Punkte lassen sich nicht selbst gutschreiben');
select tests.logout();
update public.plans set starts_at = now() - interval '3 hours' where id = tests.var('plan')::uuid;
select tests.login('alice');
select lives_ok($$ select public.set_plan_status(tests.var('plan')::uuid, 'completed') $$, 'nach Beginn: Plan abgeschlossen');
select is((select coalesce(sum(points_delta), 0)::int from public.reward_transactions), 40, 'Organisatorin: 30 (organisiert) + 10 (teilgenommen)');
select throws_ok($$ select public.update_plan(tests.var('plan')::uuid, 'Nachträglich', now() + interval '1 day') $$, 'P0001', 'plan_locked', 'abgeschlossene Pläne sind gesperrt');
select throws_ok($$ select public.set_attendance(tests.var('plan')::uuid, 'declined') $$, 'P0001', 'plan_locked', 'Zusagen lassen sich nachträglich nicht ändern');
select throws_ok($$ select public.set_plan_status(tests.var('plan')::uuid, 'cancelled') $$, 'P0001', 'invalid_transition', 'abgeschlossen ist endgültig');
select throws_ok($$ update public.reward_transactions set points_delta = 9999 $$, '42501', null, 'Punktestände sind nicht manipulierbar');
select tests.login('bob');
select is((select coalesce(sum(points_delta), 0)::int from public.reward_transactions), 10, 'Bob (zugesagt): 10 Punkte – und er sieht nur seine eigenen');
select tests.login('carol');
select is((select count(*)::int from public.reward_transactions), 0, 'Carol (abgesagt): keine Punkte');
select tests.logout();
select app_private.award_plan_rewards(tests.var('plan')::uuid);
select is((select count(*)::int from public.reward_transactions where related_entity_id = tests.var('plan')::uuid), 3, 'dieselbe Aktion wird nie doppelt vergütet');
select is((select count(*)::int from public.audit_log where action = 'reward_transaction' and meta ->> 'related_entity_id' = tests.var('plan')), 3, 'jede Punktebuchung steht im Audit-Log');

-- Solo-Pläne bringen keine Punkte.
select tests.login('alice');
select tests.set_var('solo', public.create_plan(tests.var('crew')::uuid, 'Allein ins Kino', now() + interval '1 day', p_confirmed => true)::text);
select tests.logout();
update public.plans set starts_at = now() - interval '1 hour' where id = tests.var('solo')::uuid;
select tests.login('alice');
select public.set_plan_status(tests.var('solo')::uuid, 'completed');
select is((select count(*)::int from public.reward_transactions where related_entity_id = tests.var('solo')::uuid), 0, 'ohne zweite zugesagte Person gibt es keine Punkte');

-- ---- Direkter Plan, Vorschlag -> bestätigt -> abgesagt -------------------------------------------------------------------
select throws_ok($$ select public.create_plan(tests.var('crew')::uuid, 'Zu spät', now() - interval '1 hour') $$, 'P0001', 'starts_in_past', 'Pläne in der Vergangenheit werden abgelehnt');
select tests.set_var('plan2', public.create_plan(tests.var('crew')::uuid, 'Minigolf', now() + interval '5 days', p_cost_per_person_cents => 1100)::text);
select is((select status::text from public.plans where id = tests.var('plan2')::uuid), 'proposed', 'direkt angelegte Pläne starten als Vorschlag');
select throws_ok($$ select public.create_booking_request(tests.var('plan2')::uuid, '2031-06-14', '20:00', 4) $$, 'P0001', 'plan_not_confirmed', 'Reservierungen erst für bestätigte Pläne');
select lives_ok($$ select public.set_plan_status(tests.var('plan2')::uuid, 'confirmed') $$, 'Vorschlag bestätigt');
select lives_ok($$ select public.set_plan_status(tests.var('plan2')::uuid, 'cancelled') $$, 'Plan abgesagt');
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'plan_cancelled' and user_id = tests.uid('bob')), 1, 'Teilnehmende erfahren von der Absage');

select * from finish();
rollback;
