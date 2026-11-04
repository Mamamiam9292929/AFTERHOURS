-- W10 Etappe 2: Gast-Zusage beim Plan ins eigene Konto übernehmen – nur mit dem eigenen Geheimnis, nur als
-- Mitglied, nur solange der Plan läuft, eigene Antwort hat Vorrang, niemand steht doppelt bei „Wer“.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Dana');
select tests.make_user('Emil');
select tests.make_user('Mallory');

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew', '🎳')::text);
select tests.set_var('invite', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('mallory');
select public.create_crew('Fremde Crew');

select tests.logout();
insert into public.plans (crew_id, created_by, title, starts_at, status) values
  (tests.var('crew')::uuid, tests.uid('alice'), 'Bowling', now() + interval '3 days', 'confirmed'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Kino', now() + interval '4 days', 'confirmed');
select tests.set_var(lower(title), id::text) from public.plans where title in ('Bowling', 'Kino');
insert into public.plan_participants (plan_id, user_id, attendance_status) values
  (tests.var('bowling')::uuid, tests.uid('alice'), 'going');

select tests.login('alice');
select tests.set_var('token', public.plan_share_token(tests.var('bowling')::uuid));
select tests.set_var('token_kino', public.plan_share_token(tests.var('kino')::uuid));
select public.set_plan_guests(tests.var('bowling')::uuid, true);
select public.set_plan_guests(tests.var('kino')::uuid, true);

select tests.set_var('dana', repeat('d', 64));
select tests.set_var('emil', repeat('e', 64));
select tests.set_var('frida', repeat('f', 64));
select tests.set_var('georg', repeat('a', 64));

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.plan_guest_claim_preview(uuid, text)', 'execute'), 'anon fragt keinen Gast ab');
select ok(not has_function_privilege('anon', 'public.claim_plan_guest(uuid, text, boolean)', 'execute'), 'anon übernimmt keine Gast-Antwort');
select ok(has_function_privilege('authenticated', 'public.claim_plan_guest(uuid, text, boolean)', 'execute'), 'angemeldete Mitglieder dürfen übernehmen');

-- Dana, Emil und Frida (noch ohne Konto bzw. nicht in der Crew) antworten über den Link.
select tests.login_anon();
select public.guest_rsvp_shared_plan(tests.var('token'), tests.var('dana'), 'Dana', 'going');
select public.guest_rsvp_shared_plan(tests.var('token'), tests.var('emil'), 'Emil', 'maybe');
select public.guest_rsvp_shared_plan(tests.var('token'), tests.var('frida'), 'Frida', 'declined');

-- ---- Außenstehende: nichts -----------------------------------------------------------------------
select tests.login('mallory');
select throws_ok($$ select public.plan_guest_claim_preview(tests.var('bowling')::uuid, tests.var('dana')) $$, '42501', null,
  'Außenstehende fragen nicht ab – auch mit dem richtigen Geheimnis');
select throws_ok($$ select public.claim_plan_guest(tests.var('bowling')::uuid, tests.var('dana'), true) $$, '42501', null,
  'Außenstehende übernehmen keine fremde Gast-Antwort');
select throws_ok($$ select public.claim_plan_guest(gen_random_uuid(), tests.var('dana'), true) $$, '42501', null,
  'unbekannter Plan verrät nichts');

-- Dana registriert sich und tritt bei – damit ist sie zum Plan eingeladen, hat aber noch nicht geantwortet.
select tests.login('dana');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Dana tritt bei');
select is((select attendance_status::text from public.plan_participants where plan_id = tests.var('bowling')::uuid and user_id = tests.uid('dana')),
  'invited', 'Dana ist eingeladen, ohne eigene Antwort');

-- ---- Vorschau ------------------------------------------------------------------------------------
select is(public.plan_guest_claim_preview(tests.var('bowling')::uuid, 'kurz'), '{"status": "none"}'::jsonb, 'ungültiges Geheimnis: none');
select is(public.plan_guest_claim_preview(tests.var('bowling')::uuid, repeat('b', 64)), '{"status": "none"}'::jsonb, 'unbekanntes Geheimnis: none');
select is(public.plan_guest_claim_preview(tests.var('kino')::uuid, tests.var('dana')), '{"status": "none"}'::jsonb, 'Geheimnis gilt nur für seinen Plan');
select is(public.plan_guest_claim_preview(tests.var('bowling')::uuid, tests.var('dana')),
  '{"status": "found", "name": "Dana", "answer": "going", "own": null}'::jsonb, 'eigenes Geheimnis: Name und Gast-Antwort, noch keine eigene');

-- ---- Angriffe aus der Crew ---------------------------------------------------------------------------
select throws_ok($$ select public.claim_plan_guest(tests.var('bowling')::uuid, repeat('b', 64), true) $$, 'P0001', 'plan_guest_not_found',
  'fremdes (erratenes) Geheimnis: kein Gast');
select throws_ok($$ select public.claim_plan_guest(tests.var('kino')::uuid, tests.var('dana'), true) $$, 'P0001', 'plan_guest_not_found',
  'Geheimnis aus einem anderen Plan: kein Gast');
select throws_ok($$ select public.claim_plan_guest(tests.var('bowling')::uuid, 'kurz', true) $$, 'P0001', 'invalid_input', 'Geheimnis muss 64 Hex-Zeichen haben');
select throws_ok($$ select public.claim_plan_guest(tests.var('bowling')::uuid, tests.var('dana'), null) $$, 'P0001', 'invalid_input', 'ohne Entscheidung nichts');
select throws_ok($$ select public.guest_rsvp_shared_plan(tests.var('token'), tests.var('dana'), 'Dana', 'maybe') $$, 'P0001', 'plan_guest_member',
  'als Mitglied nicht mehr zusätzlich als Gast');

-- ---- Übernehmen ----------------------------------------------------------------------------------
select tests.logout();
select tests.set_var('going_before', (
  (select count(*) from public.plan_participants where plan_id = tests.var('bowling')::uuid and attendance_status = 'going')
  + (select count(*) from public.plan_guests where plan_id = tests.var('bowling')::uuid and attendance_status = 'going'))::text);
delete from public.notifications;
select tests.login('dana');
select is(public.claim_plan_guest(tests.var('bowling')::uuid, tests.var('dana'), true), '{"claimed": true, "status": "going"}'::jsonb,
  'Gast-Zusage übernommen');
select tests.logout();
select is((select attendance_status::text from public.plan_participants where plan_id = tests.var('bowling')::uuid and user_id = tests.uid('dana')),
  'going', 'Dana ist jetzt selbst dabei');
select isnt((select responded_at from public.plan_participants where plan_id = tests.var('bowling')::uuid and user_id = tests.uid('dana')),
  null, 'mit Zeitpunkt der Antwort');
select is((select count(*)::int from public.plan_guests where plan_id = tests.var('bowling')::uuid and display_name = 'Dana'), 0, 'der Gast Dana ist weg');
select is((select count(*)::int from public.plan_guests where plan_id = tests.var('bowling')::uuid), 2, 'andere Gäste bleiben unberührt');
select is((
  (select count(*) from public.plan_participants where plan_id = tests.var('bowling')::uuid and attendance_status = 'going')
  + (select count(*) from public.plan_guests where plan_id = tests.var('bowling')::uuid and attendance_status = 'going'))::text,
  tests.var('going_before'), 'niemand doppelt: die Zahl der Zusagen bleibt gleich');
select is((select count(*)::int from public.notifications), 0, 'keine zweite Benachrichtigung an die Organisatorin');
select is((select count(*)::int from public.audit_log where action = 'plan_guest_claimed' and actor_id = tests.uid('dana')), 1, 'Übernahme steht im Audit-Log');

select tests.login('dana');
select is(public.plan_guest_claim_preview(tests.var('bowling')::uuid, tests.var('dana')), '{"status": "none"}'::jsonb, 'danach gibt es nichts mehr zu übernehmen');
select throws_ok($$ select public.claim_plan_guest(tests.var('bowling')::uuid, tests.var('dana'), true) $$, 'P0001', 'plan_guest_not_found', 'zweimal übernehmen geht nicht');

-- ---- Eigene Antwort hat Vorrang -------------------------------------------------------------------------
select tests.login('emil');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Emil tritt bei');
select public.set_attendance(tests.var('bowling')::uuid, 'declined');
select is(public.plan_guest_claim_preview(tests.var('bowling')::uuid, tests.var('emil')),
  '{"status": "found", "name": "Emil", "answer": "maybe", "own": "declined"}'::jsonb, 'Vorschau zeigt die eigene Antwort');
select is(public.claim_plan_guest(tests.var('bowling')::uuid, tests.var('emil'), true), '{"claimed": false, "status": "declined"}'::jsonb,
  'eigene Antwort bleibt, Gast-Antwort verfällt');
select tests.logout();
select is((select attendance_status::text from public.plan_participants where plan_id = tests.var('bowling')::uuid and user_id = tests.uid('emil')),
  'declined', 'Emils eigene Absage bleibt');
select is((select count(*)::int from public.plan_guests where plan_id = tests.var('bowling')::uuid and display_name = 'Emil'), 0, 'der Gast Emil ist weg');

-- ---- Löschen statt übernehmen ------------------------------------------------------------------------
-- Nur wer das Geheimnis hat (Fridas Gerät), räumt den Gast so weg; Alice' eigene Antwort ändert das nicht.
select tests.login('alice');
select throws_ok($$ select public.claim_plan_guest(tests.var('bowling')::uuid, repeat('c', 64), false) $$, 'P0001', 'plan_guest_not_found',
  'ohne Geheimnis kein Löschen über diesen Weg');
select is(public.claim_plan_guest(tests.var('bowling')::uuid, tests.var('frida'), false), '{"claimed": false, "status": "going"}'::jsonb,
  'Gast-Antwort gelöscht, eigene Antwort bleibt');
select tests.logout();
select is((select count(*)::int from public.plan_guests where plan_id = tests.var('bowling')::uuid), 0, 'kein Gast mehr');
select is((select attendance_status::text from public.plan_participants where plan_id = tests.var('bowling')::uuid and user_id = tests.uid('alice')),
  'going', 'Alice bleibt dabei');
select is((select count(*)::int from public.audit_log where action = 'plan_guest_discarded'), 1, 'Löschen steht im Audit-Log');

-- Mit „Löschen“ bekommt, wer noch keine Antwort hat, auch keine.
select tests.login_anon();
select public.guest_rsvp_shared_plan(tests.var('token_kino'), tests.var('dana'), 'Dana', 'going');
select tests.login('dana');
select is(public.claim_plan_guest(tests.var('kino')::uuid, tests.var('dana'), false), '{"claimed": false, "status": null}'::jsonb,
  'gelöscht, ohne Antwort zu übernehmen');
select tests.logout();
select is((select attendance_status::text from public.plan_participants where plan_id = tests.var('kino')::uuid and user_id = tests.uid('dana')),
  'invited', 'Dana bleibt beim Kino ohne Antwort');

-- ---- Abgeschlossen oder abgesagt: alles bleibt, wie es war ------------------------------------------------
select tests.login_anon();
select public.guest_rsvp_shared_plan(tests.var('token'), tests.var('georg'), 'Georg', 'going');
select tests.logout();
update public.plans set status = 'completed' where id = tests.var('bowling')::uuid;
select tests.login('alice');
select is(public.plan_guest_claim_preview(tests.var('bowling')::uuid, tests.var('georg')), '{"status": "none"}'::jsonb, 'abgeschlossen: kein Hinweis mehr');
select throws_ok($$ select public.claim_plan_guest(tests.var('bowling')::uuid, tests.var('georg'), true) $$, 'P0001', 'plan_locked', 'abgeschlossen: keine Übernahme');
select tests.logout();
update public.plans set status = 'cancelled' where id = tests.var('bowling')::uuid;
select tests.login('alice');
select throws_ok($$ select public.claim_plan_guest(tests.var('bowling')::uuid, tests.var('georg'), false) $$, 'P0001', 'plan_locked', 'abgesagt: kein Löschen');
select tests.logout();
select is((select count(*)::int from public.plan_guests where plan_id = tests.var('bowling')::uuid), 1, 'Georg steht weiter beim Plan');

-- ---- Rate Limit ----------------------------------------------------------------------------------------
-- 20 Übernahmen bzw. Löschungen je Person und Stunde (ein Geheimnis zu erraten ist bei 256 Bit ohnehin aussichtslos).
select tests.login_anon();
select count(*) from (select public.guest_rsvp_shared_plan(tests.var('token_kino'), lpad(to_hex(g), 64, '0'), 'Gast ' || g, 'going')
                      from generate_series(1, 21) g) s;
select tests.logout();
delete from public.rate_limit_hits;
select tests.login('alice');
select is((select count(*)::int from (select public.claim_plan_guest(tests.var('kino')::uuid, lpad(to_hex(g), 64, '0'), false)
                                       from generate_series(1, 20) g) s), 20, '20 Mal je Stunde');
select throws_ok($$ select public.claim_plan_guest(tests.var('kino')::uuid, lpad(to_hex(21), 64, '0'), false) $$, 'P0001', 'rate_limited', 'das 21. Mal wird gebremst');

select * from finish();
rollback;
