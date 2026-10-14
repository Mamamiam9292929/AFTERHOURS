-- W3 Etappe 3: Gäste treten vom Stimmzettel aus der Crew bei – nur nach Freigabe durch Owner/Admin,
-- nur wer abgestimmt hat (eigenes Geheimnis), persönlicher Link einmal gültig, widerrufbar.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Carla');
select tests.make_user('Mallory');

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew', '🎳')::text);
select tests.set_var('invite', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Bob tritt bei');

-- Bob (einfaches Mitglied) erstellt die Abstimmung und lässt Gäste mitstimmen.
select tests.set_var('poll', public.create_poll(
  tests.var('crew')::uuid, 'Was machen wir am Samstag?', now() + interval '2 days',
  '[{"title":"Bowling"},{"title":"Kino"}]')::text);
select tests.set_var('token', public.poll_share_token(tests.var('poll')::uuid));

select tests.set_var('carla', repeat('c', 64));
select tests.set_var('dave', repeat('d', 64));
select tests.set_var('erik', repeat('e', 64));

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(has_function_privilege('anon', 'public.guest_join_shared_poll(text, text)', 'execute'), 'anon darf als Gast einen Beitrittslink holen');
select ok(not has_function_privilege('anon', 'public.set_poll_guest_join(uuid, boolean)', 'execute'), 'anon schaltet den Beitritt nicht frei');
select ok(not has_function_privilege('authenticated', 'app_private.poll_guest_join_open(public.polls)', 'execute'), 'interne Prüfung nicht aufrufbar');
select ok(not has_column_privilege('authenticated', 'public.crew_invitations', 'via_poll_guest_id', 'select'), 'welcher Gast welchen Link hat, liest niemand über die API');

-- ---- Freischalten: nur Owner/Admin, nur mit Gästen ------------------------------------------------
select throws_ok($$ select public.set_poll_guest_join(tests.var('poll')::uuid, true) $$, '42501', null,
  'Ersteller:in ohne Admin-Rolle lädt niemanden in die Crew ein');
select tests.login('mallory');
select throws_ok($$ select public.set_poll_guest_join(tests.var('poll')::uuid, true) $$, '42501', null, 'Außenstehende schalten nichts frei');
select tests.login('alice');
select throws_ok($$ select public.set_poll_guest_join(tests.var('poll')::uuid, true) $$, 'P0001', 'guests_not_allowed',
  'ohne „Gäste dürfen mitstimmen“ kein Beitritt');
select throws_ok($$ select public.set_poll_guest_join(tests.var('poll')::uuid, null) $$, 'P0001', 'invalid_input', 'ohne Wert keine Änderung');

select tests.login('bob');
select public.set_poll_guests(tests.var('poll')::uuid, true);

-- Gäste stimmen ab, solange der Beitritt aus ist.
select tests.login_anon();
select public.guest_vote_shared_poll(tests.var('token'), tests.var('carla'), 'Carla', '{"1": "yes"}');
select public.guest_vote_shared_poll(tests.var('token'), tests.var('dave'), 'Dave', '{"2": "yes"}');
select public.guest_vote_shared_poll(tests.var('token'), tests.var('erik'), 'Erik', '{"1": "maybe"}');
select is(public.shared_poll_ballot(tests.var('token'), tests.var('carla')) #>> '{poll,can_join}', 'false', 'Standard: kein Beitritt');
select throws_ok($$ select public.guest_join_shared_poll(tests.var('token'), tests.var('carla')) $$, 'P0001', 'guest_join_off',
  'ohne Freigabe kein Einladungslink');

select tests.login('alice');
select lives_ok($$ select public.set_poll_guest_join(tests.var('poll')::uuid, true) $$, 'Owner schaltet den Beitritt frei');
select lives_ok($$ select public.set_poll_guest_join(tests.var('poll')::uuid, true) $$, 'erneutes Einschalten ändert nichts');
select is((select guest_join_by from public.polls where id = tests.var('poll')::uuid), tests.uid('alice'), 'gespeichert ist, wer freigeschaltet hat');
select tests.logout();
select is((select count(*)::int from public.audit_log where action = 'poll_guest_join'), 1, 'Freigabe steht einmal im Audit-Log');

-- ---- Stimmzettel und Link ---------------------------------------------------------------------------
select tests.login_anon();
select tests.set_var('ballot', public.shared_poll_ballot(tests.var('token'), tests.var('carla'))::text);
select is(tests.var('ballot')::jsonb #>> '{poll,can_join}', 'true', 'Stimmzettel zeigt: Beitritt möglich');
select ok(tests.var('ballot') !~* '(Weekend|Alice|Bob)', 'der Stimmzettel verrät weiterhin weder Crew noch Mitglieder');

select throws_ok($$ select public.guest_join_shared_poll(tests.var('token'), 'kurz') $$, 'P0001', 'invalid_input', 'Geheimnis muss 64 Hex-Zeichen haben');
select throws_ok($$ select public.guest_join_shared_poll(tests.var('token'), repeat('f', 64)) $$, 'P0001', 'guest_not_found',
  'wer nicht abgestimmt hat, bekommt keinen Link');
select throws_ok($$ select public.guest_join_shared_poll(repeat('0', 32), tests.var('carla')) $$, 'P0001', 'share_not_found', 'unbekannter Abstimmungs-Link');

select tests.set_var('carla_link1', public.guest_join_shared_poll(tests.var('token'), tests.var('carla')) ->> 'token');
select ok(tests.var('carla_link1') ~ '^[0-9a-f]{64}$', 'Carla bekommt einen Einladungslink');
select is(public.preview_public_invitation(tests.var('carla_link1')) ->> 'status', 'valid', 'der Link ist eine gültige Einladung');
select is(public.preview_public_invitation(tests.var('carla_link1')) ->> 'invited_by', 'Alice', '… von der Person, die freigeschaltet hat');

-- Erneut anfordern: alter Link verfällt, je Gast höchstens ein offener Link.
select tests.set_var('carla_link', public.guest_join_shared_poll(tests.var('token'), tests.var('carla')) ->> 'token');
select isnt(tests.var('carla_link'), tests.var('carla_link1'), 'neuer Link bei erneutem Anfordern');
select is(public.preview_public_invitation(tests.var('carla_link1')) ->> 'status', 'revoked', 'der alte Link ist widerrufen');
select tests.logout();
select is((select max_uses from public.crew_invitations where token_hash = app_private.hash_token(tests.var('carla_link'))), 1, 'Gast-Link gilt einmal');
select ok((select expires_at from public.crew_invitations where token_hash = app_private.hash_token(tests.var('carla_link'))) <= now() + interval '7 days',
  'Gast-Link gilt höchstens 7 Tage');
select is((select count(*)::int from public.crew_invitations where via_poll_id = tests.var('poll')::uuid and revoked_at is null), 1,
  'genau ein offener Gast-Link');

-- ---- Gast-Links zählen nicht gegen die Grenze von 10 offenen Einladungen -----------------------------
select tests.login('alice');
select public.create_crew_invitation(tests.var('crew')::uuid) from generate_series(1, 9);
select throws_ok($$ select public.create_crew_invitation(tests.var('crew')::uuid) $$, 'P0001', 'too_many_invitations',
  'die Grenze gilt weiterhin für normale Einladungen');
select is((select count(*)::int from public.crew_invitations where via_poll_id is not null), 2, 'Owner sehen Gast-Links (zum Ausblenden)');

-- ---- Beitreten ---------------------------------------------------------------------------------------
select tests.login('carla');
select is(public.accept_crew_invitation(tests.var('carla_link')) ->> 'status', 'joined', 'Carla registriert sich und tritt mit ihrem Link bei');
select throws_ok($$ select public.guest_join_shared_poll(tests.var('token'), tests.var('carla')) $$, 'P0001', 'already_member',
  'Mitglieder holen keinen weiteren Link');
-- Carla übernimmt ihre Gast-Stimme (Etappe 2) – ihr Link ist verbraucht, nichts bleibt offen.
select is((public.claim_poll_guest(tests.var('poll')::uuid, tests.var('carla'), true) ->> 'claimed')::int, 1, 'Carla übernimmt ihre Gast-Stimme');
select tests.login('mallory');
select is(public.accept_crew_invitation(tests.var('carla_link')) ->> 'status', 'exhausted', 'ein weitergegebener Gast-Link funktioniert kein zweites Mal');

-- ---- Gast entfernen: sein offener Link verfällt ------------------------------------------------------
select tests.login_anon();
select tests.set_var('dave_link', public.guest_join_shared_poll(tests.var('token'), tests.var('dave')) ->> 'token');
select tests.login('alice');
select public.remove_poll_guest((select id from public.poll_guests where display_name = 'Dave'));
select tests.login_anon();
select is(public.preview_public_invitation(tests.var('dave_link')) ->> 'status', 'revoked', 'entfernter Gast: Link widerrufen');

-- ---- Ausschalten widerruft offene Gast-Links -----------------------------------------------------------
select tests.set_var('erik_link', public.guest_join_shared_poll(tests.var('token'), tests.var('erik')) ->> 'token');
select tests.login('alice');
select lives_ok($$ select public.set_poll_guest_join(tests.var('poll')::uuid, false) $$, 'Owner schaltet den Beitritt aus');
select tests.login_anon();
select is(public.preview_public_invitation(tests.var('erik_link')) ->> 'status', 'revoked', 'offene Gast-Links sind ungültig');
select is(public.shared_poll_ballot(tests.var('token'), tests.var('erik')) #>> '{poll,can_join}', 'false', 'Stimmzettel: kein Beitritt mehr');
select throws_ok($$ select public.guest_join_shared_poll(tests.var('token'), tests.var('erik')) $$, 'P0001', 'guest_join_off', 'ausgeschaltet: kein neuer Link');
select tests.logout();
select is(public.preview_public_invitation(tests.var('invite')) ->> 'status', 'valid', 'normale Einladungen bleiben gültig');

-- „Gäste dürfen mitstimmen“ aus schaltet auch den Beitritt aus.
select tests.login('alice');
select public.set_poll_guest_join(tests.var('poll')::uuid, true);
select public.set_poll_guests(tests.var('poll')::uuid, false);
select is((select guest_join_by from public.polls where id = tests.var('poll')::uuid), null, 'ohne Gäste kein Beitritt');

-- Wer freigeschaltet hat und kein Owner/Admin mehr ist, lädt niemanden mehr ein.
select public.set_poll_guests(tests.var('poll')::uuid, true);
select public.set_crew_member_role(tests.var('crew')::uuid, tests.uid('bob'), 'admin');
select tests.login('bob');
select lives_ok($$ select public.set_poll_guest_join(tests.var('poll')::uuid, true) $$, 'Admin schaltet frei');
select tests.login('alice');
select public.set_crew_member_role(tests.var('crew')::uuid, tests.uid('bob'), 'member');
select tests.login_anon();
select is(public.shared_poll_ballot(tests.var('token'), tests.var('erik')) #>> '{poll,can_join}', 'false', 'Rolle verloren: Beitritt gilt nicht mehr');
select throws_ok($$ select public.guest_join_shared_poll(tests.var('token'), tests.var('erik')) $$, 'P0001', 'guest_join_off', '… und kein Link');

-- Nach dem Ende: nicht mehr einschaltbar.
select tests.logout();
update public.polls set ends_at = now() - interval '1 minute' where id = tests.var('poll')::uuid;
select tests.login('alice');
select throws_ok($$ select public.set_poll_guest_join(tests.var('poll')::uuid, true) $$, 'P0001', 'poll_closed', 'abgelaufen: kein Einschalten');
select lives_ok($$ select public.set_poll_guest_join(tests.var('poll')::uuid, false) $$, 'Ausschalten geht immer');

-- Löschen der Abstimmung (z. B. mit der Crew) mit Gästen und Gast-Links klappt ohne Konflikt.
select tests.logout();
select lives_ok($$ delete from public.polls where id = tests.var('poll')::uuid $$, 'Abstimmung mit Gast-Links lässt sich löschen');
select is((select count(*)::int from public.crew_invitations where via_poll_id is not null or via_poll_guest_id is not null), 0, 'Gast-Links verschwinden mit');

select * from finish();
rollback;
