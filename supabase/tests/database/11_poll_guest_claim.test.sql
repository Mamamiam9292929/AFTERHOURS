-- W3 Etappe 2: Gast-Stimmen ins eigene Konto übernehmen – nur mit dem eigenen Geheimnis, nur als
-- Mitglied, nur bei laufender Abstimmung, ohne doppelte Stimme.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Carla');
select tests.make_user('Mallory');

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew', '🎳')::text);
select tests.set_var('invite', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.set_var('poll', public.create_poll(
  tests.var('crew')::uuid, 'Was machen wir am Samstag?', now() + interval '2 days',
  '[{"title":"Bowling"},{"title":"Kino"},{"title":"Grillen"}]')::text);
select tests.set_var('token', public.poll_share_token(tests.var('poll')::uuid));
select public.set_poll_guests(tests.var('poll')::uuid, true);
select tests.set_var('opt1', (select id::text from public.poll_options where poll_id = tests.var('poll')::uuid and position = 1));
select tests.set_var('opt2', (select id::text from public.poll_options where poll_id = tests.var('poll')::uuid and position = 2));
select tests.set_var('opt3', (select id::text from public.poll_options where poll_id = tests.var('poll')::uuid and position = 3));

select tests.set_var('carla', repeat('c', 64));
select tests.set_var('dave', repeat('d', 64));

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.poll_guest_claim_preview(uuid, text)', 'execute'), 'anon fragt keinen Gast ab');
select ok(not has_function_privilege('anon', 'public.claim_poll_guest(uuid, text, boolean)', 'execute'), 'anon übernimmt keine Gast-Stimmen');
select ok(has_function_privilege('authenticated', 'public.claim_poll_guest(uuid, text, boolean)', 'execute'), 'angemeldete Mitglieder dürfen übernehmen');

-- Carla (noch ohne Konto) und Dave stimmen als Gäste ab.
select tests.login_anon();
select public.guest_vote_shared_poll(tests.var('token'), tests.var('carla'), 'Carla', '{"1": "yes", "2": "maybe", "3": "no"}');
select public.guest_vote_shared_poll(tests.var('token'), tests.var('dave'), 'Dave', '{"1": "no"}');

-- ---- Außenstehende: nichts -----------------------------------------------------------------------
select tests.login('mallory');
select throws_ok($$ select public.poll_guest_claim_preview(tests.var('poll')::uuid, tests.var('carla')) $$, '42501', null,
  'Außenstehende fragen nicht ab – auch mit dem richtigen Geheimnis');
select throws_ok($$ select public.claim_poll_guest(tests.var('poll')::uuid, tests.var('carla'), true) $$, '42501', null,
  'Außenstehende übernehmen keine fremden Gast-Stimmen');
select throws_ok($$ select public.claim_poll_guest(gen_random_uuid(), tests.var('carla'), true) $$, '42501', null,
  'unbekannte Abstimmung verrät nichts');

-- Carla registriert sich, tritt bei und antwortet als Mitglied zuerst selbst zu „Grillen“
-- (das kollidiert mit ihrer Gast-Antwort).
select tests.login('carla');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Carla tritt bei');
select public.cast_vote(tests.var('opt3')::uuid, 'yes');

-- ---- Vorschau ------------------------------------------------------------------------------------
select is(public.poll_guest_claim_preview(tests.var('poll')::uuid, 'kurz'), '{"status": "none"}'::jsonb, 'ungültiges Geheimnis: none');
select is(public.poll_guest_claim_preview(tests.var('poll')::uuid, repeat('e', 64)), '{"status": "none"}'::jsonb, 'unbekanntes Geheimnis: none');
select is(public.poll_guest_claim_preview(tests.var('poll')::uuid, tests.var('carla')),
  '{"status": "found", "name": "Carla", "votes": 3, "conflicts": 1}'::jsonb, 'eigenes Geheimnis: Name, drei Antworten, eine schon selbst beantwortet');

-- ---- Angriffe aus der Crew ---------------------------------------------------------------------------
select throws_ok($$ select public.claim_poll_guest(tests.var('poll')::uuid, repeat('e', 64), true) $$, 'P0001', 'guest_not_found',
  'fremdes (erratenes) Geheimnis: kein Gast');
select throws_ok($$ select public.claim_poll_guest(tests.var('poll')::uuid, 'kurz', true) $$, 'P0001', 'invalid_input', 'Geheimnis muss 64 Hex-Zeichen haben');
select throws_ok($$ select public.claim_poll_guest(tests.var('poll')::uuid, tests.var('carla'), null) $$, 'P0001', 'invalid_input', 'ohne Entscheidung nichts');
select throws_ok($$ select public.guest_vote_shared_poll(tests.var('token'), tests.var('carla'), 'Carla', '{"1": "no"}') $$, 'P0001', 'already_member',
  'als Mitglied nicht mehr zusätzlich als Gast');

-- ---- Übernehmen ----------------------------------------------------------------------------------
select tests.logout();
select tests.set_var('yes_before', (select string_agg(c.yes_count::text, ',' order by c.option_id) from app_private.poll_yes_counts(tests.var('poll')::uuid) c));
select tests.login('carla');
select is(public.claim_poll_guest(tests.var('poll')::uuid, tests.var('carla'), true), '{"kept": 1, "claimed": 2}'::jsonb,
  'zwei Antworten übernommen, bei einer blieb die eigene');
select tests.logout();
select is((select response::text from public.poll_votes where poll_option_id = tests.var('opt1')::uuid and user_id = tests.uid('carla')), 'yes', 'Bowling: Gast-Zusage gehört jetzt Carla');
select is((select response::text from public.poll_votes where poll_option_id = tests.var('opt2')::uuid and user_id = tests.uid('carla')), 'maybe', 'Kino: Vielleicht übernommen');
select is((select response::text from public.poll_votes where poll_option_id = tests.var('opt3')::uuid and user_id = tests.uid('carla')), 'yes', 'Grillen: die eigene Antwort bleibt');
select is((select count(*)::int from public.poll_guests where poll_id = tests.var('poll')::uuid and display_name = 'Carla'), 0, 'der Gast Carla ist weg');
select is((select count(*)::int from public.poll_guest_votes g join public.poll_guests p on p.id = g.guest_id where p.display_name = 'Dave'), 1, 'andere Gäste bleiben unberührt');
select is((select string_agg(c.yes_count::text, ',' order by c.option_id) from app_private.poll_yes_counts(tests.var('poll')::uuid) c),
  tests.var('yes_before'), 'keine doppelte Stimme: die Zusagen je Vorschlag bleiben gleich');
select is((select count(*)::int from public.audit_log where action = 'poll_guest_claimed' and actor_id = tests.uid('carla')), 1, 'Übernahme steht im Audit-Log');

select tests.login('carla');
select is(public.poll_guest_claim_preview(tests.var('poll')::uuid, tests.var('carla')), '{"status": "none"}'::jsonb, 'danach gibt es nichts mehr zu übernehmen');
select throws_ok($$ select public.claim_poll_guest(tests.var('poll')::uuid, tests.var('carla'), true) $$, 'P0001', 'guest_not_found', 'zweimal übernehmen geht nicht');

-- ---- Löschen statt übernehmen ------------------------------------------------------------------------
-- Mallory kennt Daves Geheimnis nicht; Alice (Mitglied) kennt es auch nicht – nur Daves Gerät.
select tests.login('alice');
select throws_ok($$ select public.claim_poll_guest(tests.var('poll')::uuid, repeat('f', 64), false) $$, 'P0001', 'guest_not_found', 'ohne Geheimnis kein Löschen über diesen Weg');
-- Wer das Geheimnis hat, darf die eigene Gast-Stimme verwerfen.
select is(public.claim_poll_guest(tests.var('poll')::uuid, tests.var('dave'), false), '{"kept": 0, "claimed": 0}'::jsonb, 'Gast-Stimme gelöscht, nichts übernommen');
select tests.logout();
select is((select count(*)::int from public.poll_guests where poll_id = tests.var('poll')::uuid), 0, 'kein Gast mehr');
select is((select count(*)::int from public.poll_votes where poll_id = tests.var('poll')::uuid and user_id = tests.uid('alice')), 0, 'Alice hat dadurch keine Stimme bekommen');
select is((select count(*)::int from public.audit_log where action = 'poll_guest_discarded'), 1, 'Löschen steht im Audit-Log');

-- ---- Nach dem Ende: das Ergebnis bleibt -----------------------------------------------------------------
select tests.login_anon();
select public.guest_vote_shared_poll(tests.var('token'), tests.var('dave'), 'Dave', '{"2": "yes"}');
select tests.login('alice');
select public.close_poll(tests.var('poll')::uuid);
select is(public.poll_guest_claim_preview(tests.var('poll')::uuid, tests.var('dave')), '{"status": "none"}'::jsonb, 'beendet: kein Hinweis mehr');
select throws_ok($$ select public.claim_poll_guest(tests.var('poll')::uuid, tests.var('dave'), true) $$, 'P0001', 'poll_closed', 'beendet: keine Übernahme');

-- ---- Rate Limit ----------------------------------------------------------------------------------------
-- 20 Übernahmen bzw. Löschungen je Person und Stunde (ein Geheimnis zu erraten ist bei 256 Bit ohnehin aussichtslos).
select tests.set_var('poll2', public.create_poll(tests.var('crew')::uuid, 'Und Sonntag?', now() + interval '2 days', '[{"title":"Brunch"}]')::text);
select tests.set_var('token2', public.poll_share_token(tests.var('poll2')::uuid));
select public.set_poll_guests(tests.var('poll2')::uuid, true);
select tests.login_anon();
select count(*) from (select public.guest_vote_shared_poll(tests.var('token2'), lpad(to_hex(g), 64, '0'), 'Gast ' || g, '{"1": "yes"}')
                      from generate_series(1, 21) g) s;
select tests.logout();
delete from public.rate_limit_hits;
select tests.login('alice');
select is((select count(*)::int from (select public.claim_poll_guest(tests.var('poll2')::uuid, lpad(to_hex(g), 64, '0'), false)
                                       from generate_series(1, 20) g) s), 20, '20 Mal je Stunde');
select throws_ok($$ select public.claim_poll_guest(tests.var('poll2')::uuid, lpad(to_hex(21), 64, '0'), false) $$, 'P0001', 'rate_limited', 'das 21. Mal wird gebremst');

select * from finish();
rollback;
