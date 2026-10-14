-- W3 Etappe 3 · Gäste treten vom Stimmzettel aus der Crew bei
-- Owner oder Admin einer Crew können bei einer Abstimmung mit Gästen zusätzlich „Gäste dürfen der
-- Crew beitreten“ einschalten. Wer dann als Gast abgestimmt hat, sieht auf dem Stimmzettel
-- „<Crew> beitreten“ und bekommt einen persönlichen Einladungslink – ohne erst im Gruppenchat
-- danach fragen zu müssen. Der Beitritt selbst läuft über die normale Einladung (W1).
--
-- Bewusst so gebaut:
--   * Standard ist aus. Einschalten dürfen nur Owner/Admin (wie beim Erstellen von Einladungen);
--     gespeichert wird, wer eingeschaltet hat (`polls.guest_join_by`) – diese Person steht als
--     „lädt dich ein“ auf der Einladung. Verlässt sie die Crew oder verliert die Rolle, gilt der
--     Schalter nicht mehr.
--   * Nur wer schon als Gast abgestimmt hat (Nachweis: Geheimnis vom Gerät), bekommt einen Link.
--     Der Stimmzettel allein verrät weiterhin weder Crew-Namen noch Mitglieder.
--   * Jeder Link gilt einmal und 7 Tage. Fordert derselbe Gast erneut an, wird sein alter, unbenutzter
--     Link widerrufen – je Gast gibt es höchstens einen offenen Link. Ausschalten widerruft alle
--     offenen Gast-Links dieser Abstimmung.
--   * Gast-Links zählen nicht gegen die Grenze von 10 offenen Einladungen der Crew und erscheinen
--     nicht in der Einladungsliste (Spalte `crew_invitations.via_poll_id`).
--   * Rate Limits: 30 Links je Abstimmungs-Link und Stunde, Grenzen der Gäste (30 je Abstimmung) gelten.

alter table public.polls
  add column guest_join_by uuid references public.profiles (id) on delete set null;

alter table public.crew_invitations
  add column via_poll_id uuid references public.polls (id) on delete cascade,
  add column via_poll_guest_id uuid references public.poll_guests (id) on delete set null;
create index crew_invitations_via_poll_guest_idx on public.crew_invitations (via_poll_guest_id)
  where via_poll_guest_id is not null;

-- Owner/Admin sehen bei ihren Einladungen, welche aus einer Abstimmung stammen (zum Ausblenden).
grant select (via_poll_id) on public.crew_invitations to authenticated;

-- Ist der Beitritt für Gäste dieser Abstimmung gerade möglich?
create function app_private.poll_guest_join_open(p_poll public.polls) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_poll.guests_allowed
     and p_poll.guest_join_by is not null
     and exists (select 1 from public.crew_members m
                 where m.crew_id = p_poll.crew_id and m.user_id = p_poll.guest_join_by
                   and m.role in ('owner', 'admin'))
     and (select count(*) from public.crew_members m where m.crew_id = p_poll.crew_id) < 50;
$$;
revoke all on function app_private.poll_guest_join_open(public.polls) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Einladungen: Gast-Links zählen nicht gegen die Grenze (ersetzt die Fassung aus 20261011100300)
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
      where i.crew_id = p_crew_id and i.via_poll_id is null
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
create function public.set_poll_guest_join(p_poll_id uuid, p_allowed boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_poll public.polls%rowtype;
  v_revoked integer := 0;
begin
  select * into v_poll from public.polls p where p.id = p_poll_id for update;
  if not found or not app_private.is_crew_member(v_poll.crew_id) then
    perform app_private.forbid();
  end if;
  if not app_private.has_crew_role(v_poll.crew_id, array['owner', 'admin']::public.crew_role[]) then
    perform app_private.forbid();
  end if;
  if p_allowed is null then
    perform app_private.fail('invalid_input');
  end if;

  if p_allowed then
    if v_poll.status <> 'open' or v_poll.ends_at <= now() then
      perform app_private.fail('poll_closed');
    end if;
    if not v_poll.guests_allowed then
      perform app_private.fail('guests_not_allowed');
    end if;
    if v_poll.guest_join_by is not null then
      return;
    end if;
  elsif v_poll.guest_join_by is null then
    return;
  end if;
  perform app_private.rate_limit('poll_guest_join_toggle', 30, interval '1 hour');

  update public.polls p set guest_join_by = case when p_allowed then v_uid end where p.id = p_poll_id;
  if not p_allowed then
    update public.crew_invitations i set revoked_at = now()
    where i.via_poll_id = p_poll_id and i.revoked_at is null and i.use_count < i.max_uses;
    get diagnostics v_revoked = row_count;
  end if;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, crew_id, meta)
  values (v_uid, 'poll_guest_join', 'poll', p_poll_id, v_poll.crew_id,
          jsonb_build_object('allowed', p_allowed, 'revoked_invitations', v_revoked));
end $$;

-- Wer „Gäste dürfen mitstimmen“ ausschaltet, schaltet auch den Beitritt aus.
-- (Ersetzt die Fassung aus 20261014160000_poll_guest_votes.sql.)
create or replace function public.set_poll_guests(p_poll_id uuid, p_allowed boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_poll public.polls%rowtype;
begin
  select * into v_poll from public.polls p where p.id = p_poll_id for update;
  if not found or not app_private.is_crew_member(v_poll.crew_id) then
    perform app_private.forbid();
  end if;
  if not (v_poll.created_by is not distinct from v_uid
          or app_private.has_crew_role(v_poll.crew_id, array['owner', 'admin']::public.crew_role[])) then
    perform app_private.forbid();
  end if;
  if p_allowed is null then
    perform app_private.fail('invalid_input');
  end if;
  if v_poll.status <> 'open' or v_poll.ends_at <= now() then
    perform app_private.fail('poll_closed');
  end if;
  if v_poll.guests_allowed = p_allowed then
    return;
  end if;
  perform app_private.rate_limit('poll_guests_toggle', 30, interval '1 hour');

  update public.polls p
  set guests_allowed = p_allowed,
      guest_join_by = case when p_allowed then p.guest_join_by end
  where p.id = p_poll_id;
  if not p_allowed then
    update public.crew_invitations i set revoked_at = now()
    where i.via_poll_id = p_poll_id and i.revoked_at is null and i.use_count < i.max_uses;
  end if;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, crew_id, meta)
  values (v_uid, 'poll_guests', 'poll', p_poll_id, v_poll.crew_id, jsonb_build_object('allowed', p_allowed));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Stimmzettel: neu ist nur „can_join“ (ersetzt die Fassung aus 20261014160000)
-- ---------------------------------------------------------------------------------------------
create or replace function public.shared_poll_ballot(p_token text, p_secret text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_poll public.polls;
  v_guest public.poll_guests;
begin
  v_poll := app_private.poll_by_share_token(p_token);
  if v_poll.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if least(coalesce(v_poll.closed_at, v_poll.ends_at), v_poll.ends_at) < now() - interval '3 days' then
    return jsonb_build_object('status', 'expired');
  end if;

  perform app_private.rate_limit_key(p_token, 'poll_guest_ballot', 240, interval '10 minutes');
  if not v_poll.guests_allowed then
    return jsonb_build_object('status', 'guests_off');
  end if;

  if p_secret ~ '^[0-9a-f]{64}$' then
    select g.* into v_guest from public.poll_guests g
    where g.poll_id = v_poll.id and g.secret_hash = app_private.hash_token(p_secret);
  end if;

  return jsonb_build_object(
    'status', 'valid',
    'poll', jsonb_build_object(
      'title', v_poll.title,
      'ends_at', v_poll.ends_at,
      'open', v_poll.status = 'open' and v_poll.ends_at > now(),
      'can_join', app_private.poll_guest_join_open(v_poll)),
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', o.position,
               'title', o.title,
               'proposed_date', o.proposed_date,
               'proposed_time', left(o.proposed_time::text, 5),
               'yes', r.yes, 'maybe', r.maybe, 'no', r.no) order by o.position)
      from public.poll_options o
      cross join lateral (
        select count(*) filter (where x.response = 'yes') as yes,
               count(*) filter (where x.response = 'maybe') as maybe,
               count(*) filter (where x.response = 'no') as no
        from (select v.response from public.poll_votes v where v.poll_option_id = o.id
              union all
              select g.response from public.poll_guest_votes g where g.poll_option_id = o.id) x
      ) r
      where o.poll_id = v_poll.id), '[]'::jsonb),
    'me', case when v_guest.id is null then null else jsonb_build_object(
      'name', v_guest.display_name,
      'votes', coalesce((
        select jsonb_object_agg(o.position::text, g.response)
        from public.poll_guest_votes g join public.poll_options o on o.id = g.poll_option_id
        where g.guest_id = v_guest.id), '{}'::jsonb)) end);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Ohne Konto: persönlichen Einladungslink holen
-- ---------------------------------------------------------------------------------------------
-- Liefert {token, expires_at}. Der Klartext-Token wird nur hier einmal herausgegeben, gespeichert
-- ist nur sein Hash. Gleicher Gast fordert erneut an → alter, unbenutzter Link wird widerrufen.
create function public.guest_join_shared_poll(p_token text, p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_poll public.polls;
  v_guest_id uuid;
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_expires timestamptz := now() + interval '7 days';
begin
  v_poll := app_private.poll_by_share_token(p_token);
  if v_poll.id is null then
    perform app_private.fail('share_not_found');
  end if;
  if least(coalesce(v_poll.closed_at, v_poll.ends_at), v_poll.ends_at) < now() - interval '3 days' then
    perform app_private.fail('share_not_found');
  end if;
  if not app_private.poll_guest_join_open(v_poll) then
    perform app_private.fail('guest_join_off');
  end if;
  if auth.uid() is not null and app_private.is_crew_member(v_poll.crew_id) then
    perform app_private.fail('already_member');
  end if;
  if p_secret is null or p_secret !~ '^[0-9a-f]{64}$' then
    perform app_private.fail('invalid_input');
  end if;

  perform app_private.rate_limit_key(p_token, 'poll_guest_join_link', 30, interval '1 hour');

  select g.id into v_guest_id from public.poll_guests g
  where g.poll_id = v_poll.id and g.secret_hash = app_private.hash_token(p_secret)
  for update;
  if v_guest_id is null then
    perform app_private.fail('guest_not_found');
  end if;

  update public.crew_invitations i set revoked_at = now()
  where i.via_poll_guest_id = v_guest_id and i.revoked_at is null and i.use_count < i.max_uses;

  insert into public.crew_invitations (crew_id, invited_by, token_hash, expires_at, max_uses, via_poll_id, via_poll_guest_id)
  values (v_poll.crew_id, v_poll.guest_join_by, app_private.hash_token(v_token), v_expires, 1, v_poll.id, v_guest_id);

  insert into public.audit_log (actor_id, action, entity_type, entity_id, crew_id, meta)
  values (null, 'poll_guest_invitation', 'poll', v_poll.id, v_poll.crew_id, '{}'::jsonb);

  return jsonb_build_object('token', v_token, 'expires_at', v_expires);
end $$;

revoke all on function public.set_poll_guest_join(uuid, boolean), public.guest_join_shared_poll(text, text)
from public, anon, authenticated;
grant execute on function public.set_poll_guest_join(uuid, boolean) to authenticated;
grant execute on function public.guest_join_shared_poll(text, text) to anon, authenticated;

-- Wird ein Gast entfernt (oder übernommen), verfällt sein noch unbenutzter Einladungslink.
create function app_private.revoke_poll_guest_invitations() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.crew_invitations i set revoked_at = now()
  where i.via_poll_guest_id = old.id and i.revoked_at is null and i.use_count < i.max_uses
    -- Wird die ganze Abstimmung gelöscht, verschwinden ihre Gast-Links ohnehin (on delete cascade).
    and exists (select 1 from public.polls p where p.id = old.poll_id);
  return old;
end $$;
revoke all on function app_private.revoke_poll_guest_invitations() from public, anon, authenticated;

create trigger poll_guests_revoke_invitations
  before delete on public.poll_guests
  for each row execute function app_private.revoke_poll_guest_invitations();
