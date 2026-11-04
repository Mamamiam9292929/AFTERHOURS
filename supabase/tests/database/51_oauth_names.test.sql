-- P12: Anmeldung mit Google und Apple – Name neuer Konten aus den Angaben des Anbieters
-- (nur Vorname, nie E-Mail-Adresse, kein Profilbild), E-Mail-Registrierung unverändert,
-- Trigger-Funktion nicht von außen aufrufbar.
begin;
\ir helpers.inc
select no_plan();

create function tests.make_oauth_user(p_key text, p_provider text, p_meta jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_key || '@example.test', p_meta,
          jsonb_build_object('provider', p_provider, 'providers', jsonb_build_array(p_provider)), now(), now());
  insert into tests.users (name, id) values (p_key, v_id);
  return v_id;
end $$;

create function tests.name_of(p_key text) returns text
language sql stable security definer set search_path = '' as $$
  select p.display_name from public.profiles p join tests.users u on u.id = p.id where u.name = p_key
$$;

-- ---- E-Mail-Registrierung wie bisher -----------------------------------------------------------
select tests.make_user('Alice');
select is(tests.name_of('alice'), 'Alice', 'E-Mail-Registrierung: Anzeigename aus dem Formular');

-- ---- Google ----------------------------------------------------------------------------------------
select tests.make_oauth_user('g1', 'google', '{"full_name": "Fiona  Fuchs", "name": "Fiona Fuchs", "avatar_url": "https://lh3.example/a.png", "picture": "https://lh3.example/a.png"}');
select is(tests.name_of('g1'), 'Fiona', 'Google: nur der Vorname aus full_name');
select is((select avatar_url from public.profiles where id = tests.uid('g1')), null, 'Google: Profilbild des Anbieters wird nicht übernommen');
select is((select count(*)::int from public.user_settings where user_id = tests.uid('g1')), 1, 'Google: Einstellungen werden angelegt');

select tests.make_oauth_user('g2', 'google', '{"given_name": "Jo", "full_name": "Johanna Berg"}');
select is(tests.name_of('g2'), 'Jo', 'given_name hat Vorrang vor full_name');

select tests.make_oauth_user('g3', 'google', '{"name": "  Max\tMustermann "}');
select is(tests.name_of('g3'), 'Max', 'ohne full_name: Vorname aus name, Leerraum bereinigt');

select tests.make_oauth_user('g4', 'google', '{"name": "max@example.test"}');
select is(tests.name_of('g4'), 'Neues Mitglied', 'E-Mail-Adresse als Name wird nicht übernommen');

select tests.make_oauth_user('g5', 'google', '{"display_name": "Mo", "full_name": "Moritz Klein"}');
select is(tests.name_of('g5'), 'Mo', 'display_name (eigene Angabe) hat Vorrang');

select tests.make_oauth_user('g6', 'google', '{"full_name": "Ü"}');
select is(tests.name_of('g6'), 'Neues Mitglied', 'zu kurzer Name: Platzhalter, Onboarding fragt nach');

select tests.make_oauth_user('g7', 'google', format('{"full_name": "%s Nachname"}', repeat('x', 60))::jsonb);
select is(char_length(tests.name_of('g7')), 40, 'langer Vorname wird auf 40 Zeichen gekürzt');

-- ---- Apple (Name kommt nur bei der ersten Anmeldung, oft gar nicht) ---------------------------------
select tests.make_oauth_user('a1', 'apple', '{}');
select is(tests.name_of('a1'), 'Neues Mitglied', 'Apple ohne Namen: Platzhalter');
select tests.make_oauth_user('a2', 'apple', '{"full_name": "Lena Sommer"}');
select is(tests.name_of('a2'), 'Lena', 'Apple mit Namen: Vorname');

-- ---- Rechte ----------------------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'app_private.handle_new_user()', 'execute'), 'angemeldete Personen rufen den Trigger nicht auf');
select ok(not has_function_privilege('anon', 'app_private.handle_new_user()', 'execute'), 'anon ruft den Trigger nicht auf');
select ok((select 'search_path=""' = any(proconfig) from pg_proc where oid = 'app_private.handle_new_user()'::regprocedure), 'search_path ist leer');

-- Außenstehende sehen fremde Profile nicht über die Anbieterangaben: Mallory kennt die Konten nicht.
select tests.make_user('Mallory');
select tests.login('mallory');
select is((select count(*)::int from public.profiles where id in (tests.uid('g1'), tests.uid('a2'))), 0, 'Außenstehende lesen die neuen Profile nicht');
select tests.logout();

select * from finish();
rollback;
