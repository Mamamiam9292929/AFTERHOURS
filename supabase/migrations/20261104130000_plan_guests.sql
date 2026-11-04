-- W10 Etappe 1 · Zusagen ohne Konto beim geteilten Plan
-- Wer einen Plan organisiert (oder Owner/Admin der Crew ist), kann „Freunde ohne Konto dürfen zusagen“
-- einschalten. Dann zeigt der Teilen-Link /s/<token> (W2) unter der Karte „Bin dabei / Vielleicht /
-- Kann nicht“ mit einem Namen – ohne App, ohne Konto. Die Crew sieht „Dana (Gast)“ bei „Wer“.
--
-- Bewusst so gebaut (wie die Gast-Stimmen bei Abstimmungen, W3 Etappe 1):
--   * Standard ist aus. Erst mit dem Schalter zeigt der Link, wohin es geht (Ort, Adresse, Treffpunkt) –
--     wer zusagt, muss das wissen. Wer einschaltet, liest das im Hinweistext. Keine Namen der Crew, keine
--     Notizen, keine Kosten, kein Crew-Name, keine IDs.
--   * Ein Gast ist ein Geheimnis (64 Hex-Zeichen), das nur auf seinem Gerät liegt; gespeichert wird nur
--     der SHA-256-Hash. Mit demselben Geheimnis ändert der Gast seine Antwort oder zieht sie zurück.
--   * Zusagen nur vor Beginn und nur bei Plänen, die weder abgeschlossen noch abgesagt sind.
--   * Missbrauchsschutz: höchstens 30 Gäste je Plan, 30 neue Gäste je Link und Stunde, 300 Antworten je
--     Link in 10 Minuten. Organisator:in und Owner/Admin können Gäste entfernen.
--   * Gäste haben kein Konto: Name und Antwort verschwinden mit dem Plan.

alter table public.plans add column guests_allowed boolean not null default false;

create table public.plan_guests (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  display_name text not null check (char_length(display_name) between 2 and 40),
  attendance_status public.attendance_status not null check (attendance_status <> 'invited'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, secret_hash)
);
create index plan_guests_plan_idx on public.plan_guests (plan_id);

alter table public.plan_guests enable row level security;
revoke all on table public.plan_guests from public, anon, authenticated;

-- Die Crew sieht Namen und Antworten der Gäste ihrer Pläne – nie den Hash des Geheimnisses.
create policy plan_guests_select_member on public.plan_guests for select to authenticated
  using (app_private.can_access_plan(plan_id));
grant select (id, plan_id, display_name, attendance_status, created_at, updated_at) on public.plan_guests to authenticated;
grant all on public.plan_guests to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.plan_guests;
  end if;
end $$;

-- Plan zu einem Teilen-Link (oder NULL). Nur gültige Tokens werden gesucht.
create function app_private.plan_by_share_token(p_token text) returns public.plans
language plpgsql stable security definer set search_path = '' as $$
declare
  v_plan public.plans;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then
    return null;
  end if;
  select p.* into v_plan
  from public.plan_share_links l join public.plans p on p.id = l.plan_id
  where l.token = p_token;
  return v_plan;
end $$;

-- Zusagen über den Link sind möglich: Schalter an, Plan weder abgeschlossen noch abgesagt, noch nicht begonnen.
create function app_private.plan_guests_open(p_plan public.plans) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_plan.guests_allowed, false)
     and p_plan.status not in ('completed', 'cancelled')
     and p_plan.starts_at > now();
$$;

revoke all on function app_private.plan_by_share_token(text), app_private.plan_guests_open(public.plans) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Vorschau des Teilen-Links: Gäste zählen bei „x sind dabei“ mit; neu ist nur „guests“
-- (true = Zusagen ohne Konto sind gerade möglich). Ersetzt die Fassung aus 20261014010000.
-- ---------------------------------------------------------------------------------------------
create or replace function public.preview_shared_plan(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.plans;
begin
  v_plan := app_private.plan_by_share_token(p_token);
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
                      where pp.plan_id = v_plan.id and pp.attendance_status = 'going')
                   + (select count(*) from public.plan_guests g
                      where g.plan_id = v_plan.id and g.attendance_status = 'going'),
      'guests', app_private.plan_guests_open(v_plan)),
    'plan_id', case when auth.uid() is not null and app_private.is_crew_member(v_plan.crew_id) then v_plan.id end);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Für die Crew: Schalter und Gäste entfernen
-- ---------------------------------------------------------------------------------------------
create function public.set_plan_guests(p_plan_id uuid, p_allowed boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id for update;
  if not found or not app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.forbid();
  end if;
  if not (v_plan.created_by is not distinct from v_uid
          or app_private.has_crew_role(v_plan.crew_id, array['owner', 'admin']::public.crew_role[])) then
    perform app_private.forbid();
  end if;
  if p_allowed is null then
    perform app_private.fail('invalid_input');
  end if;
  if v_plan.status in ('completed', 'cancelled') then
    perform app_private.fail('plan_locked');
  end if;
  if v_plan.guests_allowed = p_allowed then
    return;
  end if;
  -- Einschalten nur vor Beginn; ausschalten geht immer.
  if p_allowed and v_plan.starts_at <= now() then
    perform app_private.fail('plan_guests_started');
  end if;
  perform app_private.rate_limit('plan_guests_toggle', 30, interval '1 hour');

  update public.plans p set guests_allowed = p_allowed where p.id = p_plan_id;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, crew_id, meta)
  values (v_uid, 'plan_guests', 'plan', p_plan_id, v_plan.crew_id, jsonb_build_object('allowed', p_allowed));
end $$;

create function public.remove_plan_guest(p_guest_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
begin
  select p.* into v_plan
  from public.plan_guests g join public.plans p on p.id = g.plan_id
  where g.id = p_guest_id;
  if not found or not app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.forbid();
  end if;
  if not (v_plan.created_by is not distinct from v_uid
          or app_private.has_crew_role(v_plan.crew_id, array['owner', 'admin']::public.crew_role[])) then
    perform app_private.forbid();
  end if;
  perform app_private.rate_limit('plan_guest_remove', 60, interval '1 hour');

  delete from public.plan_guests g where g.id = p_guest_id;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, crew_id, meta)
  values (v_uid, 'plan_guest_removed', 'plan', v_plan.id, v_plan.crew_id, '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Ohne Konto: Zusagekarte lesen und antworten
-- ---------------------------------------------------------------------------------------------
-- Zusagekarte zum Link. p_secret (optional) erkennt einen Gast wieder, der schon geantwortet hat.
--   not_found / expired  – wie bei der Vorschau
--   guests_off           – Gäste dürfen (nicht mehr) zusagen; sonst nichts
--   valid                – Titel, Zeit, open, wohin (Ort, Adresse, Treffpunkt), Zahl der Zusagen und
--                          „vielleicht“ (Crew und Gäste), me = eigener Name und eigene Antwort oder null
create function public.shared_plan_rsvp(p_token text, p_secret text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.plans;
  v_guest public.plan_guests;
  v_place text;
begin
  v_plan := app_private.plan_by_share_token(p_token);
  if v_plan.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if coalesce(v_plan.ends_at, v_plan.starts_at) < now() - interval '3 days' then
    return jsonb_build_object('status', 'expired');
  end if;

  perform app_private.rate_limit_key(p_token, 'plan_guest_rsvp_read', 240, interval '10 minutes');
  if not v_plan.guests_allowed then
    return jsonb_build_object('status', 'guests_off');
  end if;

  if p_secret ~ '^[0-9a-f]{64}$' then
    select g.* into v_guest from public.plan_guests g
    where g.plan_id = v_plan.id and g.secret_hash = app_private.hash_token(p_secret);
  end if;
  select a.name into v_place from public.activities a where a.id = v_plan.activity_id;

  return jsonb_build_object(
    'status', 'valid',
    'plan', jsonb_build_object(
      'title', v_plan.title,
      'starts_at', v_plan.starts_at,
      'ends_at', v_plan.ends_at,
      'status', v_plan.status,
      'open', app_private.plan_guests_open(v_plan),
      'place', v_place,
      'address', v_plan.address,
      'meeting_point', v_plan.meeting_point),
    'counts', (
      select jsonb_build_object(
               'going', count(*) filter (where x.s = 'going'),
               'maybe', count(*) filter (where x.s = 'maybe'))
      from (select pp.attendance_status as s from public.plan_participants pp where pp.plan_id = v_plan.id
            union all
            select g.attendance_status from public.plan_guests g where g.plan_id = v_plan.id) x),
    'me', case when v_guest.id is null then null else jsonb_build_object(
      'name', v_guest.display_name,
      'status', v_guest.attendance_status) end);
end $$;

-- Antworten als Gast. p_status: 'going' | 'maybe' | 'declined' oder null (Antwort zurückziehen – der Gast
-- verschwindet dann ganz aus dem Plan).
create function public.guest_rsvp_shared_plan(p_token text, p_secret text, p_name text, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.plans;
  v_name text := app_private.clean_line(p_name, 40);
  v_guest public.plan_guests;
  v_status public.attendance_status;
begin
  v_plan := app_private.plan_by_share_token(p_token);
  if v_plan.id is null then
    perform app_private.fail('share_not_found');
  end if;
  if not v_plan.guests_allowed then
    perform app_private.fail('plan_guests_off');
  end if;
  if v_plan.status in ('completed', 'cancelled') then
    perform app_private.fail('plan_locked');
  end if;
  if v_plan.starts_at <= now() then
    perform app_private.fail('plan_guests_started');
  end if;
  -- Mitglieder sagen in der App zu – nicht zusätzlich als Gast.
  if auth.uid() is not null and app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.fail('plan_guest_member');
  end if;
  if p_secret is null or p_secret !~ '^[0-9a-f]{64}$' then
    perform app_private.fail('invalid_input');
  end if;
  if p_status is not null and p_status not in ('going', 'maybe', 'declined') then
    perform app_private.fail('invalid_status');
  end if;

  perform app_private.rate_limit_key(p_token, 'plan_guest_rsvp', 300, interval '10 minutes');

  select g.* into v_guest from public.plan_guests g
  where g.plan_id = v_plan.id and g.secret_hash = app_private.hash_token(p_secret)
  for update;

  if p_status is null then
    if v_guest.id is not null then
      delete from public.plan_guests g where g.id = v_guest.id;
    end if;
    return;
  end if;
  v_status := p_status::public.attendance_status;

  if v_name is null or char_length(v_name) < 2 then
    perform app_private.fail('invalid_name');
  end if;

  if v_guest.id is null then
    perform 1 from public.plans p where p.id = v_plan.id for update;  -- Obergrenze ohne Wettlauf
    if (select count(*) from public.plan_guests g where g.plan_id = v_plan.id) >= 30 then
      perform app_private.fail('plan_guest_limit');
    end if;
    perform app_private.rate_limit_key(p_token, 'plan_guest_join', 30, interval '1 hour');
    insert into public.plan_guests (plan_id, secret_hash, display_name, attendance_status)
    values (v_plan.id, app_private.hash_token(p_secret), v_name, v_status)
    returning * into v_guest;
  elsif v_guest.attendance_status is distinct from v_status or v_guest.display_name is distinct from v_name then
    update public.plan_guests g set attendance_status = v_status, display_name = v_name, updated_at = now()
    where g.id = v_guest.id;
  else
    return;  -- nichts geändert, keine Benachrichtigung
  end if;

  -- Wer organisiert, erfährt es – wie bei Antworten aus der Crew (eine je Gast und Antwort).
  perform app_private.notify(v_plan.created_by, 'plan_attendance', null, v_plan.crew_id, 'plan', v_plan.id,
                             jsonb_build_object('title', v_plan.title, 'status', v_status::text, 'guest', v_name),
                             'plan_attendance:' || v_plan.id::text || ':guest:' || v_guest.id::text || ':' || v_status::text);
end $$;

revoke all on function
  public.set_plan_guests(uuid, boolean), public.remove_plan_guest(uuid),
  public.shared_plan_rsvp(text, text), public.guest_rsvp_shared_plan(text, text, text, text)
from public, anon, authenticated;
grant execute on function public.set_plan_guests(uuid, boolean), public.remove_plan_guest(uuid) to authenticated;
grant execute on function public.shared_plan_rsvp(text, text), public.guest_rsvp_shared_plan(text, text, text, text)
  to anon, authenticated;
