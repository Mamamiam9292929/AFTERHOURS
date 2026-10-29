-- P11 Etappe 2d · Anmelde-E-Mails auf Englisch.
-- Die Vorlagen der Auth-E-Mails (supabase/templates/*.html, Betreff in config.toml) lesen die Sprache aus den
-- Metadaten des Kontos (auth.users.raw_user_meta_data ->> 'locale'; in den Vorlagen `.Data.locale`).
-- Die App setzt sie bei der Registrierung (signUp, options.data.locale). Damit auch spätere E-Mails
-- (Passwort vergessen, neue Adresse) die gewählte Sprache treffen, schreibt set_my_locale sie ab jetzt
-- zusätzlich dorthin, und bestehende Konten mit gespeicherter Sprache bekommen sie einmalig nachgetragen.
-- Nur der Schlüssel `locale` wird gesetzt; alle anderen Metadaten (z. B. display_name) bleiben unverändert.

create or replace function public.set_my_locale(p_locale text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
begin
  perform app_private.rate_limit('set_locale', 30, interval '10 minutes');
  if p_locale is null or p_locale not in ('de', 'en') then
    perform app_private.fail('invalid_locale');
  end if;
  insert into public.user_settings (user_id, locale) values (v_uid, p_locale)
  on conflict (user_id) do update set locale = excluded.locale
  where public.user_settings.locale is distinct from excluded.locale;
  -- Sprache der Auth-E-Mails (siehe oben).
  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('locale', p_locale)
  where id = v_uid
    and (raw_user_meta_data ->> 'locale') is distinct from p_locale;
  return p_locale;
end $$;

revoke all on function public.set_my_locale(text) from public, anon, authenticated;
grant execute on function public.set_my_locale(text) to authenticated;

-- Einmalig: Konten, die schon eine Sprache gespeichert haben.
update auth.users u
set raw_user_meta_data = coalesce(u.raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('locale', s.locale)
from public.user_settings s
where s.user_id = u.id
  and s.locale is not null
  and (u.raw_user_meta_data ->> 'locale') is distinct from s.locale;
