-- W2 Etappe 1 · Teilen-Karten für Pläne
-- Wer einen Plan in den Gruppenchat teilt, teilt einen eigenen Link /s/<token>. Messenger holen sich
-- dafür eine Vorschau (Titel, Zeitpunkt, wie viele dabei sind); Freunde ohne Konto sehen dieselbe
-- Karte in der App. Crew-Mitglieder werden direkt zum Plan weitergeleitet.
--
-- Bewusst nur das Nötigste – dasselbe, was der Teilen-Text (W8) ohnehin enthält, plus eine Zahl:
--   Titel, Beginn, Ende, Status, Zahl der Zusagen. Keine IDs, Namen, Adressen, Treffpunkte,
--   Notizen, Kosten, kein Crew-Name.
-- Den Link gibt es erst, wenn ein Mitglied ihn anfordert (ein Link je Plan, immer derselbe).
-- 3 Tage nach dem Plan verrät er nichts mehr. Die Plan-ID taugt nicht als öffentlicher Schlüssel,
-- weil sie in allen App-Adressen steht – sonst wäre jeder Plan ohne Zutun öffentlich lesbar.
--
-- Der Token liegt im Klartext (wie sonst sollte derselbe Link ein zweites Mal geteilt werden
-- können?), aber in einer Tabelle ohne jede API-Berechtigung. Er öffnet keine Crew und keinen Plan,
-- sondern zeigt nur die Karte.

create table public.plan_share_links (
  plan_id uuid primary key references public.plans (id) on delete cascade,
  token text not null unique check (token ~ '^[0-9a-f]{32}$'),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.plan_share_links enable row level security;
revoke all on table public.plan_share_links from public, anon, authenticated;

-- Liefert den Teilen-Token eines Plans; legt ihn beim ersten Aufruf an. Nur für Crew-Mitglieder.
create function public.plan_share_token(p_plan_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_token text;
begin
  if p_plan_id is null or not app_private.can_access_plan(p_plan_id) then
    perform app_private.forbid();
  end if;

  select l.token into v_token from public.plan_share_links l where l.plan_id = p_plan_id;
  if v_token is not null then
    return v_token;
  end if;

  perform app_private.rate_limit('plan_share_link', 30, interval '1 hour');
  insert into public.plan_share_links (plan_id, token, created_by)
  values (p_plan_id, replace(gen_random_uuid()::text, '-', ''), v_uid)
  on conflict (plan_id) do nothing;

  select l.token into v_token from public.plan_share_links l where l.plan_id = p_plan_id;
  return v_token;
end $$;

-- Die Karte zum Link. Aufrufbar ohne Konto (Messenger-Vorschau, Freunde ohne Konto).
-- Für Crew-Mitglieder zusätzlich die Plan-ID, damit die App direkt zum Plan springt.
create function public.preview_shared_plan(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.plans;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then
    return jsonb_build_object('status', 'not_found');
  end if;

  select p.* into v_plan
  from public.plan_share_links l
  join public.plans p on p.id = l.plan_id
  where l.token = p_token;
  if v_plan.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if coalesce(v_plan.ends_at, v_plan.starts_at) < now() - interval '3 days' then
    return jsonb_build_object('status', 'expired');
  end if;

  perform app_private.rate_limit_key(p_token, 'plan_share_public', 120, interval '10 minutes');

  return jsonb_build_object(
    'status', 'valid',
    'plan', jsonb_build_object(
      'title', v_plan.title,
      'starts_at', v_plan.starts_at,
      'ends_at', v_plan.ends_at,
      'status', v_plan.status,
      'going_count', (select count(*) from public.plan_participants pp
                      where pp.plan_id = v_plan.id and pp.attendance_status = 'going')),
    'plan_id', case when auth.uid() is not null and app_private.is_crew_member(v_plan.crew_id) then v_plan.id end);
end $$;

revoke all on function public.plan_share_token(uuid) from public, anon, authenticated;
revoke all on function public.preview_shared_plan(text) from public, anon, authenticated;
grant execute on function public.plan_share_token(uuid) to authenticated;
grant execute on function public.preview_shared_plan(text) to anon, authenticated, service_role;
