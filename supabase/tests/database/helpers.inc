-- Gemeinsame Test-Hilfen. Wird von jeder Testdatei per \ir eingebunden und läuft in deren
-- Transaktion – am Ende wird alles zurückgerollt.
create extension if not exists pgtap with schema extensions;
-- Wie bei API-Aufrufen über PostgREST: public + extensions im Suchpfad.
set local search_path = public, extensions;

create schema tests;
grant usage on schema tests to anon, authenticated;

create table tests.users (name text primary key, id uuid not null);
grant select on tests.users to anon, authenticated;

-- Legt ein Konto direkt in auth.users an (wie Supabase Auth es tut); der Trigger erzeugt das Profil.
create function tests.make_user(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          lower(p_name) || '@example.test', jsonb_build_object('display_name', p_name), '{}'::jsonb, now(), now());
  insert into tests.users (name, id) values (lower(p_name), v_id);
  return v_id;
end $$;

create function tests.uid(p_name text) returns uuid
language sql stable as $$ select id from tests.users where name = lower(p_name) $$;

-- Ab hier gelten Rolle und JWT des genannten Nutzers – genau wie bei einem API-Aufruf.
create function tests.login(p_name text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', tests.uid(p_name), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create function tests.login_anon() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end $$;

-- Zurück zur privilegierten Testrolle (für Vorbereitung und Kontrolle am RLS vorbei).
create function tests.logout() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Schlüssel-Wert-Ablage für IDs, die über mehrere Statements gebraucht werden.
create table tests.vars (key text primary key, value text);
grant select, insert, update on tests.vars to anon, authenticated;
create function tests.set_var(p_key text, p_value text) returns text
language sql as $$
  insert into tests.vars (key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value returning value
$$;
create function tests.var(p_key text) returns text
language sql stable as $$ select value from tests.vars where key = p_key $$;
