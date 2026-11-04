-- W10 Etappe 1: Zusagen ohne Konto beim geteilten Plan – nur nach ausdrücklicher Freigabe, nur vor Beginn,
-- nur das Nötige, die Crew sieht die Gäste, Missbrauch ist begrenzt.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Carol');
select tests.make_user('Mallory');

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew', '🎳')::text);
select tests.set_var('invite', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Bob tritt bei');
select tests.login('carol');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Carol tritt bei');
select tests.login('mallory');
select tests.set_var('mallory_crew', public.create_crew('Fremde Crew')::text);

-- Pläne direkt angelegt (Zeiten und Status frei wählbar). Carol organisiert „Bowling“.
select tests.logout();
insert into public.plans (crew_id, created_by, title, starts_at, address, meeting_point, notes, estimated_cost_per_person_cents, status) values
  (tests.var('crew')::uuid, tests.uid('carol'), 'Bowling', now() + interval '3 days', 'Bahnhofstraße 1, Berlin', 'Vor dem Eingang', 'Schlüssel bei Bob', 1500, 'confirmed'),
  (tests.var('crew')::uuid, tests.uid('carol'), 'Gestartet', now() - interval '10 minutes', null, null, null, null, 'confirmed'),
  (tests.var('crew')::uuid, tests.uid('carol'), 'Abgesagt', now() + interval '3 days', null, null, null, null, 'cancelled'),
  (tests.var('mallory_crew')::uuid, tests.uid('mallory'), 'Fremder Plan', now() + interval '3 days', null, null, null, null, 'confirmed');
select tests.set_var(lower(replace(title, ' ', '_')), id::text) from public.plans
  where title in ('Bowling', 'Gestartet', 'Abgesagt', 'Fremder Plan');
insert into public.plan_participants (plan_id, user_id, attendance_status) values
  (tests.var('bowling')::uuid, tests.uid('carol'), 'going'),
  (tests.var('bowling')::uuid, tests.uid('alice'), 'maybe'),
  (tests.var('bowling')::uuid, tests.uid('bob'), 'invited');
delete from public.notifications;

select tests.login('carol');
select tests.set_var('token', public.plan_share_token(tests.var('bowling')::uuid));
select tests.set_var('token_started', public.plan_share_token(tests.var('gestartet')::uuid));
select tests.logout();
-- Abgesagte Pläne bekommen in der App keinen Link mehr – hier direkt, um den Server zu prüfen.
insert into public.plan_share_links (plan_id, token) values (tests.var('abgesagt')::uuid, repeat('ab', 16));

-- Geheimnisse zweier Gäste (64 Hex-Zeichen, wie die App sie erzeugt).
select tests.set_var('dana', repeat('d', 64));
select tests.set_var('emil', repeat('e', 64));

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(has_function_privilege('anon', 'public.shared_plan_rsvp(text, text)', 'execute'), 'anon darf die Zusagekarte abrufen');
select ok(has_function_privilege('anon', 'public.guest_rsvp_shared_plan(text, text, text, text)', 'execute'), 'anon darf als Gast zusagen');
select ok(not has_function_privilege('anon', 'public.set_plan_guests(uuid, boolean)', 'execute'), 'anon kann Gäste nicht freischalten');
select ok(not has_function_privilege('anon', 'public.remove_plan_guest(uuid)', 'execute'), 'anon kann keine Gäste entfernen');
select ok(not has_function_privilege('authenticated', 'app_private.plan_by_share_token(text)', 'execute'), 'interne Suche nicht aufrufbar');
select ok(not has_function_privilege('authenticated', 'app_private.plan_guests_open(public.plans)', 'execute'), 'interne Prüfung nicht aufrufbar');
select ok(not has_column_privilege('authenticated', 'public.plan_guests', 'secret_hash', 'select'), 'den Hash des Gast-Geheimnisses liest niemand über die API');
select ok(not has_table_privilege('authenticated', 'public.plan_guests', 'insert'), 'Gäste lassen sich nicht direkt eintragen');
select ok(not has_table_privilege('authenticated', 'public.plan_guests', 'update'), 'Gäste lassen sich nicht direkt ändern');
select ok(not has_table_privilege('authenticated', 'public.plan_guests', 'delete'), 'Gäste lassen sich nicht direkt löschen');

select tests.login_anon();
select throws_ok('select * from public.plan_guests', '42501', null, 'anon liest keine Gäste');

-- ---- Standard: aus ------------------------------------------------------------------------------
select is(public.shared_plan_rsvp(tests.var('token')), '{"status": "guests_off"}'::jsonb, 'ohne Freigabe: keine Zusagekarte, kein Ort');
select is(public.preview_shared_plan(tests.var('token')) #>> '{plan,guests}', 'false', 'Vorschau: Gäste aus');
select throws_ok($$ select public.guest_rsvp_shared_plan(tests.var('token'), tests.var('dana'), 'Dana', 'going') $$,
  'P0001', 'plan_guests_off', 'ohne Freigabe: keine Gast-Zusage');

-- ---- Freigabe: nur Organisator:in oder Owner/Admin ------------------------------------------------
select tests.login('mallory');
select throws_ok($$ select public.set_plan_guests(tests.var('bowling')::uuid, true) $$, '42501', null, 'Außenstehende schalten nichts frei');
select tests.login('bob');
select throws_ok($$ select public.set_plan_guests(tests.var('bowling')::uuid, true) $$, '42501', null, 'einfache Mitglieder schalten nichts frei');
select tests.login('carol');
select throws_ok($$ select public.set_plan_guests(tests.var('bowling')::uuid, null) $$, 'P0001', 'invalid_input', 'ohne Wert keine Änderung');
select throws_ok($$ select public.set_plan_guests(tests.var('abgesagt')::uuid, true) $$, 'P0001', 'plan_locked', 'abgesagter Plan: kein Einschalten');
select throws_ok($$ select public.set_plan_guests(tests.var('gestartet')::uuid, true) $$, 'P0001', 'plan_guests_started', 'nach Beginn: kein Einschalten');
select lives_ok($$ select public.set_plan_guests(tests.var('bowling')::uuid, true) $$, 'Organisatorin schaltet Gäste frei');
select is((select guests_allowed from public.plans where id = tests.var('bowling')::uuid), true, 'die Crew sieht den Schalter am Plan');
select lives_ok($$ select public.set_plan_guests(tests.var('bowling')::uuid, true) $$, 'erneutes Einschalten ändert nichts');
select tests.login('alice');
select lives_ok($$ select public.set_plan_guests(tests.var('bowling')::uuid, true) $$, 'Owner darf auch');
select tests.logout();
select is((select count(*)::int from public.audit_log where action = 'plan_guests'), 1, 'Freigabe steht einmal im Audit-Log');
-- Für die Prüfungen nach Beginn und bei Absage: Schalter dort direkt an.
update public.plans set guests_allowed = true where id in (tests.var('gestartet')::uuid, tests.var('abgesagt')::uuid);

-- ---- Zusagekarte ohne Konto ----------------------------------------------------------------------
select tests.login_anon();
select is(public.preview_shared_plan(tests.var('token')) #>> '{plan,guests}', 'true', 'Vorschau: Gäste können zusagen');
select tests.set_var('card', public.shared_plan_rsvp(tests.var('token'))::text);
select is(tests.var('card')::jsonb ->> 'status', 'valid', 'mit Freigabe: Zusagekarte');
select is(tests.var('card')::jsonb #>> '{plan,title}', 'Bowling', 'Titel');
select is(tests.var('card')::jsonb #>> '{plan,open}', 'true', 'Zusagen möglich');
select is(tests.var('card')::jsonb #>> '{plan,address}', 'Bahnhofstraße 1, Berlin', 'Adresse – wer zusagt, muss wissen, wohin');
select is(tests.var('card')::jsonb #>> '{plan,meeting_point}', 'Vor dem Eingang', 'Treffpunkt');
select is(tests.var('card')::jsonb #>> '{counts,going}', '1', 'eine Zusage aus der Crew');
select is(tests.var('card')::jsonb #>> '{counts,maybe}', '1', 'ein „vielleicht“ aus der Crew');
select ok(tests.var('card')::jsonb -> 'me' = 'null'::jsonb, 'ohne Geheimnis kein eigener Stand');
select ok(tests.var('card') !~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'die Karte enthält keine einzige ID');
select ok(tests.var('card') !~* '(Schlüssel|1500|Weekend|Alice|Carol|example\.test)', 'keine Notizen, keine Kosten, kein Crew-Name, keine Namen');
select is(public.shared_plan_rsvp(repeat('0', 32)), '{"status": "not_found"}'::jsonb, 'unbekannter Token: not_found');
select is(public.shared_plan_rsvp('x'' or 1=1 --'), '{"status": "not_found"}'::jsonb, 'Unsinn wird gar nicht gesucht');
select is(public.shared_plan_rsvp(tests.var('token_started')) #>> '{plan,open}', 'false', 'nach Beginn: Karte ohne Zusagen');
select is(public.preview_shared_plan(tests.var('token_started')) #>> '{plan,guests}', 'false', 'Vorschau nach Beginn: Gäste aus');

-- ---- Zusagen als Gast -----------------------------------------------------------------------------
select throws_ok($$ select public.guest_rsvp_shared_plan(tests.var('token'), 'kurz', 'Dana', 'going') $$, 'P0001', 'invalid_input', 'Geheimnis muss 64 Hex-Zeichen haben');
select throws_ok($$ select public.guest_rsvp_shared_plan(tests.var('token'), tests.var('dana'), ' D ', 'going') $$, 'P0001', 'invalid_name', 'Name braucht 2 Zeichen');
select throws_ok($$ select public.guest_rsvp_shared_plan(tests.var('token'), tests.var('dana'), 'Dana', 'invited') $$, 'P0001', 'invalid_status', '„eingeladen“ ist keine Antwort');
select throws_ok($$ select public.guest_rsvp_shared_plan(tests.var('token'), tests.var('dana'), 'Dana', 'yes') $$, 'P0001', 'invalid_status', 'nur going, maybe, declined');
select throws_ok($$ select public.guest_rsvp_shared_plan(repeat('0', 32), tests.var('dana'), 'Dana', 'going') $$, 'P0001', 'share_not_found', 'unbekannter Link');
select throws_ok($$ select public.guest_rsvp_shared_plan(tests.var('token_started'), tests.var('dana'), 'Dana', 'going') $$, 'P0001', 'plan_guests_started', 'nach Beginn keine Zusage');
select throws_ok($$ select public.guest_rsvp_shared_plan(repeat('ab', 16), tests.var('dana'), 'Dana', 'going') $$, 'P0001', 'plan_locked', 'abgesagter Plan: keine Zusage');
select lives_ok($$ select public.guest_rsvp_shared_plan(tests.var('token'), tests.var('dana'), '  Dana   Gast ', 'going') $$, 'Dana sagt ohne Konto zu');
select is(public.shared_plan_rsvp(tests.var('token'), tests.var('dana')) -> 'me', '{"name": "Dana Gast", "status": "going"}'::jsonb, 'Dana sieht ihren Stand (Name bereinigt)');
select is(public.shared_plan_rsvp(tests.var('token'), tests.var('dana')) #>> '{counts,going}', '2', 'Gäste zählen bei den Zusagen mit');
select is(public.preview_shared_plan(tests.var('token')) #>> '{plan,going_count}', '2', 'auch in der Messenger-Vorschau');
select ok(public.shared_plan_rsvp(tests.var('token'), tests.var('emil')) -> 'me' = 'null'::jsonb, 'fremdes Geheimnis: kein fremder Stand');

select tests.logout();
select is((select count(*)::int from public.notifications where user_id = tests.uid('carol') and type = 'plan_attendance'), 1, 'Organisatorin bekommt Bescheid');
select is((select payload ->> 'guest' from public.notifications where user_id = tests.uid('carol') and type = 'plan_attendance'), 'Dana Gast', '… mit dem Namen des Gastes');
select ok((select actor_id is null from public.notifications where user_id = tests.uid('carol') and type = 'plan_attendance'), '… ohne auslösendes Konto');
select is((select secret_hash from public.plan_guests where display_name = 'Dana Gast'), encode(sha256(convert_to(repeat('d', 64), 'UTF8')), 'hex'), 'gespeichert wird nur der Hash');

select tests.login_anon();
select lives_ok($$ select public.guest_rsvp_shared_plan(tests.var('token'), tests.var('dana'), 'Dana Gast', 'going') $$, 'gleiche Antwort noch einmal');
select lives_ok($$ select public.guest_rsvp_shared_plan(tests.var('token'), tests.var('dana'), 'Dana Gast', 'maybe') $$, 'Dana ändert auf „vielleicht“');
select is(public.shared_plan_rsvp(tests.var('token'), tests.var('dana')) #>> '{me,status}', 'maybe', 'neue Antwort gilt');
select tests.logout();
select is((select count(*)::int from public.plan_guests where plan_id = tests.var('bowling')::uuid), 1, 'kein zweiter Gast durch erneute Antwort');
select is((select count(*)::int from public.notifications where user_id = tests.uid('carol') and type = 'plan_attendance'), 2, 'unveränderte Antwort benachrichtigt nicht, geänderte schon');

-- Mitglieder sagen in der App zu, nicht als Gast.
select tests.login('bob');
select throws_ok($$ select public.guest_rsvp_shared_plan(tests.var('token'), tests.var('emil'), 'Bob', 'going') $$, 'P0001', 'plan_guest_member', 'Mitglieder nicht als Gast');
-- Angemeldete Außenstehende dürfen wie Gäste zusagen.
select tests.login('mallory');
select lives_ok($$ select public.guest_rsvp_shared_plan(tests.var('token'), tests.var('emil'), 'Emil', 'declined') $$, 'angemeldete Außenstehende sagen als Gast ab');

-- ---- Die Crew sieht die Gäste, Außenstehende nicht ---------------------------------------------------
select tests.login('bob');
select is((select count(*)::int from public.plan_guests where plan_id = tests.var('bowling')::uuid), 2, 'Mitglieder sehen beide Gäste');
select is((select attendance_status::text from public.plan_guests where display_name = 'Emil'), 'declined', '… mit Antwort');
select throws_ok('select secret_hash from public.plan_guests', '42501', null, 'Mitglieder lesen den Hash nicht');
select tests.login('mallory');
select is((select count(*)::int from public.plan_guests), 0, 'Außenstehende sehen keine Gäste');

-- ---- Gäste entfernen ----------------------------------------------------------------------------------
select tests.logout();
select tests.set_var('emil_id', (select id::text from public.plan_guests where display_name = 'Emil'));
select tests.login('mallory');
select throws_ok($$ select public.remove_plan_guest(tests.var('emil_id')::uuid) $$, '42501', null, 'Außenstehende entfernen keine Gäste');
select tests.login('bob');
select throws_ok($$ select public.remove_plan_guest(tests.var('emil_id')::uuid) $$, '42501', null, 'einfache Mitglieder entfernen keine Gäste');
select tests.login('carol');
select lives_ok($$ select public.remove_plan_guest(tests.var('emil_id')::uuid) $$, 'Organisatorin entfernt Emil');
select is((select count(*)::int from public.plan_guests where plan_id = tests.var('bowling')::uuid), 1, 'Emil ist weg');

-- ---- Antwort zurückziehen ------------------------------------------------------------------------------
select tests.login_anon();
select lives_ok($$ select public.guest_rsvp_shared_plan(tests.var('token'), tests.var('emil'), null, null) $$, 'Zurückziehen ohne Eintrag ist ruhig');
select lives_ok($$ select public.guest_rsvp_shared_plan(tests.var('token'), tests.var('dana'), null, null) $$, 'Dana zieht ihre Antwort zurück');
select ok(public.shared_plan_rsvp(tests.var('token'), tests.var('dana')) -> 'me' = 'null'::jsonb, 'Dana ist nicht mehr eingetragen');

-- ---- Ausschalten: nichts Neues mehr, die Crew sieht weiter, wer schon geantwortet hat -------------------
select lives_ok($$ select public.guest_rsvp_shared_plan(tests.var('token'), tests.var('dana'), 'Dana', 'going') $$, 'Dana sagt wieder zu');
select tests.login('carol');
select lives_ok($$ select public.set_plan_guests(tests.var('bowling')::uuid, false) $$, 'Organisatorin schaltet aus');
select tests.login_anon();
select is(public.shared_plan_rsvp(tests.var('token'), tests.var('dana')), '{"status": "guests_off"}'::jsonb, 'ausgeschaltet: keine Karte mehr');
select throws_ok($$ select public.guest_rsvp_shared_plan(tests.var('token'), tests.var('dana'), 'Dana', 'declined') $$, 'P0001', 'plan_guests_off', 'ausgeschaltet: keine Änderung');
select tests.login('bob');
select is((select count(*)::int from public.plan_guests where plan_id = tests.var('bowling')::uuid), 1, 'die Crew sieht Dana weiter');

-- ---- Obergrenze 30 Gäste ---------------------------------------------------------------------------------
select tests.logout();
update public.plans set guests_allowed = true where id = tests.var('bowling')::uuid;
insert into public.plan_guests (plan_id, secret_hash, display_name, attendance_status)
select tests.var('bowling')::uuid, encode(sha256(convert_to('g' || i, 'UTF8')), 'hex'), 'Gast ' || i, 'going'
from generate_series(1, 29) i;
select tests.login_anon();
select throws_ok($$ select public.guest_rsvp_shared_plan(tests.var('token'), tests.var('emil'), 'Emil', 'going') $$, 'P0001', 'plan_guest_limit', 'mehr als 30 Gäste gehen nicht');
select lives_ok($$ select public.guest_rsvp_shared_plan(tests.var('token'), tests.var('dana'), 'Dana', 'maybe') $$, 'wer schon dabei ist, ändert weiter');

-- ---- Aufräumen: Gäste verschwinden mit dem Plan --------------------------------------------------------------
select tests.logout();
delete from public.plans where id = tests.var('bowling')::uuid;
select is((select count(*)::int from public.plan_guests where plan_id = tests.var('bowling')::uuid), 0, 'Gäste verschwinden mit dem Plan');

select * from finish();
rollback;
