-- W11: Gäste treten vom Plan-Link aus der Crew bei – nur nach Freigabe durch Owner/Admin, nur wer als Gast
-- geantwortet hat (eigenes Geheimnis), persönlicher Link einmal gültig, widerrufbar, nicht bei Absage.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Dana');
select tests.make_user('Mallory');

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew', '🎳')::text);
select tests.set_var('invite', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Bob tritt bei');
select tests.login('mallory');
select tests.set_var('mallory_crew', public.create_crew('Fremde Crew')::text);

-- Bob (einfaches Mitglied) organisiert „Bowling“ und lässt über den Link zusagen.
select tests.logout();
insert into public.plans (crew_id, created_by, title, starts_at, status) values
  (tests.var('crew')::uuid, tests.uid('bob'), 'Bowling', now() + interval '3 days', 'confirmed');
select tests.set_var('bowling', (select id::text from public.plans where title = 'Bowling'));
select tests.login('bob');
select tests.set_var('token', public.plan_share_token(tests.var('bowling')::uuid));
select public.set_plan_guests(tests.var('bowling')::uuid, true);

select tests.set_var('dana', repeat('d', 64));
select tests.set_var('emil', repeat('e', 64));
select tests.set_var('finn', repeat('f', 64));

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(has_function_privilege('anon', 'public.guest_join_shared_plan(text, text)', 'execute'), 'anon darf als Gast einen Beitrittslink holen');
select ok(not has_function_privilege('anon', 'public.set_plan_guest_join(uuid, boolean)', 'execute'), 'anon schaltet den Beitritt nicht frei');
select ok(not has_function_privilege('authenticated', 'app_private.plan_guest_join_open(public.plans)', 'execute'), 'interne Prüfung nicht aufrufbar');
select ok(not has_function_privilege('authenticated', 'app_private.revoke_plan_guest_invitations()', 'execute'), 'Trigger-Funktion nicht aufrufbar');
select ok(not has_column_privilege('authenticated', 'public.crew_invitations', 'via_plan_guest_id', 'select'), 'welcher Gast welchen Link hat, liest niemand über die API');
select ok(not has_table_privilege('authenticated', 'public.plans', 'update'), 'der Schalter lässt sich nicht direkt am Plan setzen');

-- ---- Gäste antworten, solange der Beitritt aus ist -------------------------------------------------
select tests.login_anon();
select public.guest_rsvp_shared_plan(tests.var('token'), tests.var('dana'), 'Dana', 'going');
select public.guest_rsvp_shared_plan(tests.var('token'), tests.var('emil'), 'Emil', 'maybe');
select public.guest_rsvp_shared_plan(tests.var('token'), tests.var('finn'), 'Finn', 'declined');
select is(public.shared_plan_rsvp(tests.var('token'), tests.var('dana')) #>> '{plan,can_join}', 'false', 'Standard: kein Beitritt');
select throws_ok($$ select public.guest_join_shared_plan(tests.var('token'), tests.var('dana')) $$, 'P0001', 'plan_guest_join_off',
  'ohne Freigabe kein Einladungslink');

-- ---- Freischalten: nur Owner/Admin -----------------------------------------------------------------
select tests.login('bob');
select throws_ok($$ select public.set_plan_guest_join(tests.var('bowling')::uuid, true) $$, '42501', null,
  'Organisator:in ohne Admin-Rolle lädt niemanden in die Crew ein');
select tests.login('mallory');
select throws_ok($$ select public.set_plan_guest_join(tests.var('bowling')::uuid, true) $$, '42501', null, 'Außenstehende schalten nichts frei');
select tests.login('alice');
select throws_ok($$ select public.set_plan_guest_join(tests.var('bowling')::uuid, null) $$, 'P0001', 'invalid_input', 'ohne Wert keine Änderung');
select throws_ok($$ select public.set_plan_guest_join(gen_random_uuid(), true) $$, '42501', null, 'unbekannter Plan');
select lives_ok($$ select public.set_plan_guest_join(tests.var('bowling')::uuid, true) $$, 'Owner schaltet den Beitritt frei');
select lives_ok($$ select public.set_plan_guest_join(tests.var('bowling')::uuid, true) $$, 'erneutes Einschalten ändert nichts');
select is((select guest_join_by from public.plans where id = tests.var('bowling')::uuid), tests.uid('alice'), 'gespeichert ist, wer freigeschaltet hat');
select tests.logout();
select is((select count(*)::int from public.audit_log where action = 'plan_guest_join'), 1, 'Freigabe steht einmal im Audit-Log');

-- ---- Zusagekarte und Link -----------------------------------------------------------------------
select tests.login_anon();
select tests.set_var('rsvp', public.shared_plan_rsvp(tests.var('token'), tests.var('dana'))::text);
select is(tests.var('rsvp')::jsonb #>> '{plan,can_join}', 'true', 'Zusagekarte zeigt: Beitritt möglich');
select ok(tests.var('rsvp') !~* '(Weekend|Alice|Bob)', 'die Zusagekarte verrät weiterhin weder Crew noch Mitglieder');
select is(tests.var('rsvp')::jsonb #>> '{me,name}', 'Dana', 'eigene Antwort weiterhin da');

select throws_ok($$ select public.guest_join_shared_plan(tests.var('token'), 'kurz') $$, 'P0001', 'invalid_input', 'Geheimnis muss 64 Hex-Zeichen haben');
select throws_ok($$ select public.guest_join_shared_plan(tests.var('token'), repeat('a', 64)) $$, 'P0001', 'plan_guest_not_found',
  'wer nicht geantwortet hat, bekommt keinen Link');
select throws_ok($$ select public.guest_join_shared_plan(repeat('0', 32), tests.var('dana')) $$, 'P0001', 'share_not_found', 'unbekannter Plan-Link');
select throws_ok($$ select public.guest_join_shared_plan(null, tests.var('dana')) $$, 'P0001', 'share_not_found', 'ohne Link nichts');

select tests.set_var('dana_link1', public.guest_join_shared_plan(tests.var('token'), tests.var('dana')) ->> 'token');
select ok(tests.var('dana_link1') ~ '^[0-9a-f]{64}$', 'Dana bekommt einen Einladungslink');
select is(public.preview_public_invitation(tests.var('dana_link1')) ->> 'status', 'valid', 'der Link ist eine gültige Einladung');
select is(public.preview_public_invitation(tests.var('dana_link1')) ->> 'invited_by', 'Alice', '… von der Person, die freigeschaltet hat');

-- Erneut anfordern: alter Link verfällt, je Gast höchstens ein offener Link.
select tests.set_var('dana_link', public.guest_join_shared_plan(tests.var('token'), tests.var('dana')) ->> 'token');
select isnt(tests.var('dana_link'), tests.var('dana_link1'), 'neuer Link bei erneutem Anfordern');
select is(public.preview_public_invitation(tests.var('dana_link1')) ->> 'status', 'revoked', 'der alte Link ist widerrufen');
select tests.logout();
select is((select max_uses from public.crew_invitations where token_hash = app_private.hash_token(tests.var('dana_link'))), 1, 'Gast-Link gilt einmal');
select ok((select expires_at from public.crew_invitations where token_hash = app_private.hash_token(tests.var('dana_link'))) <= now() + interval '7 days',
  'Gast-Link gilt höchstens 7 Tage');
select is((select count(*)::int from public.crew_invitations where via_plan_id = tests.var('bowling')::uuid and revoked_at is null), 1,
  'genau ein offener Gast-Link');

-- ---- Gast-Links zählen nicht gegen die Grenze von 10 offenen Einladungen ---------------------------
select tests.login('alice');
select public.create_crew_invitation(tests.var('crew')::uuid) from generate_series(1, 9);
select throws_ok($$ select public.create_crew_invitation(tests.var('crew')::uuid) $$, 'P0001', 'too_many_invitations',
  'die Grenze gilt weiterhin für normale Einladungen');
select is((select count(*)::int from public.crew_invitations where via_plan_id is not null), 2, 'Owner sehen Gast-Links (zum Ausblenden)');
select tests.login('bob');
select is((select count(*)::int from public.crew_invitations), 0, 'einfache Mitglieder sehen keine Einladungen');

-- ---- Beitreten und Antwort übernehmen ------------------------------------------------------------------
select tests.login('dana');
select is(public.accept_crew_invitation(tests.var('dana_link')) ->> 'status', 'joined', 'Dana registriert sich und tritt mit ihrem Link bei');
select throws_ok($$ select public.guest_join_shared_plan(tests.var('token'), tests.var('dana')) $$, 'P0001', 'plan_guest_member',
  'Mitglieder holen keinen weiteren Link');
select is(public.claim_plan_guest(tests.var('bowling')::uuid, tests.var('dana'), true) ->> 'claimed', 'true', 'Dana übernimmt ihre Gast-Zusage (W10 Etappe 2)');
select is((select attendance_status::text from public.plan_participants where plan_id = tests.var('bowling')::uuid and user_id = tests.uid('dana')),
  'going', '… und ist als sie selbst dabei');
select tests.login('mallory');
select is(public.accept_crew_invitation(tests.var('dana_link')) ->> 'status', 'exhausted', 'ein weitergegebener Gast-Link funktioniert kein zweites Mal');

-- ---- Gast entfernen: sein offener Link verfällt ------------------------------------------------------
select tests.login_anon();
select tests.set_var('emil_link', public.guest_join_shared_plan(tests.var('token'), tests.var('emil')) ->> 'token');
select tests.login('bob');
select public.remove_plan_guest((select id from public.plan_guests where display_name = 'Emil'));
select tests.login_anon();
select is(public.preview_public_invitation(tests.var('emil_link')) ->> 'status', 'revoked', 'entfernter Gast: Link widerrufen');

-- ---- Ausschalten widerruft offene Gast-Links -----------------------------------------------------------
select tests.set_var('finn_link', public.guest_join_shared_plan(tests.var('token'), tests.var('finn')) ->> 'token');
select tests.login('bob');
select throws_ok($$ select public.set_plan_guest_join(tests.var('bowling')::uuid, false) $$, '42501', null, 'einfache Mitglieder schalten auch nicht aus');
select tests.login('alice');
select lives_ok($$ select public.set_plan_guest_join(tests.var('bowling')::uuid, false) $$, 'Owner schaltet den Beitritt aus');
select tests.login_anon();
select is(public.preview_public_invitation(tests.var('finn_link')) ->> 'status', 'revoked', 'offene Gast-Links sind ungültig');
select is(public.shared_plan_rsvp(tests.var('token'), tests.var('finn')) #>> '{plan,can_join}', 'false', 'Zusagekarte: kein Beitritt mehr');
select throws_ok($$ select public.guest_join_shared_plan(tests.var('token'), tests.var('finn')) $$, 'P0001', 'plan_guest_join_off', 'ausgeschaltet: kein neuer Link');
select tests.logout();
select is(public.preview_public_invitation(tests.var('invite')) ->> 'status', 'valid', 'normale Einladungen bleiben gültig');

-- „Über den Link zusagen lassen“ aus schaltet auch den Beitritt aus und widerruft Gast-Links.
select tests.login('alice');
select public.set_plan_guest_join(tests.var('bowling')::uuid, true);
select tests.login_anon();
select tests.set_var('finn_link2', public.guest_join_shared_plan(tests.var('token'), tests.var('finn')) ->> 'token');
select tests.login('bob');
select public.set_plan_guests(tests.var('bowling')::uuid, false);
select tests.logout();
select is((select guest_join_by from public.plans where id = tests.var('bowling')::uuid), null, 'ohne Gäste kein Beitritt');
select is(public.preview_public_invitation(tests.var('finn_link2')) ->> 'status', 'revoked', '… und offene Gast-Links sind ungültig');
select tests.login('alice');
select throws_ok($$ select public.set_plan_guest_join(tests.var('bowling')::uuid, true) $$, 'P0001', 'plan_guests_off',
  'ohne „Über den Link zusagen lassen“ kein Beitritt');

-- Wer freigeschaltet hat und kein Owner/Admin mehr ist, lädt niemanden mehr ein.
select tests.login('bob');
select public.set_plan_guests(tests.var('bowling')::uuid, true);
select tests.login('alice');
select public.set_crew_member_role(tests.var('crew')::uuid, tests.uid('bob'), 'admin');
select tests.login('bob');
select lives_ok($$ select public.set_plan_guest_join(tests.var('bowling')::uuid, true) $$, 'Admin schaltet frei');
select tests.login('alice');
select public.set_crew_member_role(tests.var('crew')::uuid, tests.uid('bob'), 'member');
select tests.login_anon();
select is(public.shared_plan_rsvp(tests.var('token'), tests.var('finn')) #>> '{plan,can_join}', 'false', 'Rolle verloren: Beitritt gilt nicht mehr');
select throws_ok($$ select public.guest_join_shared_plan(tests.var('token'), tests.var('finn')) $$, 'P0001', 'plan_guest_join_off', '… und kein Link');

-- ---- Nach dem Abend: Beitritt geht weiter, bis der Link abläuft; abgesagt nicht ----------------------
select tests.login('alice');
select public.set_plan_guest_join(tests.var('bowling')::uuid, true);
select is((select guest_join_by from public.plans where id = tests.var('bowling')::uuid), tests.uid('alice'),
  'Owner schaltet wieder ein und steht jetzt als einladende Person da');
select tests.logout();
update public.plans set starts_at = now() - interval '5 hours', ends_at = now() - interval '2 hours', status = 'completed', completed_at = now()
where id = tests.var('bowling')::uuid;
select tests.login_anon();
select is(public.shared_plan_rsvp(tests.var('token'), tests.var('finn')) #>> '{plan,can_join}', 'true', 'nach dem Abend: Beitritt weiter möglich');
select is(public.shared_plan_rsvp(tests.var('token'), tests.var('finn')) #>> '{plan,open}', 'false', '… zusagen aber nicht mehr');
select ok(public.guest_join_shared_plan(tests.var('token'), tests.var('finn')) ->> 'token' ~ '^[0-9a-f]{64}$', 'Finn holt seinen Link nach dem Abend');
select tests.login('alice');
select lives_ok($$ select public.set_plan_guest_join(tests.var('bowling')::uuid, false) $$, 'Ausschalten geht auch nach dem Abschluss');
select throws_ok($$ select public.set_plan_guest_join(tests.var('bowling')::uuid, true) $$, 'P0001', 'plan_locked', 'abgeschlossen: kein Einschalten mehr');

select tests.logout();
update public.plans set starts_at = now() - interval '5 days', ends_at = now() - interval '4 days' where id = tests.var('bowling')::uuid;
update public.plans set guest_join_by = tests.uid('alice') where id = tests.var('bowling')::uuid;
select tests.login_anon();
select throws_ok($$ select public.guest_join_shared_plan(tests.var('token'), tests.var('finn')) $$, 'P0001', 'share_not_found', 'abgelaufener Plan-Link: kein Beitritt');

select tests.logout();
update public.plans set ends_at = now() - interval '1 hour', status = 'cancelled', cancelled_at = now() where id = tests.var('bowling')::uuid;
select tests.login_anon();
select is(public.shared_plan_rsvp(tests.var('token'), tests.var('finn')) #>> '{plan,can_join}', 'false', 'abgesagt: kein Beitritt');
select throws_ok($$ select public.guest_join_shared_plan(tests.var('token'), tests.var('finn')) $$, 'P0001', 'plan_guest_join_off', 'abgesagt: kein Link');

-- Fremder Plan-Link einer anderen Crew: kein Zugriff über fremde Geheimnisse.
select tests.logout();
insert into public.plans (crew_id, created_by, title, starts_at, status, guests_allowed, guest_join_by) values
  (tests.var('mallory_crew')::uuid, tests.uid('mallory'), 'Fremd', now() + interval '3 days', 'confirmed', true, tests.uid('mallory'));
insert into public.plan_share_links (plan_id, token) values ((select id from public.plans where title = 'Fremd'), repeat('fe', 16));
select tests.login_anon();
select throws_ok($$ select public.guest_join_shared_plan(repeat('fe', 16), tests.var('finn')) $$, 'P0001', 'plan_guest_not_found',
  'Geheimnis eines Gasts von einem anderen Plan gilt hier nicht');

-- ---- Löschen des Plans mit Gästen und Gast-Links klappt ohne Konflikt -------------------------------
select tests.logout();
select lives_ok($$ delete from public.plans where id = tests.var('bowling')::uuid $$, 'Plan mit Gast-Links lässt sich löschen');
select is((select count(*)::int from public.crew_invitations where via_plan_id is not null or via_plan_guest_id is not null), 0, 'Gast-Links verschwinden mit');

select * from finish();
rollback;
