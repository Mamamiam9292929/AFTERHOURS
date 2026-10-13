-- W1 · Einladungs-Landingpage
-- Wer einen Crew-Link ohne Konto öffnet, soll sehen, wohin die Einladung führt: Crew, wer schon
-- dabei ist, und den nächsten geplanten Abend. Das ist die einzige Funktion, die `anon` ausführen
-- darf. Sie verrät nur etwas, wenn der Token gültig ist (64 Hex-Zeichen, 244 Bit Zufall – nicht zu
-- erraten), und auch dann nur das Nötigste:
--   - Crew: Name, Emoji, Zahl der Mitglieder (keine IDs)
--   - Mitglieder: nur Vornamen (erstes Wort des Anzeigenamens), höchstens sechs, keine Bilder
--   - nächster Plan: nur Titel und Beginn – keine Adresse, kein Treffpunkt, keine Notizen, keine Kosten
-- Rate Limit pro Einladung (ohne Konto gibt es keine Nutzer-ID). Ungültige Tokens schreiben nichts.

-- Rate Limit für Aufrufe ohne Konto: gezählt wird pro Schlüssel (hier: Hash der Einladung) statt pro
-- Nutzer. Die Treffer liegen in derselben Tabelle; die Kennung ist ein aus Aktion und Schlüssel
-- abgeleiteter UUID-Wert.
create function app_private.rate_limit_key(p_key text, p_action text, p_max integer, p_window interval) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_key uuid := md5('rate:' || p_action || ':' || coalesce(p_key, ''))::uuid;
  v_count integer;
begin
  delete from public.rate_limit_hits h
  where h.user_id = v_key and h.created_at < now() - interval '1 day';

  select count(*) into v_count
  from public.rate_limit_hits h
  where h.user_id = v_key and h.action = p_action and h.created_at > now() - p_window;

  if v_count >= p_max then
    raise exception 'rate_limited' using errcode = 'P0001', detail = p_action;
  end if;

  insert into public.rate_limit_hits (user_id, action) values (v_key, p_action);
end $$;

create function public.preview_public_invitation(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_inv public.crew_invitations;
  v_state text;
begin
  -- Alles, was kein Token sein kann, wird gar nicht erst gesucht.
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'not_found');
  end if;

  select * into v_inv from public.crew_invitations i where i.token_hash = app_private.hash_token(p_token);
  v_state := app_private.invitation_state(v_inv);
  if v_state <> 'valid' then
    return jsonb_build_object('status', v_state);
  end if;

  perform app_private.rate_limit_key(v_inv.token_hash, 'invitation_public', 60, interval '10 minutes');

  return (
    select jsonb_build_object(
      'status', 'valid',
      'crew', jsonb_build_object(
        'name', c.name,
        'emoji', c.emoji,
        'member_count', (select count(*) from public.crew_members m where m.crew_id = c.id)),
      'invited_by', (select split_part(p.display_name, ' ', 1) from public.profiles p where p.id = v_inv.invited_by),
      'members', coalesce((
        select jsonb_agg(f.first_name order by f.joined_at, f.first_name)
        from (
          select split_part(p.display_name, ' ', 1) as first_name, m.joined_at
          from public.crew_members m
          join public.profiles p on p.id = m.user_id
          where m.crew_id = c.id
          order by m.joined_at, p.display_name
          limit 6
        ) f), '[]'::jsonb),
      'next_plan', (
        select jsonb_build_object('title', pl.title, 'starts_at', pl.starts_at)
        from public.plans pl
        where pl.crew_id = c.id
          and pl.status in ('proposed', 'confirmed', 'booking_pending', 'booked')
          and pl.starts_at > now()
        order by pl.starts_at
        limit 1),
      'expires_at', v_inv.expires_at)
    from public.crews c
    where c.id = v_inv.crew_id
  );
end $$;

revoke all on function app_private.rate_limit_key(text, text, integer, interval) from public, anon, authenticated;
revoke all on function public.preview_public_invitation(text) from public, anon, authenticated;
grant execute on function public.preview_public_invitation(text) to anon, authenticated, service_role;
