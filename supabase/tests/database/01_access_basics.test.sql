-- Grundschutz: RLS überall aktiv, anon ohne Rechte, Profile und Einstellungen nur für Berechtigte.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Mallory');

-- ---- Struktur ---------------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0, 'jede Tabelle in public hat Row Level Security aktiviert');

select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'PUBLIC')),
  0, 'anon/PUBLIC besitzen keinerlei Tabellenrechte');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app_private') and has_function_privilege('anon', p.oid, 'execute')
     and p.oid not in ('public.preview_public_invitation(text)'::regprocedure, 'public.preview_shared_plan(text)'::regprocedure,
                       'public.preview_shared_poll(text)'::regprocedure, 'public.shared_poll_ballot(text, text)'::regprocedure,
                       'public.guest_vote_shared_poll(text, text, text, jsonb)'::regprocedure,
                       'public.guest_join_shared_poll(text, text)'::regprocedure)),
  0, 'anon darf keine Funktion ausführen – Ausnahmen: Einladungsvorschau (W1), Plan- und Abstimmungs-Vorschau (W2), Stimmzettel, Abstimmen und Beitrittslink als Gast (W3)');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app_private' and has_function_privilege('authenticated', p.oid, 'execute')
     and p.proname not in ('is_crew_member', 'has_crew_role', 'shares_crew_with', 'can_access_poll',
                           'can_access_plan', 'can_access_ride_offer', 'is_admin')),
  0, 'interne Funktionen sind für angemeldete Nutzer nicht ausführbar');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app_private') and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')),
  0, 'jede SECURITY-DEFINER-Funktion hat einen festen search_path');

-- Trigger laufen bei direkten Schreibzugriffen in der Rolle des Nutzers. Ruft ein Trigger interne
-- (für API-Rollen gesperrte) Funktionen auf, muss er SECURITY DEFINER sein – sonst scheitert das Update
-- zur Laufzeit. (Innerhalb einer Testtransaktion fiele das wegen zwischengespeicherter Pläne nicht auf.)
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app_private') and p.prorettype = 'trigger'::regtype
     and not p.prosecdef and p.prosrc ~ 'app_private\.'),
  0, 'Trigger, die interne Funktionen aufrufen, sind SECURITY DEFINER');

-- ---- Konto-Trigger ----------------------------------------------------------------------------
select is((select display_name from public.profiles where id = tests.uid('alice')), 'Alice', 'Profil entsteht automatisch mit bereinigtem Namen');
select is((select location_sharing_mode::text from public.user_settings where user_id = tests.uid('alice')), 'off', 'Standortfreigabe ist standardmäßig aus');

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
values ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'x@example.test', jsonb_build_object('display_name', E'  \n A  '));
select is((select display_name from public.profiles where id = '00000000-0000-0000-0000-00000000aaaa'), 'Neues Mitglied', 'unbrauchbarer Anzeigename wird ersetzt');

-- ---- anon -------------------------------------------------------------------------------------
select tests.login_anon();
select throws_ok('select * from public.profiles', '42501', null, 'anon kann keine Profile lesen');
select throws_ok('select * from public.activities', '42501', null, 'anon kann keine Aktivitäten lesen');
select throws_ok($$ select public.create_crew('X Crew') $$, '42501', null, 'anon kann keine RPC aufrufen');

-- ---- Profile ----------------------------------------------------------------------------------
select tests.login('alice');
select is((select count(*)::int from public.profiles), 1, 'ohne gemeinsame Crew sieht man nur das eigene Profil');
select is((select count(*)::int from public.user_settings), 1, 'Einstellungen: nur die eigenen');

select lives_ok($$ update public.profiles set display_name = '  Alice   A. ', city = 'Berlin', interests = array['food','music'] where id = tests.uid('alice') $$, 'eigenes Profil ist änderbar');
select is((select display_name from public.profiles where id = tests.uid('alice')), 'Alice A.', 'Anzeigename wird normalisiert');
select throws_ok($$ update public.profiles set display_name = 'A' where id = tests.uid('alice') $$, '23514', null, 'zu kurzer Name wird abgelehnt');
select throws_ok($$ update public.profiles set interests = array['hacking'] where id = tests.uid('alice') $$, '23514', null, 'unbekannte Interessen werden abgelehnt');
select throws_ok($$ update public.profiles set avatar_url = 'javascript:alert(1)' where id = tests.uid('alice') $$, '23514', null, 'Avatar akzeptiert nur Bild-Data-URLs oder https');
select throws_ok($$ update public.profiles set id = gen_random_uuid() where id = tests.uid('alice') $$, '42501', null, 'die Profil-ID ist nicht änderbar');
select throws_ok($$ update public.profiles set created_at = now() where id = tests.uid('alice') $$, '42501', null, 'created_at ist nicht änderbar');
select throws_ok($$ insert into public.profiles (id, display_name) values (gen_random_uuid(), 'Fake') $$, '42501', null, 'Profile lassen sich nicht direkt anlegen');
select throws_ok($$ delete from public.profiles where id = tests.uid('alice') $$, '42501', null, 'Profile lassen sich nicht direkt löschen');

update public.profiles set display_name = 'Gehackt' where id = tests.uid('bob');
select tests.logout();
select is((select display_name from public.profiles where id = tests.uid('bob')), 'Bob', 'fremde Profile sind nicht änderbar');

-- ---- Einstellungen ----------------------------------------------------------------------------
select tests.login('alice');
select lives_ok($$ update public.user_settings set typical_budget_cents = 2500, notification_preferences = '{"poll_created": false}' where user_id = tests.uid('alice') $$, 'eigene Einstellungen sind änderbar');
update public.user_settings set typical_budget_cents = 1 where user_id = tests.uid('bob');
select tests.logout();
select is((select typical_budget_cents from public.user_settings where user_id = tests.uid('bob')), null, 'fremde Einstellungen sind nicht änderbar');

-- Standortfreigabe an eine fremde Crew ist nicht möglich.
select tests.login('mallory');
select tests.set_var('mallory_crew', public.create_crew('Fremde Crew')::text);
select tests.login('alice');
select throws_ok(
  $$ update public.user_settings set location_sharing_mode = 'crew', location_sharing_crew_id = tests.var('mallory_crew')::uuid where user_id = tests.uid('alice') $$,
  '42501', null, 'Standort kann nicht mit einer fremden Crew geteilt werden');

-- ---- Gemeinsame Crew macht Profile sichtbar ------------------------------------------------------
select tests.set_var('crew', public.create_crew('Weekend Crew', '🎳')::text);
select tests.set_var('token', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob');
select is(public.accept_crew_invitation(tests.var('token')) ->> 'status', 'joined', 'Bob tritt per Einladung bei');
select is((select count(*)::int from public.profiles), 2, 'Crew-Mitglieder sehen sich gegenseitig');
select is((select count(*)::int from public.profiles where id = tests.uid('mallory')), 0, 'Außenstehende bleiben unsichtbar');
select is((select count(*)::int from public.user_settings), 1, 'private Einstellungen bleiben auch innerhalb der Crew privat');

-- ---- Administratorrolle ---------------------------------------------------------------------------
select is(public.is_admin(), false, 'normale Nutzer sind keine Administratoren');
select throws_ok('select public.admin_overview()', '42501', 'forbidden', 'Admin-Übersicht ist gesperrt');
select throws_ok('select * from public.app_admins', '42501', null, 'app_admins ist über die API nicht lesbar');
select throws_ok($$ insert into public.app_admins (user_id) values (tests.uid('bob')) $$, '42501', null, 'niemand kann sich selbst zum Admin machen');
select is((select count(*)::int from public.audit_log), 0, 'Audit-Log ist für normale Nutzer leer');
select throws_ok(
  $$ insert into public.activities (name, category, data_source) values ('Fake Ort', 'bar', 'manual') $$,
  '42501', null, 'normale Nutzer können keine Aktivitäten anlegen');
update public.activities set name = 'Manipuliert';
select tests.logout();
select is((select count(*)::int from public.activities where name = 'Manipuliert'), 0, 'normale Nutzer können keine Aktivitäten ändern');

insert into public.app_admins (user_id) values (tests.uid('alice'));
select tests.login('alice');
select is(public.is_admin(), true, 'eingetragene Administratoren werden erkannt');
select lives_ok($$ insert into public.activities (name, category, data_source, provider_id, external_id) values ('Echter Ort', 'bar', 'manual', 'manual', 't-1') $$, 'Administratoren können Aktivitäten pflegen');
select ok((public.admin_overview() ->> 'users')::int >= 3, 'Admin-Übersicht liefert Kennzahlen');
select ok((select count(*) from public.audit_log) > 0, 'Administratoren können das Audit-Log lesen');

select tests.logout();
select * from finish();
rollback;
