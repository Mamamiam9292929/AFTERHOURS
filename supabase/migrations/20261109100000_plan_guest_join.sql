-- W11 · Vom Plan-Link der Crew beitreten
-- Wer über den Teilen-Link eines Plans ohne Konto zugesagt hat (W10), sah danach nur „Selbst mitplanen?
-- Konto anlegen“ – mit einem Konto allein ist man aber noch nicht in der Crew, dafür musste jemand im
-- Gruppenchat den Einladungslink schicken. Jetzt wie bei Abstimmungen (W3 Etappe 3): Owner oder Admin
-- schalten beim Plan „Gäste dürfen der Crew beitreten“ ein; wer als Gast geantwortet hat, sieht auf der
-- Zusagekarte „Crew beitreten“ und bekommt einen persönlichen Einladungslink. Nach dem Beitritt übernimmt
-- die Planseite die Gast-Antwort mit einem Tipp (W10 Etappe 2).
--
-- Bewusst so gebaut (wie W3 Etappe 3):
--   * Standard ist aus. Einschalten dürfen nur Owner/Admin (wie beim Erstellen von Einladungen), nur wenn
--     Zusagen über den Link erlaubt sind und der Plan weder abgeschlossen noch abgesagt ist. Gespeichert wird,
--     wer eingeschaltet hat (`plans.guest_join_by`) – diese Person steht als „lädt dich ein“ auf der
--     Einladung. Verlässt sie die Crew oder verliert die Rolle, gilt der Schalter nicht mehr.
--   * Den Link holen kann nur, wer als Gast geantwortet hat (Nachweis: Geheimnis vom Gerät) – auch nach dem
--     Abend, solange der Teilen-Link gilt (bis 3 Tage nach dem Ende), nicht bei abgesagten Plänen. Die
--     Zusagekarte verrät weiterhin weder Crew-Namen noch Mitglieder.
--   * Jeder Link gilt einmal und 7 Tage; je Gast höchstens ein offener Link. Ausschalten (auch über
--     „Zusagen über den Link“) widerruft alle offenen Gast-Links des Plans, Entfernen eines Gasts seinen.
--   * Gast-Links zählen nicht gegen die Grenze von 10 offenen Einladungen und erscheinen nicht in der
--     Einladungsliste (Spalte `crew_invitations.via_plan_id`).
--   * Rate Limits: 30 Links je Teilen-Link und Stunde; die Grenze von 30 Gästen je Plan gilt.

alter table public.plans
  add column guest_join_by uuid references public.profiles (id) on delete set null;
create index plans_guest_join_by_idx on public.plans (guest_join_by) where guest_join_by is not null;

comment on column public.plans.guest_join_by is
  'W11: wer (Owner/Admin) „Gäste dürfen der Crew beitreten“ eingeschaltet hat – null = aus.';

alter table public.crew_invitations
  add column via_plan_id uuid references public.plans (id) on delete cascade,
  add column via_plan_guest_id uuid references public.plan_guests (id) on delete set null;
create index crew_invitations_via_plan_idx on public.crew_invitations (via_plan_id) where via_plan_id is not null;
create index crew_invitations_via_plan_guest_idx on public.crew_invitations (via_plan_guest_id)
  where via_plan_guest_id is not null;

-- Owner/Admin sehen bei ihren Einladungen, welche aus einem Plan stammen (zum Ausblenden).
grant select (via_plan_id) on public.crew_invitations to authenticated;

-- Ist der Beitritt für Gäste dieses Plans gerade möglich?
create function app_private.plan_guest_join_open(p_plan public.plans) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_plan.guests_allowed, false)
     and p_plan.guest_join_by is not null
     and p_plan.status <> 'cancelled'
     and exists (select 1 from public.crew_members m
                 where m.crew_id = p_plan.crew_id and m.user_id = p_plan.guest_join_by
                   and m.role in ('owner', 'admin'))
     and (select count(*) from public.crew_members m where m.crew_id = p_plan.crew_id) < 50;
$$;
revoke all on function app_private.plan_guest_join_open(public.plans) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Einladungen: Gast-Links aus Plänen zählen nicht gegen die Grenze (ersetzt die Fassung aus 20261014220000)
-- ---------------------------------------------------------------------------------------------
create or replace function public.create_crew_invitation(
  p_crew_id uuid, p_expires_in_hours integer default 168, p_max_uses integer default 20
) returns table (id uuid, token text, expires_at timestamptz, max_uses integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_hours integer := greatest(1, least(coalesce(p_expires_in_hours, 168), 720));
  v_uses integer := greatest(1, least(coalesce(p_max_uses, 20), 50));
begin
  if not app_private.has_crew_role(p_crew_id, array['owner', 'admin']::public.crew_role[]) then
    perform app_private.forbid();
  end if;
  perform app_private.rate_limit('create_invitation', 20, interval '1 hour');
  if (select count(*) from public.crew_invitations i
      where i.crew_id = p_crew_id and i.via_poll_id is null and i.via_plan_id is null
        and i.revoked_at is null and i.expires_at > now() and i.use_count < i.max_uses) >= 10 then
    perform app_private.fail('too_many_invitations');
  end if;

  return query
  insert into public.crew_invitations as i (crew_id, invited_by, token_hash, expires_at, max_uses)
  values (p_crew_id, v_uid, app_private.hash_token(v_token), now() + make_interval(hours => v_hours), v_uses)
  returning i.id, v_token, i.expires_at, i.max_uses;

  perform app_private.audit('invitation_created', 'crew', p_crew_id, p_crew_id,
                            jsonb_build_object('expires_in_hours', v_hours, 'max_uses', v_uses));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Für die Crew: Schalter
-- ---------------------------------------------------------------------------------------------
create function public.set_plan_guest_join(p_plan_id uuid, p_allowed boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
  v_revoked integer := 0;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id for update;
  if not found or not app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.forbid();
  end if;
  if not app_private.has_crew_role(v_plan.crew_id, array['owner', 'admin']::public.crew_role[]) then
    perform app_private.forbid();
  end if;
  if p_allowed is null then
    perform app_private.fail('invalid_input');
  end if;

  if p_allowed then
    if v_plan.status in ('completed', 'cancelled') then
      perform app_private.fail('plan_locked');
    end if;
    if not v_plan.guests_allowed then
      perform app_private.fail('plan_guests_off');
    end if;
    -- Schon an – außer die Person, die freigeschaltet hat, ist kein Owner/Admin mehr: dann übernimmt, wer jetzt einschaltet.
    if v_plan.guest_join_by is not null and exists (
      select 1 from public.crew_members m
      where m.crew_id = v_plan.crew_id and m.user_id = v_plan.guest_join_by and m.role in ('owner', 'admin')) then
      return;
    end if;
  elsif v_plan.guest_join_by is null then
    return;
  end if;
  perform app_private.rate_limit('plan_guest_join_toggle', 30, interval '1 hour');

  update public.plans p set guest_join_by = case when p_allowed then v_uid end where p.id = p_plan_id;
  if not p_allowed then
    update public.crew_invitations i set revoked_at = now()
    where i.via_plan_id = p_plan_id and i.revoked_at is null and i.use_count < i.max_uses;
    get diagnostics v_revoked = row_count;
  end if;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, crew_id, meta)
  values (v_uid, 'plan_guest_join', 'plan', p_plan_id, v_plan.crew_id,
          jsonb_build_object('allowed', p_allowed, 'revoked_invitations', v_revoked));
end $$;

-- Wer „Über den Link zusagen lassen“ ausschaltet, schaltet auch den Beitritt aus und widerruft offene
-- Gast-Links. Sonst wie in 20261104130000_plan_guests.sql.
create or replace function public.set_plan_guests(p_plan_id uuid, p_allowed boolean) returns void
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

  update public.plans p
  set guests_allowed = p_allowed,
      guest_join_by = case when p_allowed then p.guest_join_by end
  where p.id = p_plan_id;
  if not p_allowed then
    update public.crew_invitations i set revoked_at = now()
    where i.via_plan_id = p_plan_id and i.revoked_at is null and i.use_count < i.max_uses;
  end if;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, crew_id, meta)
  values (v_uid, 'plan_guests', 'plan', p_plan_id, v_plan.crew_id, jsonb_build_object('allowed', p_allowed));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Zusagekarte: wie in 20261105180000, neu ist nur `plan.can_join`.
-- ---------------------------------------------------------------------------------------------
create or replace function public.shared_plan_rsvp(p_token text, p_secret text default null) returns jsonb
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
      'meeting_point', v_plan.meeting_point,
      'can_join', app_private.plan_guest_join_open(v_plan)),
    'counts', (
      select jsonb_build_object(
               'going', count(*) filter (where x.s = 'going'),
               'maybe', count(*) filter (where x.s = 'maybe'))
      from (select pp.attendance_status as s from public.plan_participants pp where pp.plan_id = v_plan.id
            union all
            select g.attendance_status from public.plan_guests g where g.plan_id = v_plan.id) x),
    'me', case when v_guest.id is null then null else jsonb_strip_nulls(jsonb_build_object(
      'name', v_guest.display_name,
      'status', v_guest.attendance_status,
      'note', v_guest.note,
      'waitlist', case when v_guest.waitlisted_at is not null then app_private.plan_waitlist_position(v_plan.id, null, v_guest.id) end,
      'promoted', case when v_guest.promoted_at is not null and v_guest.attendance_status = 'going' then true end)) end);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Ohne Konto: persönlichen Einladungslink holen
-- ---------------------------------------------------------------------------------------------
-- Liefert {token, expires_at}. Der Klartext-Token wird nur hier einmal herausgegeben, gespeichert ist nur
-- sein Hash. Gleicher Gast fordert erneut an → alter, unbenutzter Link wird widerrufen.
create function public.guest_join_shared_plan(p_token text, p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.plans;
  v_guest_id uuid;
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_expires timestamptz := now() + interval '7 days';
begin
  v_plan := app_private.plan_by_share_token(p_token);
  if v_plan.id is null or coalesce(v_plan.ends_at, v_plan.starts_at) < now() - interval '3 days' then
    perform app_private.fail('share_not_found');
  end if;
  if not app_private.plan_guest_join_open(v_plan) then
    perform app_private.fail('plan_guest_join_off');
  end if;
  if auth.uid() is not null and app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.fail('plan_guest_member');
  end if;
  if p_secret is null or p_secret !~ '^[0-9a-f]{64}$' then
    perform app_private.fail('invalid_input');
  end if;

  perform app_private.rate_limit_key(p_token, 'plan_guest_join_link', 30, interval '1 hour');

  select g.id into v_guest_id from public.plan_guests g
  where g.plan_id = v_plan.id and g.secret_hash = app_private.hash_token(p_secret)
  for update;
  if v_guest_id is null then
    perform app_private.fail('plan_guest_not_found');
  end if;

  update public.crew_invitations i set revoked_at = now()
  where i.via_plan_guest_id = v_guest_id and i.revoked_at is null and i.use_count < i.max_uses;

  insert into public.crew_invitations (crew_id, invited_by, token_hash, expires_at, max_uses, via_plan_id, via_plan_guest_id)
  values (v_plan.crew_id, v_plan.guest_join_by, app_private.hash_token(v_token), v_expires, 1, v_plan.id, v_guest_id);

  insert into public.audit_log (actor_id, action, entity_type, entity_id, crew_id, meta)
  values (null, 'plan_guest_invitation', 'plan', v_plan.id, v_plan.crew_id, '{}'::jsonb);

  return jsonb_build_object('token', v_token, 'expires_at', v_expires);
end $$;

revoke all on function public.set_plan_guest_join(uuid, boolean), public.guest_join_shared_plan(text, text)
from public, anon, authenticated;
grant execute on function public.set_plan_guest_join(uuid, boolean) to authenticated;
grant execute on function public.guest_join_shared_plan(text, text) to anon, authenticated;
-- Rechte der ersetzten Funktionen ausdrücklich festhalten (create or replace behält sie).
revoke all on function public.create_crew_invitation(uuid, integer, integer), public.set_plan_guests(uuid, boolean),
  public.shared_plan_rsvp(text, text) from public, anon, authenticated;
grant execute on function public.create_crew_invitation(uuid, integer, integer), public.set_plan_guests(uuid, boolean) to authenticated;
grant execute on function public.shared_plan_rsvp(text, text) to anon, authenticated;

-- Wird ein Gast entfernt (oder übernommen), verfällt sein noch unbenutzter Einladungslink.
create function app_private.revoke_plan_guest_invitations() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.crew_invitations i set revoked_at = now()
  where i.via_plan_guest_id = old.id and i.revoked_at is null and i.use_count < i.max_uses
    -- Wird der ganze Plan gelöscht, verschwinden seine Gast-Links ohnehin (on delete cascade).
    and exists (select 1 from public.plans p where p.id = old.plan_id);
  return old;
end $$;
revoke all on function app_private.revoke_plan_guest_invitations() from public, anon, authenticated;

create trigger plan_guests_revoke_invitations
  before delete on public.plan_guests
  for each row execute function app_private.revoke_plan_guest_invitations();

comment on function public.guest_join_shared_plan(text, text) is
  'W11: Gast mit Antwort auf diesem Gerät holt einen persönlichen Einladungslink (einmal, 7 Tage), wenn Owner/Admin den Beitritt freigeschaltet haben.';
