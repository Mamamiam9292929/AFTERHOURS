-- P12 · Anmeldung mit Google und Apple: Name für neue Konten aus den Angaben des Anbieters.
--
-- Bei der Registrierung mit E-Mail schickt die App `display_name` mit. Wer sich mit Google oder Apple
-- anmeldet, bringt stattdessen die Angaben des Anbieters mit (`given_name`, `full_name`, `name`). Davon
-- übernehmen wir nur den Vornamen – in Crews kennt man sich mit Vornamen, und der volle Name des
-- Google- oder Apple-Kontos soll nicht ungefragt für alle Crews sichtbar sein. Im Onboarding ist der
-- Name vorausgefüllt und frei änderbar. Ein Profilbild des Anbieters (`avatar_url`, `picture`) wird
-- bewusst nicht übernommen: Es läge auf fremden Servern, und das Laden verriete den Anbieter.
--
-- Ersetzt die Fassung aus 20261011100200_internals.sql; Rechte und Trigger bleiben bestehen.
create or replace function app_private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_name text := app_private.clean_line(v_meta ->> 'display_name', 40);
begin
  if v_name is null or char_length(v_name) < 2 then
    v_name := app_private.clean_line(v_meta ->> 'given_name', 40);
  end if;
  if v_name is null or char_length(v_name) < 2 then
    v_name := app_private.clean_line(
      split_part(coalesce(app_private.clean_line(v_meta ->> 'full_name', 200), app_private.clean_line(v_meta ->> 'name', 200), ''), ' ', 1),
      40);
  end if;
  -- Manche Anbieter liefern als „Name“ die E-Mail-Adresse – die gehört nicht in den Anzeigenamen.
  if v_name is null or char_length(v_name) < 2 or v_name like '%@%' then
    v_name := 'Neues Mitglied';
  end if;
  insert into public.profiles (id, display_name) values (new.id, v_name) on conflict (id) do nothing;
  insert into public.user_settings (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;

revoke all on function app_private.handle_new_user() from public, anon, authenticated;
