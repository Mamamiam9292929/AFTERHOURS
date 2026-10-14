-- W3 Etappe 1: Mitstimmen ohne Konto per Teilen-Link – nur nach ausdrücklicher Freigabe, nur das Nötige,
-- Gäste zählen beim Ergebnis mit, Missbrauch ist begrenzt.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Mallory');

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew', '🎳')::text);
select tests.set_var('invite', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Bob tritt bei');

select tests.login('alice');
select tests.set_var('poll', public.create_poll(
  tests.var('crew')::uuid, 'Was machen wir am Samstag?', now() + interval '2 days',
  jsonb_build_array(
    jsonb_build_object('title', 'Strike Bowling', 'proposed_date', '2031-06-14', 'proposed_time', '19:30'),
    jsonb_build_object('title', 'Grillen bei Bob'),
    jsonb_build_object('title', 'Kino')),
  p_description => 'Bitte bis Freitag', p_meeting_point => 'Hinterhof Tür 3', p_budget_cents => 2500)::text);
select tests.set_var('token', public.poll_share_token(tests.var('poll')::uuid));
select tests.set_var('opt1', (select id::text from public.poll_options where poll_id = tests.var('poll')::uuid and position = 1));
select tests.set_var('opt2', (select id::text from public.poll_options where poll_id = tests.var('poll')::uuid and position = 2));
select tests.set_var('opt3', (select id::text from public.poll_options where poll_id = tests.var('poll')::uuid and position = 3));

-- Geheimnisse zweier Gäste (64 Hex-Zeichen, wie die App sie erzeugt).
select tests.set_var('carla', repeat('c', 64));
select tests.set_var('dave', repeat('d', 64));

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(has_function_privilege('anon', 'public.shared_poll_ballot(text, text)', 'execute'), 'anon darf den Stimmzettel abrufen');
select ok(has_function_privilege('anon', 'public.guest_vote_shared_poll(text, text, text, jsonb)', 'execute'), 'anon darf als Gast abstimmen');
select ok(not has_function_privilege('anon', 'public.set_poll_guests(uuid, boolean)', 'execute'), 'anon kann Gäste nicht freischalten');
select ok(not has_function_privilege('anon', 'public.remove_poll_guest(uuid)', 'execute'), 'anon kann keine Gäste entfernen');
select ok(not has_function_privilege('authenticated', 'app_private.poll_yes_counts(uuid)', 'execute'), 'interne Zählung nicht aufrufbar');
select ok(not has_column_privilege('authenticated', 'public.poll_guests', 'secret_hash', 'select'), 'den Hash des Gast-Geheimnisses liest niemand über die API');

select tests.login_anon();
select throws_ok('select * from public.poll_guests', '42501', null, 'anon liest keine Gäste');
select throws_ok('select * from public.poll_guest_votes', '42501', null, 'anon liest keine Gast-Stimmen');

-- ---- Standard: aus ------------------------------------------------------------------------------
select is(public.shared_poll_ballot(tests.var('token')), '{"status": "guests_off"}'::jsonb, 'ohne Freigabe: kein Stimmzettel, keine Vorschläge');
select throws_ok($$ select public.guest_vote_shared_poll(tests.var('token'), tests.var('carla'), 'Carla', '{"1": "yes"}') $$,
  'P0001', 'guests_not_allowed', 'ohne Freigabe: keine Gast-Stimme');

-- ---- Freigabe: nur Ersteller:in oder Owner/Admin ------------------------------------------------
select tests.login('mallory');
select throws_ok($$ select public.set_poll_guests(tests.var('poll')::uuid, true) $$, '42501', null, 'Außenstehende schalten nichts frei');
select tests.login('bob');
select throws_ok($$ select public.set_poll_guests(tests.var('poll')::uuid, true) $$, '42501', null, 'einfache Mitglieder schalten nichts frei');
select tests.login('alice');
select throws_ok($$ select public.set_poll_guests(tests.var('poll')::uuid, null) $$, 'P0001', 'invalid_input', 'ohne Wert keine Änderung');
select lives_ok($$ select public.set_poll_guests(tests.var('poll')::uuid, true) $$, 'Ersteller:in schaltet Gäste frei');
select is((select guests_allowed from public.polls where id = tests.var('poll')::uuid), true, 'die Crew sieht den Schalter an der Abstimmung');
select lives_ok($$ select public.set_poll_guests(tests.var('poll')::uuid, true) $$, 'erneutes Einschalten ändert nichts');
select tests.logout();
select is((select count(*)::int from public.audit_log where action = 'poll_guests'), 1, 'Freigabe steht einmal im Audit-Log');

-- ---- Stimmzettel ohne Konto ----------------------------------------------------------------------
select tests.login_anon();
select tests.set_var('ballot', public.shared_poll_ballot(tests.var('token'))::text);
select is(tests.var('ballot')::jsonb ->> 'status', 'valid', 'mit Freigabe: Stimmzettel');
select is(tests.var('ballot')::jsonb #>> '{poll,open}', 'true', 'Abstimmung läuft');
select is(jsonb_array_length(tests.var('ballot')::jsonb -> 'options'), 3, 'alle drei Vorschläge');
select is(tests.var('ballot')::jsonb #>> '{options,0,title}', 'Strike Bowling', 'Vorschläge im Wortlaut');
select is(tests.var('ballot')::jsonb #>> '{options,0,key}', '1', 'Schlüssel ist die Position, keine ID');
select is(tests.var('ballot')::jsonb #>> '{options,0,proposed_time}', '19:30', 'Uhrzeit als HH:MM');
select ok(tests.var('ballot')::jsonb -> 'me' = 'null'::jsonb, 'ohne Geheimnis kein eigener Stand');
select ok(tests.var('ballot') !~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'der Stimmzettel enthält keine einzige ID');
select ok(tests.var('ballot') !~* '(Hinterhof|Freitag|2500|Weekend|Alice|example\.test)',
  'kein Treffpunkt, keine Beschreibung, kein Budget, kein Crew-Name, keine Namen');

-- ---- Abstimmen als Gast -----------------------------------------------------------------------------
select throws_ok($$ select public.guest_vote_shared_poll(tests.var('token'), 'kurz', 'Carla', '{"1": "yes"}') $$, 'P0001', 'invalid_input', 'Geheimnis muss 64 Hex-Zeichen haben');
select throws_ok($$ select public.guest_vote_shared_poll(tests.var('token'), tests.var('carla'), ' C ', '{"1": "yes"}') $$, 'P0001', 'invalid_name', 'Name braucht 2 Zeichen');
select throws_ok($$ select public.guest_vote_shared_poll(tests.var('token'), tests.var('carla'), 'Carla', '{"9": "yes"}') $$, 'P0001', 'invalid_input', 'unbekannter Vorschlag');
select throws_ok($$ select public.guest_vote_shared_poll(tests.var('token'), tests.var('carla'), 'Carla', '{"1": "vielleicht"}') $$, 'P0001', 'invalid_input', 'unbekannte Antwort');
select throws_ok($$ select public.guest_vote_shared_poll(tests.var('token'), tests.var('carla'), 'Carla', '{"1": "yes", "x": "no"}') $$, 'P0001', 'invalid_input', 'ein falscher Schlüssel verwirft alles');
select throws_ok($$ select public.guest_vote_shared_poll(tests.var('token'), tests.var('carla'), 'Carla', '[]') $$, 'P0001', 'invalid_input', 'Antworten als Objekt');
select throws_ok($$ select public.guest_vote_shared_poll(tests.var('token'), tests.var('carla'), 'Carla', '{"1": null}') $$, 'P0001', 'invalid_input', 'neuer Gast ohne Antwort');
select throws_ok($$ select public.guest_vote_shared_poll(repeat('0', 32), tests.var('carla'), 'Carla', '{"1": "yes"}') $$, 'P0001', 'share_not_found', 'unbekannter Link');
select tests.logout();
select is((select count(*)::int from public.poll_guests), 0, 'abgelehnte Versuche legen keinen Gast an');

select tests.login_anon();
select lives_ok($$ select public.guest_vote_shared_poll(tests.var('token'), tests.var('carla'), '  Carla   K. ', '{"1": "yes", "3": "maybe"}') $$, 'Carla stimmt ohne Konto ab');
select lives_ok($$ select public.guest_vote_shared_poll(tests.var('token'), tests.var('dave'), 'Dave', '{"1": "no", "2": "yes"}') $$, 'Dave stimmt ohne Konto ab');
select tests.set_var('ballot', public.shared_poll_ballot(tests.var('token'), tests.var('carla'))::text);
select is(tests.var('ballot')::jsonb #>> '{me,name}', 'Carla K.', 'Carla sieht ihren bereinigten Namen');
select is(tests.var('ballot')::jsonb #> '{me,votes}', '{"1": "yes", "3": "maybe"}'::jsonb, '… und ihre Antworten');
select is((tests.var('ballot')::jsonb #>> '{options,0,yes}')::int, 1, 'Zusagen je Vorschlag');
select is((tests.var('ballot')::jsonb #>> '{options,0,no}')::int, 1, 'Absagen je Vorschlag');
select ok(tests.var('ballot') !~ 'Dave', 'Namen anderer Gäste stehen nicht auf dem Stimmzettel');
select ok(public.shared_poll_ballot(tests.var('token'), repeat('e', 64)) -> 'me' = 'null'::jsonb, 'fremdes Geheimnis: kein Stand');

-- Antwort ändern und zurückziehen – mit demselben Geheimnis, ohne neuen Gast.
select lives_ok($$ select public.guest_vote_shared_poll(tests.var('token'), tests.var('carla'), 'Carla', '{"1": "maybe", "3": null}') $$, 'Carla ändert ihre Antwort');
select is(public.shared_poll_ballot(tests.var('token'), tests.var('carla')) #> '{me,votes}', '{"1": "maybe"}'::jsonb, 'geändert und zurückgezogen');
select tests.logout();
select is((select count(*)::int from public.poll_guests), 2, 'zwei Gäste, keine Dubletten');
select is((select display_name from public.poll_guests where secret_hash = app_private.hash_token(tests.var('carla'))), 'Carla', 'Name wird mitgeändert');
select ok((select secret_hash from public.poll_guests where display_name = 'Carla') <> tests.var('carla'), 'gespeichert wird nur der Hash');
select is((select count(*)::int from public.notifications where user_id = tests.uid('alice') and type = 'poll_vote' and payload ->> 'guest' = 'Carla K.'), 1,
  'Ersteller:in erfährt einmal von einem neuen Gast');

-- ---- Die Crew sieht Gäste, Außenstehende nicht -------------------------------------------------------
select tests.login('bob');
select is((select count(*)::int from public.poll_guests), 2, 'Mitglieder sehen die Gäste');
select is((select count(*)::int from public.poll_guest_votes), 3, '… und deren Antworten');
select throws_ok('select secret_hash from public.poll_guests', '42501', null, 'den Hash sieht auch die Crew nicht');
select throws_ok($$ select public.guest_vote_shared_poll(tests.var('token'), repeat('b', 64), 'Bob', '{"1": "yes"}') $$, 'P0001', 'already_member', 'Mitglieder stimmen nicht zusätzlich als Gast ab');
select tests.login('mallory');
select is((select count(*)::int from public.poll_guests), 0, 'Außenstehende sehen keine Gäste');
select is((select count(*)::int from public.poll_guest_votes), 0, '… und keine Gast-Stimmen');
select throws_ok($$ insert into public.poll_guest_votes (poll_id, poll_option_id, guest_id, response) values (tests.var('poll')::uuid, tests.var('opt1')::uuid, gen_random_uuid(), 'yes') $$,
  '42501', null, 'niemand schreibt Gast-Stimmen direkt');

-- Vorschau zählt Gäste mit.
select tests.login_anon();
select is((public.preview_shared_poll(tests.var('token')) #>> '{poll,voter_count}')::int, 2, 'Vorschau: zwei Gäste haben abgestimmt');
select is(public.preview_shared_poll(tests.var('token')) #>> '{poll,guests}', 'true', 'Vorschau: Mitstimmen ohne Konto möglich');

-- ---- Gäste entfernen -----------------------------------------------------------------------------------
select tests.logout();
select tests.set_var('dave_id', (select id::text from public.poll_guests where display_name = 'Dave'));
select tests.login('mallory');
select throws_ok($$ select public.remove_poll_guest(tests.var('dave_id')::uuid) $$, '42501', null, 'Außenstehende entfernen keine Gäste');
select tests.login('bob');
select throws_ok($$ select public.remove_poll_guest(tests.var('dave_id')::uuid) $$, '42501', null, 'einfache Mitglieder entfernen keine Gäste');
select tests.login('alice');
select lives_ok($$ select public.remove_poll_guest(tests.var('dave_id')::uuid) $$, 'Ersteller:in entfernt Dave');
select is((select count(*)::int from public.poll_guest_votes where guest_id = tests.var('dave_id')::uuid), 0, 'seine Stimmen sind mit weg');
select throws_ok($$ select public.remove_poll_guest(tests.var('dave_id')::uuid) $$, '42501', null, 'zweimal entfernen geht nicht');

-- ---- Ergebnis zählt Gäste mit ------------------------------------------------------------------------------
-- Alice sagt Kino zu, Bob Bowling. Gäste: Dave weg; Carla „vielleicht“ Bowling. Ein neuer Gast sagt Kino zu → Kino gewinnt.
select public.cast_vote(tests.var('opt3')::uuid, 'yes');
select tests.login('bob');
select public.cast_vote(tests.var('opt1')::uuid, 'yes');
select tests.login_anon();
select lives_ok($$ select public.guest_vote_shared_poll(tests.var('token'), repeat('f', 64), 'Fiona', '{"3": "yes"}') $$, 'Fiona sagt Kino zu');
select tests.login('alice');
select public.close_poll(tests.var('poll')::uuid);
select tests.logout();
select is((select winning_option_id::text from public.polls where id = tests.var('poll')::uuid), tests.var('opt3'), 'Kino gewinnt dank der Gast-Zusage');
select is((select is_tie from public.polls where id = tests.var('poll')::uuid), false, 'kein Gleichstand');

-- Nach dem Ende: nichts mehr ändern.
select tests.login_anon();
select is(public.shared_poll_ballot(tests.var('token')) #>> '{poll,open}', 'false', 'Stimmzettel zeigt: beendet');
select throws_ok($$ select public.guest_vote_shared_poll(tests.var('token'), tests.var('carla'), 'Carla', '{"1": "yes"}') $$, 'P0001', 'poll_closed', 'nach dem Ende keine Gast-Stimme');
select tests.login('alice');
select throws_ok($$ select public.set_poll_guests(tests.var('poll')::uuid, false) $$, 'P0001', 'poll_closed', 'Schalter nur bei laufender Abstimmung');
select throws_ok($$ select public.remove_poll_guest((select id from public.poll_guests where display_name = 'Fiona')) $$, 'P0001', 'poll_closed', 'nach dem Ende bleibt das Ergebnis');

-- ---- Ausschalten: keine neuen Stimmen, bisherige bleiben ------------------------------------------------------
select tests.set_var('poll2', public.create_poll(tests.var('crew')::uuid, 'Und Sonntag?', now() + interval '2 days',
  '[{"title":"Brunch"},{"title":"See"}]')::text);
select tests.set_var('token2', public.poll_share_token(tests.var('poll2')::uuid));
select public.set_poll_guests(tests.var('poll2')::uuid, true);
select tests.login_anon();
select public.guest_vote_shared_poll(tests.var('token2'), tests.var('carla'), 'Carla', '{"1": "yes"}');
select tests.login('alice');
select public.set_poll_guests(tests.var('poll2')::uuid, false);
select tests.login_anon();
select is(public.shared_poll_ballot(tests.var('token2'), tests.var('carla')), '{"status": "guests_off"}'::jsonb, 'ausgeschaltet: kein Stimmzettel mehr');
select throws_ok($$ select public.guest_vote_shared_poll(tests.var('token2'), tests.var('carla'), 'Carla', '{"1": "no"}') $$, 'P0001', 'guests_not_allowed', 'ausgeschaltet: keine Änderung');
select tests.logout();
select is((select count(*)::int from public.poll_guest_votes where poll_id = tests.var('poll2')::uuid), 1, 'bisherige Gast-Stimmen bleiben');
select is((select count(*)::int from public.poll_guests where poll_id = tests.var('poll2')::uuid and secret_hash = app_private.hash_token(tests.var('carla'))), 1,
  'dasselbe Geheimnis ist je Abstimmung ein eigener Gast');

-- ---- Obergrenzen ---------------------------------------------------------------------------------------------
select tests.login('alice');
select tests.set_var('poll3', public.create_poll(tests.var('crew')::uuid, 'Viele Gäste?', now() + interval '2 days', '[{"title":"Party"}]')::text);
select tests.set_var('token3', public.poll_share_token(tests.var('poll3')::uuid));
select public.set_poll_guests(tests.var('poll3')::uuid, true);
select tests.login_anon();
select is((select count(*)::int from (select public.guest_vote_shared_poll(tests.var('token3'), lpad(to_hex(g), 64, '0'), 'Gast ' || g, '{"1": "yes"}')
                                       from generate_series(1, 30) g) s), 30, '30 Gäste je Abstimmung');
select throws_ok($$ select public.guest_vote_shared_poll(tests.var('token3'), lpad(to_hex(31), 64, '0'), 'Gast 31', '{"1": "yes"}') $$, 'P0001', 'guest_limit', 'der 31. Gast wird abgewiesen');
select lives_ok($$ select public.guest_vote_shared_poll(tests.var('token3'), lpad(to_hex(1), 64, '0'), 'Gast 1', '{"1": "no"}') $$, 'bestehende Gäste ändern weiter');

-- Neue Gäste je Link und Stunde: 30 (die Obergrenze je Abstimmung greift sonst zuerst – hier direkt geprüft).
select tests.logout();
delete from public.rate_limit_hits;
delete from public.poll_guests where poll_id = tests.var('poll3')::uuid;
select tests.login_anon();
select is((select count(*)::int from (select public.guest_vote_shared_poll(tests.var('token3'), lpad(to_hex(100 + g), 64, '0'), 'Gast ' || g, '{"1": "yes"}')
                                       from generate_series(1, 30) g) s), 30, '30 neue Gäste in einer Stunde');
select tests.logout();
delete from public.poll_guests where poll_id = tests.var('poll3')::uuid;
select tests.login_anon();
select throws_ok($$ select public.guest_vote_shared_poll(tests.var('token3'), lpad(to_hex(999), 64, '0'), 'Gast', '{"1": "yes"}') $$, 'P0001', 'rate_limited', 'der 31. neue Gast je Stunde wird gebremst');

-- Stimmzettel: 240 Abrufe je Link in 10 Minuten.
select tests.logout();
delete from public.rate_limit_hits;
select tests.login_anon();
select is((select count(*)::int from (select public.shared_poll_ballot(tests.var('token3')) from generate_series(1, 240)) s), 240, '240 Abrufe des Stimmzettels');
select throws_ok($$ select public.shared_poll_ballot(tests.var('token3')) $$, 'P0001', 'rate_limited', 'der 241. wird gebremst');
select is(public.shared_poll_ballot(repeat('a', 32)), '{"status": "not_found"}'::jsonb, 'unbekannter Link: not_found ohne Zähler');

-- Gelöschte Abstimmung nimmt Gäste und Stimmen mit.
select tests.logout();
delete from public.polls where id = tests.var('poll2')::uuid;
select is((select count(*)::int from public.poll_guests where poll_id = tests.var('poll2')::uuid), 0, 'Gäste verschwinden mit der Abstimmung');

select * from finish();
rollback;
