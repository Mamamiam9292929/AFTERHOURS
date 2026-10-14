-- W3 Etappe 2 · Gast-Stimmen ins eigene Konto übernehmen
-- Wer als Gast über /v/<token> abgestimmt hat und danach der Crew beitritt, findet auf der Abstimmung
-- den Hinweis „Du hast hier als Gast abgestimmt“ und übernimmt seine Antworten mit einem Tipp – oder
-- löscht die Gast-Stimme. Sonst würde dieselbe Person doppelt zählen (als Gast und als Mitglied).
--
-- Bewusst so gebaut:
--   * Nachweis ist das Geheimnis, das nur auf dem Gerät des Gasts liegt (64 Hex-Zeichen, gespeichert
--     ist nur der SHA-256-Hash). Wer ein fremdes Geheimnis nicht kennt, findet keinen Gast.
--   * Nur Mitglieder der Crew, nur solange die Abstimmung läuft (ein festgestelltes Ergebnis bleibt),
--     nur mit ausdrücklichem Tipp – die App übernimmt nie von selbst.
--   * Keine doppelte Stimme: Hat das Mitglied zu einem Vorschlag schon selbst geantwortet, bleibt seine
--     Antwort; die Gast-Antwort dazu verfällt. Der Gast wird in derselben Transaktion gelöscht.
--   * Kein Ergebnis bricht: Übernahme und Löschen ändern nur, wer eine Stimme hält, nicht wie viele.
--     Beim Löschen fallen die Gast-Stimmen weg – das ist die Entscheidung der Person selbst.

-- Gibt es zu diesem Geheimnis einen Gast in dieser Abstimmung?
--   none   – nein (oder Abstimmung vorbei, oder Geheimnis ungültig)
--   found  – name, votes (Zahl der Gast-Antworten), conflicts (davon schon selbst beantwortet)
create function public.poll_guest_claim_preview(p_poll_id uuid, p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_poll public.polls%rowtype;
  v_guest public.poll_guests%rowtype;
begin
  select * into v_poll from public.polls p where p.id = p_poll_id;
  if not found or not app_private.is_crew_member(v_poll.crew_id) then
    perform app_private.forbid();
  end if;
  if p_secret is null or p_secret !~ '^[0-9a-f]{64}$'
     or v_poll.status <> 'open' or v_poll.ends_at <= now() then
    return jsonb_build_object('status', 'none');
  end if;
  perform app_private.rate_limit('poll_guest_lookup', 120, interval '10 minutes');

  select g.* into v_guest from public.poll_guests g
  where g.poll_id = v_poll.id and g.secret_hash = app_private.hash_token(p_secret);
  if v_guest.id is null then
    return jsonb_build_object('status', 'none');
  end if;

  return jsonb_build_object(
    'status', 'found',
    'name', v_guest.display_name,
    'votes', (select count(*) from public.poll_guest_votes g where g.guest_id = v_guest.id),
    'conflicts', (select count(*) from public.poll_guest_votes g
                  join public.poll_votes v on v.poll_option_id = g.poll_option_id and v.user_id = v_uid
                  where g.guest_id = v_guest.id));
end $$;

-- Gast-Stimmen übernehmen (p_keep = true) oder die Gast-Stimme löschen (p_keep = false).
-- Ergebnis: claimed = übernommene Antworten, kept = Vorschläge, bei denen die eigene Antwort blieb.
create function public.claim_poll_guest(p_poll_id uuid, p_secret text, p_keep boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_poll public.polls%rowtype;
  v_guest_id uuid;
  v_total integer := 0;
  v_claimed integer := 0;
begin
  select * into v_poll from public.polls p where p.id = p_poll_id;
  if not found or not app_private.is_crew_member(v_poll.crew_id) then
    perform app_private.forbid();
  end if;
  if v_poll.status <> 'open' or v_poll.ends_at <= now() then
    perform app_private.fail('poll_closed');
  end if;
  if p_secret is null or p_secret !~ '^[0-9a-f]{64}$' or p_keep is null then
    perform app_private.fail('invalid_input');
  end if;
  perform app_private.rate_limit('poll_guest_claim', 20, interval '1 hour');

  select g.id into v_guest_id from public.poll_guests g
  where g.poll_id = v_poll.id and g.secret_hash = app_private.hash_token(p_secret)
  for update;
  if v_guest_id is null then
    perform app_private.fail('guest_not_found');
  end if;

  select count(*) into v_total from public.poll_guest_votes g where g.guest_id = v_guest_id;

  if p_keep then
    insert into public.poll_votes (poll_id, poll_option_id, user_id, response)
    select v_poll.id, g.poll_option_id, v_uid, g.response
    from public.poll_guest_votes g
    where g.guest_id = v_guest_id
    on conflict (poll_option_id, user_id) do nothing;
    get diagnostics v_claimed = row_count;
  end if;

  delete from public.poll_guests g where g.id = v_guest_id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, crew_id, meta)
  values (v_uid, case when p_keep then 'poll_guest_claimed' else 'poll_guest_discarded' end, 'poll', v_poll.id, v_poll.crew_id,
          jsonb_build_object('claimed', v_claimed, 'total', v_total));

  return jsonb_build_object('claimed', v_claimed, 'kept', case when p_keep then v_total - v_claimed else 0 end);
end $$;

revoke all on function public.poll_guest_claim_preview(uuid, text), public.claim_poll_guest(uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.poll_guest_claim_preview(uuid, text), public.claim_poll_guest(uuid, text, boolean)
  to authenticated;
