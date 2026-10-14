-- W2 Etappe 2 · Teilen-Karten für Abstimmungen
-- Wie bei Plänen (20261014010000_plan_share_links.sql): Wer eine Abstimmung in den Gruppenchat teilt,
-- teilt einen eigenen Link /v/<token>. Messenger holen sich dafür eine Vorschau, Freunde ohne Konto
-- sehen dieselbe Karte in der App, Crew-Mitglieder landen direkt bei der Abstimmung.
--
-- Bewusst nur das Nötigste – dasselbe, was der Teilen-Text (W8) ohnehin enthält, plus zwei Zahlen:
--   Frage, Frist, offen/entschieden, Zahl der Vorschläge, Zahl der Personen, die abgestimmt haben.
-- Keine Vorschläge im Wortlaut (eigene Vorschläge wie „Grillen bei Bob“ enthalten Namen und Orte),
-- keine IDs, Namen, Treffpunkte, Budgets, Beschreibungen, kein Crew-Name.
-- 3 Tage nach dem Ende verrät der Link nichts mehr.

create table public.poll_share_links (
  poll_id uuid primary key references public.polls (id) on delete cascade,
  token text not null unique check (token ~ '^[0-9a-f]{32}$'),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.poll_share_links enable row level security;
revoke all on table public.poll_share_links from public, anon, authenticated;

-- Liefert den Teilen-Token einer Abstimmung; legt ihn beim ersten Aufruf an. Nur für Crew-Mitglieder.
create function public.poll_share_token(p_poll_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_token text;
begin
  if p_poll_id is null or not app_private.can_access_poll(p_poll_id) then
    perform app_private.forbid();
  end if;

  select l.token into v_token from public.poll_share_links l where l.poll_id = p_poll_id;
  if v_token is not null then
    return v_token;
  end if;

  perform app_private.rate_limit('poll_share_link', 30, interval '1 hour');
  insert into public.poll_share_links (poll_id, token, created_by)
  values (p_poll_id, replace(gen_random_uuid()::text, '-', ''), v_uid)
  on conflict (poll_id) do nothing;

  select l.token into v_token from public.poll_share_links l where l.poll_id = p_poll_id;
  return v_token;
end $$;

-- Die Karte zum Link. Aufrufbar ohne Konto (Messenger-Vorschau, Freunde ohne Konto).
-- Für Crew-Mitglieder zusätzlich die Abstimmungs-ID, damit die App direkt dorthin springt.
-- „open“ heißt: Abstimmen ist noch möglich (Status offen und Frist nicht vorbei) – eine abgelaufene,
-- aber noch nicht ausgezählte Abstimmung gilt nach außen schon als entschieden.
create function public.preview_shared_poll(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_poll public.polls;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then
    return jsonb_build_object('status', 'not_found');
  end if;

  select p.* into v_poll
  from public.poll_share_links l
  join public.polls p on p.id = l.poll_id
  where l.token = p_token;
  if v_poll.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if least(coalesce(v_poll.closed_at, v_poll.ends_at), v_poll.ends_at) < now() - interval '3 days' then
    return jsonb_build_object('status', 'expired');
  end if;

  perform app_private.rate_limit_key(p_token, 'poll_share_public', 120, interval '10 minutes');

  return jsonb_build_object(
    'status', 'valid',
    'poll', jsonb_build_object(
      'title', v_poll.title,
      'ends_at', v_poll.ends_at,
      'status', case when v_poll.status = 'open' and v_poll.ends_at > now() then 'open' else 'closed' end,
      'option_count', (select count(*) from public.poll_options o where o.poll_id = v_poll.id),
      'voter_count', (select count(distinct v.user_id) from public.poll_votes v where v.poll_id = v_poll.id)),
    'poll_id', case when auth.uid() is not null and app_private.is_crew_member(v_poll.crew_id) then v_poll.id end);
end $$;

revoke all on function public.poll_share_token(uuid) from public, anon, authenticated;
revoke all on function public.preview_shared_poll(text) from public, anon, authenticated;
grant execute on function public.poll_share_token(uuid) to authenticated;
grant execute on function public.preview_shared_poll(text) to anon, authenticated, service_role;
