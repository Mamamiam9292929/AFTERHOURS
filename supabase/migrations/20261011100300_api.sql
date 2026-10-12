-- AFTERHOURS · 4/5 · API: geprüfte RPC-Funktionen (Crews, Einladungen, Abstimmungen, Pläne, Konto)
--
-- Jede Funktion
--   * ermittelt die aufrufende Person über auth.uid() (niemals über einen Parameter),
--   * prüft Mitgliedschaft bzw. Rolle serverseitig,
--   * validiert und bereinigt alle Eingaben,
--   * ist nur für die Rolle "authenticated" ausführbar (siehe Ende der Datei).

-- ---------------------------------------------------------------------------------------------
-- Crews
-- ---------------------------------------------------------------------------------------------
create function public.create_crew(p_name text, p_emoji text default '🌙') returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_name text := app_private.clean_line(p_name, 40);
  v_crew_id uuid;
begin
  if v_name is null or char_length(v_name) < 2 then
    perform app_private.fail('invalid_name');
  end if;
  perform app_private.rate_limit('create_crew', 10, interval '1 hour');
  if (select count(*) from public.crew_members m where m.user_id = v_uid) >= 30 then
    perform app_private.fail('crew_limit_reached');
  end if;

  insert into public.crews (name, emoji, created_by)
  values (v_name, coalesce(app_private.clean_line(p_emoji, 16), '🌙'), v_uid)
  returning id into v_crew_id;
  insert into public.crew_members (crew_id, user_id, role) values (v_crew_id, v_uid, 'owner');

  perform app_private.audit('crew_created', 'crew', v_crew_id, v_crew_id);
  return v_crew_id;
end $$;

create function public.leave_crew(p_crew_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
begin
  delete from public.crew_members m where m.crew_id = p_crew_id and m.user_id = v_uid;
  if not found then
    perform app_private.forbid();
  end if;
  perform app_private.audit('crew_left', 'crew', p_crew_id, p_crew_id);
end $$;

-- Owner dürfen Admins und Mitglieder entfernen, Admins nur Mitglieder.
create function public.remove_crew_member(p_crew_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_my_role public.crew_role;
  v_target_role public.crew_role;
  v_crew_name text;
begin
  select m.role into v_my_role from public.crew_members m where m.crew_id = p_crew_id and m.user_id = v_uid;
  select m.role into v_target_role from public.crew_members m where m.crew_id = p_crew_id and m.user_id = p_user_id;
  if v_my_role is null or v_target_role is null or p_user_id = v_uid then
    perform app_private.forbid();
  end if;
  if not (v_my_role = 'owner' or (v_my_role = 'admin' and v_target_role = 'member')) then
    perform app_private.forbid();
  end if;

  select c.name into v_crew_name from public.crews c where c.id = p_crew_id;
  delete from public.crew_members m where m.crew_id = p_crew_id and m.user_id = p_user_id;

  -- crew_id bleibt leer: die entfernte Person darf die Crew nicht mehr lesen.
  perform app_private.notify(p_user_id, 'crew_member_removed', null, null, null, null,
                             jsonb_build_object('crew_name', v_crew_name));
  perform app_private.audit('crew_member_removed', 'crew', p_crew_id, p_crew_id, jsonb_build_object('user_id', p_user_id));
end $$;

-- Nur der Owner vergibt Rollen. p_role = 'owner' überträgt die Crew; der bisherige Owner wird Admin.
create function public.set_crew_member_role(p_crew_id uuid, p_user_id uuid, p_role public.crew_role) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
begin
  if not app_private.has_crew_role(p_crew_id, array['owner']::public.crew_role[]) or p_user_id = v_uid then
    perform app_private.forbid();
  end if;
  if not exists (select 1 from public.crew_members m where m.crew_id = p_crew_id and m.user_id = p_user_id) then
    perform app_private.forbid();
  end if;

  if p_role = 'owner' then
    update public.crew_members m set role = 'admin' where m.crew_id = p_crew_id and m.user_id = v_uid;
    update public.crew_members m set role = 'owner' where m.crew_id = p_crew_id and m.user_id = p_user_id;
  else
    update public.crew_members m set role = p_role where m.crew_id = p_crew_id and m.user_id = p_user_id;
  end if;

  perform app_private.notify(p_user_id, 'crew_role_changed', v_uid, p_crew_id, 'crew', p_crew_id,
                             jsonb_build_object('role', p_role::text));
  perform app_private.audit('crew_role_changed', 'crew', p_crew_id, p_crew_id,
                            jsonb_build_object('user_id', p_user_id, 'role', p_role::text));
end $$;

create function public.send_crew_message(p_crew_id uuid, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_body text := app_private.clean_text(p_body, 1000);
  v_id uuid;
begin
  if not app_private.is_crew_member(p_crew_id) then
    perform app_private.forbid();
  end if;
  if v_body is null then
    perform app_private.fail('empty_message');
  end if;
  perform app_private.rate_limit('send_message', 30, interval '1 minute');
  insert into public.crew_messages (crew_id, user_id, body) values (p_crew_id, v_uid, v_body) returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Einladungen
-- ---------------------------------------------------------------------------------------------
-- Gibt den Klartext-Token genau einmal zurück. Gespeichert wird nur sein Hash.
create function public.create_crew_invitation(
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
      where i.crew_id = p_crew_id and i.revoked_at is null and i.expires_at > now() and i.use_count < i.max_uses) >= 10 then
    perform app_private.fail('too_many_invitations');
  end if;

  return query
  insert into public.crew_invitations as i (crew_id, invited_by, token_hash, expires_at, max_uses)
  values (p_crew_id, v_uid, app_private.hash_token(v_token), now() + make_interval(hours => v_hours), v_uses)
  returning i.id, v_token, i.expires_at, i.max_uses;

  perform app_private.audit('invitation_created', 'crew', p_crew_id, p_crew_id,
                            jsonb_build_object('expires_in_hours', v_hours, 'max_uses', v_uses));
end $$;

create function public.revoke_crew_invitation(p_invitation_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_crew_id uuid;
begin
  perform app_private.require_user();
  select i.crew_id into v_crew_id from public.crew_invitations i where i.id = p_invitation_id;
  if v_crew_id is null or not app_private.has_crew_role(v_crew_id, array['owner', 'admin']::public.crew_role[]) then
    perform app_private.forbid();
  end if;
  update public.crew_invitations i set revoked_at = coalesce(i.revoked_at, now()) where i.id = p_invitation_id;
  perform app_private.audit('invitation_revoked', 'crew', v_crew_id, v_crew_id, jsonb_build_object('invitation_id', p_invitation_id));
end $$;

create function app_private.invitation_state(p_inv public.crew_invitations) returns text
language sql stable set search_path = '' as $$
  select case
    when p_inv.id is null then 'not_found'
    when p_inv.revoked_at is not null then 'revoked'
    when p_inv.expires_at <= now() then 'expired'
    when p_inv.use_count >= p_inv.max_uses then 'exhausted'
    else 'valid'
  end;
$$;

-- Vorschau für die Beitrittsseite. Ungültige Tokens liefern keinerlei Informationen über die Crew.
create function public.preview_crew_invitation(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_inv public.crew_invitations;
  v_state text;
begin
  perform app_private.rate_limit('invitation_lookup', 30, interval '10 minutes');
  select * into v_inv from public.crew_invitations i where i.token_hash = app_private.hash_token(p_token);
  v_state := app_private.invitation_state(v_inv);

  if v_inv.id is not null and exists (select 1 from public.crew_members m where m.crew_id = v_inv.crew_id and m.user_id = v_uid) then
    return jsonb_build_object('status', 'already_member', 'crew_id', v_inv.crew_id);
  end if;
  if v_state <> 'valid' then
    return jsonb_build_object('status', v_state);
  end if;

  return (
    select jsonb_build_object(
      'status', 'valid',
      'crew', jsonb_build_object(
        'id', c.id, 'name', c.name, 'emoji', c.emoji,
        'member_count', (select count(*) from public.crew_members m where m.crew_id = c.id)),
      'invited_by', (select p.display_name from public.profiles p where p.id = v_inv.invited_by),
      'expires_at', v_inv.expires_at)
    from public.crews c where c.id = v_inv.crew_id
  );
end $$;

-- Beitritt per Einladung. Liefert immer einen Status statt einer Exception, damit Fehlversuche
-- im Rate Limit gezählt bleiben.
create function public.accept_crew_invitation(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_inv public.crew_invitations;
  v_state text;
begin
  perform app_private.rate_limit('invitation_accept', 20, interval '10 minutes');
  select * into v_inv from public.crew_invitations i where i.token_hash = app_private.hash_token(p_token) for update;
  v_state := app_private.invitation_state(v_inv);

  if v_inv.id is not null and exists (select 1 from public.crew_members m where m.crew_id = v_inv.crew_id and m.user_id = v_uid) then
    return jsonb_build_object('status', 'already_member', 'crew_id', v_inv.crew_id);
  end if;
  if v_state <> 'valid' then
    return jsonb_build_object('status', v_state);
  end if;
  if (select count(*) from public.crew_members m where m.crew_id = v_inv.crew_id) >= 50 then
    return jsonb_build_object('status', 'crew_full');
  end if;
  if (select count(*) from public.crew_members m where m.user_id = v_uid) >= 30 then
    return jsonb_build_object('status', 'crew_limit_reached');
  end if;

  insert into public.crew_members (crew_id, user_id, role) values (v_inv.crew_id, v_uid, 'member');
  update public.crew_invitations i set use_count = i.use_count + 1 where i.id = v_inv.id;

  perform app_private.notify(m.user_id, 'crew_member_joined', v_uid, v_inv.crew_id, 'crew', v_inv.crew_id, '{}'::jsonb,
                             'crew_member_joined:' || v_inv.crew_id::text || ':' || v_uid::text)
  from public.crew_members m
  where m.crew_id = v_inv.crew_id and m.role in ('owner', 'admin') and m.user_id <> v_uid;

  perform app_private.audit('crew_joined', 'crew', v_inv.crew_id, v_inv.crew_id, jsonb_build_object('invitation_id', v_inv.id));
  return jsonb_build_object('status', 'joined', 'crew_id', v_inv.crew_id);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Abstimmungen
-- ---------------------------------------------------------------------------------------------
-- p_options: JSON-Array mit 1–10 Einträgen der Form
--   { "activity_id": uuid?, "title": text?, "proposed_date": "YYYY-MM-DD"?, "proposed_time": "HH:MM"?,
--     "estimated_price_cents": int? }
-- Entweder activity_id oder title muss gesetzt sein (eigener Vorschlag = nur title).
create function public.create_poll(
  p_crew_id uuid, p_title text, p_ends_at timestamptz, p_options jsonb,
  p_description text default null, p_meeting_point text default null,
  p_budget_cents integer default null, p_min_participants integer default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_title text := app_private.clean_line(p_title, 80);
  v_poll_id uuid;
  v_option record;
  v_activity public.activities%rowtype;
  v_option_title text;
begin
  if not app_private.is_crew_member(p_crew_id) then
    perform app_private.forbid();
  end if;
  if v_title is null or char_length(v_title) < 3 then
    perform app_private.fail('invalid_title');
  end if;
  if p_ends_at is null or p_ends_at <= now() then
    perform app_private.fail('ends_in_past');
  end if;
  if p_ends_at > now() + interval '90 days' then
    perform app_private.fail('ends_too_late');
  end if;
  if p_options is null or jsonb_typeof(p_options) <> 'array' or jsonb_array_length(p_options) not between 1 and 10 then
    perform app_private.fail('invalid_options');
  end if;
  perform app_private.rate_limit('create_poll', 20, interval '1 hour');
  if (select count(*) from public.polls p where p.crew_id = p_crew_id and p.status = 'open') >= 20 then
    perform app_private.fail('too_many_open_polls');
  end if;

  insert into public.polls (crew_id, created_by, title, description, meeting_point, budget_cents, min_participants, ends_at)
  values (p_crew_id, v_uid, v_title, app_private.clean_text(p_description, 500), app_private.clean_line(p_meeting_point, 160),
          p_budget_cents, p_min_participants, p_ends_at)
  returning id into v_poll_id;

  for v_option in select value, ordinality from jsonb_array_elements(p_options) with ordinality loop
    if jsonb_typeof(v_option.value) <> 'object' then
      perform app_private.fail('invalid_options');
    end if;
    v_activity := null;
    if nullif(v_option.value ->> 'activity_id', '') is not null then
      select * into v_activity from public.activities a
      where a.id = (v_option.value ->> 'activity_id')::uuid and a.is_active;
      if not found then
        perform app_private.fail('unknown_activity');
      end if;
    end if;
    v_option_title := coalesce(app_private.clean_line(v_option.value ->> 'title', 120), v_activity.name);
    if v_option_title is null then
      perform app_private.fail('invalid_options');
    end if;

    insert into public.poll_options (poll_id, activity_id, title, proposed_date, proposed_time, estimated_price_cents, position)
    values (
      v_poll_id, v_activity.id, v_option_title,
      nullif(v_option.value ->> 'proposed_date', '')::date,
      nullif(v_option.value ->> 'proposed_time', '')::time,
      nullif(v_option.value ->> 'estimated_price_cents', '')::integer,
      v_option.ordinality::smallint
    );
  end loop;

  perform app_private.notify_crew(p_crew_id, 'poll_created', v_uid, 'poll', v_poll_id,
                                  jsonb_build_object('title', v_title), 'poll_created:' || v_poll_id::text);
  return v_poll_id;
end $$;

-- Stimme abgeben oder ändern. Der Unique-Index (Option, Person) schließt doppelte Stimmen aus.
create function public.cast_vote(p_option_id uuid, p_response public.vote_response) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_poll public.polls%rowtype;
begin
  select p.* into v_poll
  from public.poll_options o join public.polls p on p.id = o.poll_id
  where o.id = p_option_id;
  if not found or not app_private.is_crew_member(v_poll.crew_id) then
    perform app_private.forbid();
  end if;
  if v_poll.status <> 'open' or v_poll.ends_at <= now() then
    perform app_private.fail('poll_closed');
  end if;
  perform app_private.rate_limit('vote', 120, interval '1 minute');

  insert into public.poll_votes (poll_id, poll_option_id, user_id, response)
  values (v_poll.id, p_option_id, v_uid, p_response)
  on conflict (poll_option_id, user_id)
  do update set response = excluded.response, updated_at = now();

  if v_poll.created_by is distinct from v_uid then
    perform app_private.notify(v_poll.created_by, 'poll_vote', v_uid, v_poll.crew_id, 'poll', v_poll.id,
                               jsonb_build_object('title', v_poll.title),
                               'poll_vote:' || v_poll.id::text || ':' || v_uid::text);
  end if;
end $$;

create function public.retract_vote(p_option_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_poll public.polls%rowtype;
begin
  select p.* into v_poll
  from public.poll_options o join public.polls p on p.id = o.poll_id
  where o.id = p_option_id;
  if not found or not app_private.is_crew_member(v_poll.crew_id) then
    perform app_private.forbid();
  end if;
  if v_poll.status <> 'open' or v_poll.ends_at <= now() then
    perform app_private.fail('poll_closed');
  end if;
  delete from public.poll_votes v where v.poll_option_id = p_option_id and v.user_id = v_uid;
end $$;

-- Vorzeitig beenden: Ersteller:in der Abstimmung oder Owner/Admin der Crew.
create function public.close_poll(p_poll_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_poll public.polls%rowtype;
begin
  select * into v_poll from public.polls p where p.id = p_poll_id;
  if not found or not app_private.is_crew_member(v_poll.crew_id) then
    perform app_private.forbid();
  end if;
  if not (v_poll.created_by is not distinct from v_uid
          or app_private.has_crew_role(v_poll.crew_id, array['owner', 'admin']::public.crew_role[])) then
    perform app_private.forbid();
  end if;
  perform app_private.close_poll_internal(p_poll_id, v_uid);
end $$;

-- Nach Fristablauf darf jedes Mitglied das Ergebnis feststellen lassen (wirkungslos vor Ablauf).
create function public.finalize_due_poll(p_poll_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_poll public.polls%rowtype;
begin
  perform app_private.require_user();
  select * into v_poll from public.polls p where p.id = p_poll_id;
  if not found or not app_private.is_crew_member(v_poll.crew_id) then
    perform app_private.forbid();
  end if;
  if v_poll.status = 'open' and v_poll.ends_at <= now() then
    perform app_private.close_poll_internal(p_poll_id, null);
    return true;
  end if;
  return false;
end $$;

-- Stichwahl zwischen den gleichauf liegenden Optionen einer beendeten Abstimmung.
create function public.start_runoff_poll(p_poll_id uuid, p_title text, p_ends_at timestamptz) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_poll public.polls%rowtype;
  v_title text := app_private.clean_line(p_title, 80);
  v_new_id uuid;
begin
  select * into v_poll from public.polls p where p.id = p_poll_id;
  if not found or not app_private.is_crew_member(v_poll.crew_id) then
    perform app_private.forbid();
  end if;
  if not (v_poll.created_by is not distinct from v_uid
          or app_private.has_crew_role(v_poll.crew_id, array['owner', 'admin']::public.crew_role[])) then
    perform app_private.forbid();
  end if;
  if v_poll.status <> 'closed' or not v_poll.is_tie then
    perform app_private.fail('no_tie');
  end if;
  if exists (select 1 from public.polls c where c.parent_poll_id = p_poll_id) then
    perform app_private.fail('runoff_exists');
  end if;
  if v_title is null or char_length(v_title) < 3 then
    perform app_private.fail('invalid_title');
  end if;
  if p_ends_at is null or p_ends_at <= now() then
    perform app_private.fail('ends_in_past');
  end if;
  if p_ends_at > now() + interval '90 days' then
    perform app_private.fail('ends_too_late');
  end if;
  perform app_private.rate_limit('create_poll', 20, interval '1 hour');

  insert into public.polls (crew_id, created_by, parent_poll_id, title, description, meeting_point, budget_cents, min_participants, ends_at)
  values (v_poll.crew_id, v_uid, p_poll_id, v_title, v_poll.description, v_poll.meeting_point, v_poll.budget_cents, v_poll.min_participants, p_ends_at)
  returning id into v_new_id;

  with counts as (
    select o.id, count(v.id) filter (where v.response = 'yes') as yes_count
    from public.poll_options o left join public.poll_votes v on v.poll_option_id = o.id
    where o.poll_id = p_poll_id group by o.id
  )
  insert into public.poll_options (poll_id, activity_id, title, proposed_date, proposed_time, estimated_price_cents, position)
  select v_new_id, o.activity_id, o.title, o.proposed_date, o.proposed_time, o.estimated_price_cents, o.position
  from public.poll_options o join counts c on c.id = o.id
  where c.yes_count = (select max(yes_count) from counts)
  order by o.position;

  perform app_private.notify_crew(v_poll.crew_id, 'poll_created', v_uid, 'poll', v_new_id,
                                  jsonb_build_object('title', v_title, 'runoff', true), 'poll_created:' || v_new_id::text);
  return v_new_id;
end $$;

-- Erinnert alle, die noch gar nicht abgestimmt haben. Höchstens alle 6 Stunden pro Abstimmung.
create function public.remind_poll(p_poll_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_poll public.polls%rowtype;
  v_member record;
  v_count integer := 0;
begin
  select * into v_poll from public.polls p where p.id = p_poll_id for update;
  if not found or not app_private.is_crew_member(v_poll.crew_id) then
    perform app_private.forbid();
  end if;
  if not (v_poll.created_by is not distinct from v_uid
          or app_private.has_crew_role(v_poll.crew_id, array['owner', 'admin']::public.crew_role[])) then
    perform app_private.forbid();
  end if;
  if v_poll.status <> 'open' or v_poll.ends_at <= now() then
    perform app_private.fail('poll_closed');
  end if;
  if v_poll.last_reminded_at is not null and v_poll.last_reminded_at > now() - interval '6 hours' then
    perform app_private.fail('reminder_too_soon');
  end if;

  for v_member in
    select m.user_id from public.crew_members m
    where m.crew_id = v_poll.crew_id and m.user_id <> v_uid
      and not exists (select 1 from public.poll_votes v where v.poll_id = p_poll_id and v.user_id = m.user_id)
  loop
    perform app_private.notify(v_member.user_id, 'poll_reminder', v_uid, v_poll.crew_id, 'poll', p_poll_id,
                               jsonb_build_object('title', v_poll.title),
                               'poll_reminder:' || p_poll_id::text || ':' || to_char(now(), 'YYYYMMDDHH24'));
    v_count := v_count + 1;
  end loop;

  update public.polls p set last_reminded_at = now() where p.id = p_poll_id;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Pläne
-- ---------------------------------------------------------------------------------------------
create function app_private.add_plan_participants(p_plan_id uuid, p_crew_id uuid, p_organizer uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.plan_participants (plan_id, user_id, attendance_status, responded_at)
  select p_plan_id, m.user_id,
         case when m.user_id = p_organizer then 'going'::public.attendance_status else 'invited'::public.attendance_status end,
         case when m.user_id = p_organizer then now() end
  from public.crew_members m where m.crew_id = p_crew_id
  on conflict do nothing;
$$;

create function app_private.can_manage_plan(p_plan public.plans) returns boolean
language sql stable security definer set search_path = '' as $$
  select app_private.is_crew_member(p_plan.crew_id)
     and (p_plan.created_by is not distinct from (select auth.uid())
          or app_private.has_crew_role(p_plan.crew_id, array['owner', 'admin']::public.crew_role[]));
$$;

create function public.create_plan(
  p_crew_id uuid, p_title text, p_starts_at timestamptz,
  p_activity_id uuid default null, p_address text default null, p_meeting_point text default null,
  p_notes text default null, p_cost_per_person_cents integer default null, p_total_cost_cents integer default null,
  p_ends_at timestamptz default null, p_confirmed boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_title text := app_private.clean_line(p_title, 120);
  v_activity public.activities%rowtype;
  v_plan_id uuid;
begin
  if not app_private.is_crew_member(p_crew_id) then
    perform app_private.forbid();
  end if;
  if p_activity_id is not null then
    select * into v_activity from public.activities a where a.id = p_activity_id and a.is_active;
    if not found then
      perform app_private.fail('unknown_activity');
    end if;
  end if;
  v_title := coalesce(v_title, v_activity.name);
  if v_title is null or char_length(v_title) < 2 then
    perform app_private.fail('invalid_title');
  end if;
  if p_starts_at is null or p_starts_at <= now() then
    perform app_private.fail('starts_in_past');
  end if;
  if p_starts_at > now() + interval '2 years' then
    perform app_private.fail('starts_too_late');
  end if;
  if p_ends_at is not null and p_ends_at <= p_starts_at then
    perform app_private.fail('ends_before_start');
  end if;
  perform app_private.rate_limit('create_plan', 20, interval '1 hour');

  insert into public.plans (crew_id, created_by, activity_id, title, starts_at, ends_at, address, meeting_point, notes,
                            estimated_cost_per_person_cents, estimated_total_cost_cents, status)
  values (p_crew_id, v_uid, v_activity.id, v_title, p_starts_at, p_ends_at,
          coalesce(app_private.clean_line(p_address, 200), v_activity.address),
          app_private.clean_line(p_meeting_point, 160), app_private.clean_text(p_notes, 2000),
          p_cost_per_person_cents, p_total_cost_cents,
          case when p_confirmed then 'confirmed'::public.plan_status else 'proposed'::public.plan_status end)
  returning id into v_plan_id;

  perform app_private.add_plan_participants(v_plan_id, p_crew_id, v_uid);
  perform app_private.notify_crew(p_crew_id, 'plan_created', v_uid, 'plan', v_plan_id,
                                  jsonb_build_object('title', v_title, 'starts_at', p_starts_at), 'plan_created:' || v_plan_id::text);
  return v_plan_id;
end $$;

-- Aus dem Ergebnis einer beendeten Abstimmung wird ein bestätigter Plan. Pro Abstimmung genau einer.
-- Ohne p_starts_at gilt Datum/Uhrzeit der gewählten Option in Europe/Berlin (Uhrzeit ersatzweise 19:00).
create function public.create_plan_from_poll(
  p_poll_id uuid, p_option_id uuid, p_starts_at timestamptz default null, p_title text default null,
  p_address text default null, p_meeting_point text default null, p_notes text default null,
  p_cost_per_person_cents integer default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_poll public.polls%rowtype;
  v_option public.poll_options%rowtype;
  v_activity public.activities%rowtype;
  v_starts_at timestamptz;
  v_title text;
  v_plan_id uuid;
begin
  select * into v_poll from public.polls p where p.id = p_poll_id for update;
  if not found or not app_private.is_crew_member(v_poll.crew_id) then
    perform app_private.forbid();
  end if;
  if not (v_poll.created_by is not distinct from v_uid
          or app_private.has_crew_role(v_poll.crew_id, array['owner', 'admin']::public.crew_role[])) then
    perform app_private.forbid();
  end if;
  if v_poll.status <> 'closed' then
    perform app_private.fail('poll_still_open');
  end if;
  select * into v_option from public.poll_options o where o.id = p_option_id and o.poll_id = p_poll_id;
  if not found then
    perform app_private.fail('invalid_option');
  end if;
  if exists (select 1 from public.plans pl where pl.poll_id = p_poll_id) then
    perform app_private.fail('plan_exists');
  end if;

  v_starts_at := coalesce(
    p_starts_at,
    (v_option.proposed_date + coalesce(v_option.proposed_time, time '19:00')) at time zone 'Europe/Berlin'
  );
  if v_starts_at is null then
    perform app_private.fail('missing_start');
  end if;
  if v_starts_at <= now() then
    perform app_private.fail('starts_in_past');
  end if;

  select * into v_activity from public.activities a where a.id = v_option.activity_id;
  v_title := coalesce(app_private.clean_line(p_title, 120), v_option.title);

  insert into public.plans (crew_id, created_by, poll_id, activity_id, title, starts_at, address, meeting_point, notes,
                            estimated_cost_per_person_cents, status)
  values (v_poll.crew_id, v_uid, p_poll_id, v_option.activity_id, v_title, v_starts_at,
          coalesce(app_private.clean_line(p_address, 200), v_activity.address),
          coalesce(app_private.clean_line(p_meeting_point, 160), v_poll.meeting_point),
          app_private.clean_text(p_notes, 2000),
          coalesce(p_cost_per_person_cents, v_option.estimated_price_cents), 'confirmed')
  returning id into v_plan_id;

  perform app_private.add_plan_participants(v_plan_id, v_poll.crew_id, v_uid);
  perform app_private.notify_crew(v_poll.crew_id, 'plan_created', v_uid, 'plan', v_plan_id,
                                  jsonb_build_object('title', v_title, 'starts_at', v_starts_at, 'from_poll', true),
                                  'plan_created:' || v_plan_id::text);
  perform app_private.audit('plan_created_from_poll', 'plan', v_plan_id, v_poll.crew_id, jsonb_build_object('poll_id', p_poll_id));
  return v_plan_id;
end $$;

-- Ersetzt alle bearbeitbaren Felder. Wesentliche Änderungen (Zeit, Ort, Treffpunkt, Kosten)
-- lösen eine Benachrichtigung an die übrigen Teilnehmenden aus (höchstens eine pro 10 Minuten).
create function public.update_plan(
  p_plan_id uuid, p_title text, p_starts_at timestamptz, p_ends_at timestamptz default null,
  p_address text default null, p_meeting_point text default null, p_notes text default null,
  p_cost_per_person_cents integer default null, p_total_cost_cents integer default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
  v_title text := app_private.clean_line(p_title, 120);
  v_address text := app_private.clean_line(p_address, 200);
  v_meeting text := app_private.clean_line(p_meeting_point, 160);
  v_changed text[] := '{}';
  v_participant record;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id for update;
  if not found or not app_private.can_manage_plan(v_plan) then
    perform app_private.forbid();
  end if;
  if v_plan.status in ('completed', 'cancelled') then
    perform app_private.fail('plan_locked');
  end if;
  if v_title is null or char_length(v_title) < 2 then
    perform app_private.fail('invalid_title');
  end if;
  if p_starts_at is null then
    perform app_private.fail('missing_start');
  end if;
  if p_starts_at is distinct from v_plan.starts_at and p_starts_at <= now() then
    perform app_private.fail('starts_in_past');
  end if;
  if p_ends_at is not null and p_ends_at <= p_starts_at then
    perform app_private.fail('ends_before_start');
  end if;

  if p_starts_at is distinct from v_plan.starts_at then v_changed := array_append(v_changed, 'starts_at'); end if;
  if v_address is distinct from v_plan.address then v_changed := array_append(v_changed, 'address'); end if;
  if v_meeting is distinct from v_plan.meeting_point then v_changed := array_append(v_changed, 'meeting_point'); end if;
  if p_cost_per_person_cents is distinct from v_plan.estimated_cost_per_person_cents
     or p_total_cost_cents is distinct from v_plan.estimated_total_cost_cents then
    v_changed := array_append(v_changed, 'cost');
  end if;

  update public.plans p
  set title = v_title, starts_at = p_starts_at, ends_at = p_ends_at, address = v_address, meeting_point = v_meeting,
      notes = app_private.clean_text(p_notes, 2000),
      estimated_cost_per_person_cents = p_cost_per_person_cents, estimated_total_cost_cents = p_total_cost_cents
  where p.id = p_plan_id;

  if cardinality(v_changed) > 0 then
    for v_participant in
      select pp.user_id from public.plan_participants pp where pp.plan_id = p_plan_id and pp.user_id <> v_uid
    loop
      perform app_private.notify(v_participant.user_id, 'plan_changed', v_uid, v_plan.crew_id, 'plan', p_plan_id,
                                 jsonb_build_object('title', v_title, 'changed', to_jsonb(v_changed), 'starts_at', p_starts_at),
                                 'plan_changed:' || p_plan_id::text || ':' || (floor(extract(epoch from now()) / 600))::bigint::text);
    end loop;
  end if;
end $$;

-- Erlaubte Übergänge:
--   proposed -> confirmed | cancelled
--   confirmed | booking_pending | booked -> cancelled | completed (completed erst ab Beginn)
create function public.set_plan_status(p_plan_id uuid, p_status public.plan_status) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
  v_participant record;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id for update;
  if not found or not app_private.can_manage_plan(v_plan) then
    perform app_private.forbid();
  end if;
  if v_plan.status = p_status then
    return;
  end if;

  if p_status = 'confirmed' and v_plan.status = 'proposed' then
    update public.plans p set status = 'confirmed' where p.id = p_plan_id;

  elsif p_status = 'cancelled' and v_plan.status in ('proposed', 'confirmed', 'booking_pending', 'booked') then
    update public.booking_requests b set status = 'cancelled_by_user'
    where b.plan_id = p_plan_id and b.status in ('not_started', 'in_progress', 'awaiting_response');
    update public.plans p
    set status = 'cancelled', cancelled_at = now(),
        booking_status = case when p.booking_status in ('in_progress', 'awaiting_response') then 'cancelled_by_user'::public.booking_status else p.booking_status end
    where p.id = p_plan_id;
    for v_participant in
      select pp.user_id from public.plan_participants pp where pp.plan_id = p_plan_id and pp.user_id <> v_uid
    loop
      perform app_private.notify(v_participant.user_id, 'plan_cancelled', v_uid, v_plan.crew_id, 'plan', p_plan_id,
                                 jsonb_build_object('title', v_plan.title), 'plan_cancelled:' || p_plan_id::text);
    end loop;

  elsif p_status = 'completed' and v_plan.status in ('confirmed', 'booking_pending', 'booked') then
    if v_plan.starts_at > now() then
      perform app_private.fail('plan_not_started');
    end if;
    update public.plans p set status = 'completed', completed_at = now() where p.id = p_plan_id;
    perform app_private.award_plan_rewards(p_plan_id);

  else
    perform app_private.fail('invalid_transition');
  end if;

  perform app_private.audit('plan_status_changed', 'plan', p_plan_id, v_plan.crew_id,
                            jsonb_build_object('from', v_plan.status::text, 'to', p_status::text));
end $$;

-- Eigene Zu- oder Absage.
create function public.set_attendance(p_plan_id uuid, p_status public.attendance_status) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id;
  if not found or not app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.forbid();
  end if;
  if p_status = 'invited' then
    perform app_private.fail('invalid_status');
  end if;
  if v_plan.status in ('completed', 'cancelled') then
    perform app_private.fail('plan_locked');
  end if;

  insert into public.plan_participants (plan_id, user_id, attendance_status, responded_at)
  values (p_plan_id, v_uid, p_status, now())
  on conflict (plan_id, user_id) do update set attendance_status = excluded.attendance_status, responded_at = now();

  if v_plan.created_by is distinct from v_uid then
    perform app_private.notify(v_plan.created_by, 'plan_attendance', v_uid, v_plan.crew_id, 'plan', p_plan_id,
                               jsonb_build_object('title', v_plan.title, 'status', p_status::text),
                               'plan_attendance:' || p_plan_id::text || ':' || v_uid::text || ':' || p_status::text);
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Reservierungen (MVP: manuell dokumentierter Workflow, keine automatische Buchung)
-- ---------------------------------------------------------------------------------------------
-- 1. create_booking_request   -> 'not_started' (Entwurf, nichts wird ausgelöst)
-- 2. confirm_booking_request  -> 'in_progress' (ausdrückliche Freigabe durch den Nutzer)
-- 3. record_booking_outcome   -> 'awaiting_response' | 'confirmed' | 'unavailable' | 'failed'
--    cancel_booking_request   -> 'cancelled_by_user'
-- "confirmed" wird nur gesetzt, wenn die organisierende Person das Ergebnis selbst einträgt.
create function public.create_booking_request(
  p_plan_id uuid, p_requested_date date, p_requested_time time, p_party_size integer, p_special_requests text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
  v_activity public.activities%rowtype;
  v_id uuid;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id for update;
  if not found or not app_private.can_manage_plan(v_plan) then
    perform app_private.forbid();
  end if;
  if v_plan.status not in ('confirmed', 'booking_pending') then
    perform app_private.fail('plan_not_confirmed');
  end if;
  if p_requested_date is null or p_requested_time is null or p_party_size is null or p_party_size not between 1 and 100 then
    perform app_private.fail('invalid_booking');
  end if;
  if exists (select 1 from public.booking_requests b where b.plan_id = p_plan_id and b.status in ('not_started', 'in_progress', 'awaiting_response')) then
    perform app_private.fail('booking_exists');
  end if;
  perform app_private.rate_limit('create_booking', 20, interval '1 hour');

  select * into v_activity from public.activities a where a.id = v_plan.activity_id;
  insert into public.booking_requests (plan_id, activity_id, provider_id, channel, is_test, requested_date, requested_time,
                                       party_size, special_requests, created_by)
  values (p_plan_id, v_activity.id, v_activity.provider_id, 'manual', coalesce(v_activity.is_demo, false),
          p_requested_date, p_requested_time, p_party_size, app_private.clean_text(p_special_requests, 500), v_uid)
  returning id into v_id;
  return v_id;
end $$;

create function app_private.booking_for_update(p_booking_id uuid) returns public.booking_requests
language plpgsql security definer set search_path = '' as $$
declare
  v_booking public.booking_requests;
  v_plan public.plans;
begin
  perform app_private.require_user();
  select * into v_booking from public.booking_requests b where b.id = p_booking_id for update;
  if v_booking.id is null then
    perform app_private.forbid();
  end if;
  select * into v_plan from public.plans p where p.id = v_booking.plan_id for update;
  if not app_private.can_manage_plan(v_plan) then
    perform app_private.forbid();
  end if;
  return v_booking;
end $$;

create function app_private.sync_plan_booking(p_plan_id uuid, p_status public.booking_status, p_notify boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_plan public.plans%rowtype;
  v_participant record;
begin
  update public.plans p
  set booking_status = p_status,
      status = case
        when p.status in ('completed', 'cancelled', 'proposed') then p.status
        when p_status in ('in_progress', 'awaiting_response') then 'booking_pending'::public.plan_status
        when p_status = 'confirmed' then 'booked'::public.plan_status
        else 'confirmed'::public.plan_status
      end
  where p.id = p_plan_id
  returning * into v_plan;

  if p_notify then
    for v_participant in
      select pp.user_id from public.plan_participants pp where pp.plan_id = p_plan_id and pp.user_id is distinct from v_uid
    loop
      perform app_private.notify(v_participant.user_id, 'booking_status', v_uid, v_plan.crew_id, 'plan', p_plan_id,
                                 jsonb_build_object('title', v_plan.title, 'status', p_status::text));
    end loop;
  end if;
end $$;

create function public.confirm_booking_request(p_booking_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_booking public.booking_requests := app_private.booking_for_update(p_booking_id);
begin
  if v_booking.status <> 'not_started' then
    perform app_private.fail('invalid_transition');
  end if;
  update public.booking_requests b set status = 'in_progress', confirmed_by_user_at = now() where b.id = p_booking_id;
  perform app_private.sync_plan_booking(v_booking.plan_id, 'in_progress', false);
  perform app_private.audit('booking_confirmed_by_user', 'plan', v_booking.plan_id, null, jsonb_build_object('booking_id', p_booking_id));
end $$;

create function public.record_booking_outcome(
  p_booking_id uuid, p_status public.booking_status, p_reference text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_booking public.booking_requests := app_private.booking_for_update(p_booking_id);
begin
  if v_booking.status not in ('in_progress', 'awaiting_response') or v_booking.confirmed_by_user_at is null
     or p_status not in ('awaiting_response', 'confirmed', 'unavailable', 'failed') then
    perform app_private.fail('invalid_transition');
  end if;
  update public.booking_requests b
  set status = p_status,
      provider_confirmation_reference = case when p_status = 'confirmed' then app_private.clean_line(p_reference, 120) else b.provider_confirmation_reference end
  where b.id = p_booking_id;
  perform app_private.sync_plan_booking(v_booking.plan_id, p_status, p_status <> 'awaiting_response');
  perform app_private.audit('booking_outcome_recorded', 'plan', v_booking.plan_id, null,
                            jsonb_build_object('booking_id', p_booking_id, 'status', p_status::text));
end $$;

create function public.cancel_booking_request(p_booking_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_booking public.booking_requests := app_private.booking_for_update(p_booking_id);
begin
  if v_booking.status not in ('not_started', 'in_progress', 'awaiting_response', 'confirmed') then
    perform app_private.fail('invalid_transition');
  end if;
  update public.booking_requests b set status = 'cancelled_by_user' where b.id = p_booking_id;
  perform app_private.sync_plan_booking(v_booking.plan_id, 'cancelled_by_user', v_booking.status = 'confirmed');
  perform app_private.audit('booking_cancelled', 'plan', v_booking.plan_id, null, jsonb_build_object('booking_id', p_booking_id));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Fahrgemeinschaften: Angebot -> Anfrage -> Bestätigung durch die fahrende Person
-- ---------------------------------------------------------------------------------------------
create function public.create_ride_offer(
  p_plan_id uuid, p_departure_area text, p_departure_time timestamptz, p_available_seats integer,
  p_destination text default null, p_return_trip boolean default false, p_note text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
  v_area text := app_private.clean_line(p_departure_area, 120);
  v_id uuid;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id;
  if not found or not app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.forbid();
  end if;
  if v_plan.status in ('completed', 'cancelled') then
    perform app_private.fail('plan_locked');
  end if;
  if v_area is null or char_length(v_area) < 2 or p_departure_time is null or p_available_seats is null
     or p_available_seats not between 1 and 8 then
    perform app_private.fail('invalid_ride');
  end if;
  perform app_private.rate_limit('create_ride_offer', 20, interval '1 hour');

  insert into public.ride_offers (plan_id, driver_user_id, departure_area, departure_time, available_seats, destination, return_trip, note)
  values (p_plan_id, v_uid, v_area, p_departure_time, p_available_seats, app_private.clean_line(p_destination, 160),
          coalesce(p_return_trip, false), app_private.clean_text(p_note, 300))
  on conflict (plan_id, driver_user_id) do update
    set departure_area = excluded.departure_area, departure_time = excluded.departure_time,
        available_seats = excluded.available_seats, destination = excluded.destination,
        return_trip = excluded.return_trip, note = excluded.note, status = 'open'
  returning id into v_id;
  return v_id;
end $$;

create function public.cancel_ride_offer(p_offer_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_offer public.ride_offers%rowtype;
  v_plan public.plans%rowtype;
  v_request record;
begin
  select * into v_offer from public.ride_offers o where o.id = p_offer_id for update;
  if not found or v_offer.driver_user_id <> v_uid then
    perform app_private.forbid();
  end if;
  select * into v_plan from public.plans p where p.id = v_offer.plan_id;
  update public.ride_offers o set status = 'cancelled' where o.id = p_offer_id;
  for v_request in
    update public.ride_requests r set status = 'declined'
    where r.ride_offer_id = p_offer_id and r.status in ('requested', 'accepted')
    returning r.passenger_user_id
  loop
    perform app_private.notify(v_request.passenger_user_id, 'ride_confirmed', v_uid, v_plan.crew_id, 'plan', v_plan.id,
                               jsonb_build_object('title', v_plan.title, 'accepted', false));
  end loop;
end $$;

create function public.request_ride(p_offer_id uuid, p_seats integer default 1) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_offer public.ride_offers%rowtype;
  v_plan public.plans%rowtype;
  v_id uuid;
begin
  select * into v_offer from public.ride_offers o where o.id = p_offer_id;
  if found then
    select * into v_plan from public.plans p where p.id = v_offer.plan_id;
  end if;
  if v_offer.id is null or not app_private.is_crew_member(v_plan.crew_id) or v_offer.driver_user_id = v_uid then
    perform app_private.forbid();
  end if;
  if v_offer.status <> 'open' or v_plan.status in ('completed', 'cancelled') then
    perform app_private.fail('ride_not_available');
  end if;
  if p_seats is null or p_seats not between 1 and 4 then
    perform app_private.fail('invalid_ride');
  end if;
  perform app_private.rate_limit('request_ride', 30, interval '1 hour');

  insert into public.ride_requests (ride_offer_id, passenger_user_id, seats_requested, status)
  values (p_offer_id, v_uid, p_seats, 'requested')
  on conflict (ride_offer_id, passenger_user_id) do update set seats_requested = excluded.seats_requested, status = 'requested'
  returning id into v_id;

  perform app_private.notify(v_offer.driver_user_id, 'ride_request', v_uid, v_plan.crew_id, 'plan', v_plan.id,
                             jsonb_build_object('title', v_plan.title, 'seats', p_seats));
  return v_id;
end $$;

-- Nur die fahrende Person entscheidet. Zugesagt wird höchstens die Zahl der freien Plätze.
create function public.respond_ride_request(p_request_id uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_request public.ride_requests%rowtype;
  v_offer public.ride_offers%rowtype;
  v_plan public.plans%rowtype;
  v_taken integer;
begin
  select * into v_request from public.ride_requests r where r.id = p_request_id for update;
  if found then
    select * into v_offer from public.ride_offers o where o.id = v_request.ride_offer_id for update;
  end if;
  if v_request.id is null or v_offer.driver_user_id <> v_uid then
    perform app_private.forbid();
  end if;
  if v_request.status <> 'requested' or v_offer.status <> 'open' then
    perform app_private.fail('invalid_transition');
  end if;
  select * into v_plan from public.plans p where p.id = v_offer.plan_id;

  if p_accept then
    select coalesce(sum(r.seats_requested), 0) into v_taken
    from public.ride_requests r where r.ride_offer_id = v_offer.id and r.status = 'accepted';
    if v_taken + v_request.seats_requested > v_offer.available_seats then
      perform app_private.fail('no_seats_left');
    end if;
  end if;

  update public.ride_requests r
  set status = case when p_accept then 'accepted'::public.ride_request_status else 'declined'::public.ride_request_status end
  where r.id = p_request_id;
  perform app_private.notify(v_request.passenger_user_id, 'ride_confirmed', v_uid, v_plan.crew_id, 'plan', v_plan.id,
                             jsonb_build_object('title', v_plan.title, 'accepted', p_accept));
end $$;

create function public.cancel_ride_request(p_request_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
begin
  update public.ride_requests r set status = 'cancelled'
  where r.id = p_request_id and r.passenger_user_id = v_uid and r.status in ('requested', 'accepted');
  if not found then
    perform app_private.forbid();
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Benachrichtigungen, Meldungen
-- ---------------------------------------------------------------------------------------------
create function public.mark_notifications_read(p_ids uuid[] default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_count integer;
begin
  update public.notifications n set read_at = now()
  where n.user_id = v_uid and n.read_at is null and (p_ids is null or n.id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create function public.report_entity(p_entity_type text, p_entity_id uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_reason text := app_private.clean_text(p_reason, 1000);
  v_id uuid;
begin
  if v_reason is null or char_length(v_reason) < 5 or p_entity_id is null
     or p_entity_type not in ('activity', 'crew', 'crew_message', 'profile', 'plan') then
    perform app_private.fail('invalid_report');
  end if;
  perform app_private.rate_limit('report', 10, interval '1 hour');
  insert into public.reports (reporter_id, entity_type, entity_id, reason)
  values (v_uid, p_entity_type, p_entity_id, v_reason) returning id into v_id;
  return v_id;
end $$;

-- Kontingent für den KI-Planungsassistenten: Die Edge Function ruft dies mit dem Token der anfragenden
-- Person auf, bevor sie den (kostenpflichtigen) KI-Dienst anspricht. 20 Anfragen pro Stunde.
create function public.assistant_quota() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_user();
  perform app_private.rate_limit('assistant', 20, interval '1 hour');
end $$;

-- ---------------------------------------------------------------------------------------------
-- Konto: Rolle, Datenexport, Löschung
-- ---------------------------------------------------------------------------------------------
create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select app_private.is_admin();
$$;

create function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.is_admin() then
    perform app_private.forbid();
  end if;
  return jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'crews', (select count(*) from public.crews),
    'polls', (select count(*) from public.polls),
    'plans', (select count(*) from public.plans),
    'activities_total', (select count(*) from public.activities),
    'activities_demo', (select count(*) from public.activities a where a.is_demo),
    'open_reports', (select count(*) from public.reports r where r.status = 'open'),
    'reward_points_total', (select coalesce(sum(t.points_delta), 0) from public.reward_transactions t)
  );
end $$;

-- Auskunft nach Art. 15/20 DSGVO: alle personenbezogenen Daten der aufrufenden Person als JSON.
create function public.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
begin
  return jsonb_build_object(
    'exported_at', now(),
    'account', (select jsonb_build_object('id', u.id, 'email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at)
                from auth.users u where u.id = v_uid),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = v_uid),
    'settings', (select to_jsonb(s) from public.user_settings s where s.user_id = v_uid),
    'crews', coalesce((select jsonb_agg(jsonb_build_object('crew_id', c.id, 'name', c.name, 'role', m.role, 'joined_at', m.joined_at) order by m.joined_at)
                       from public.crew_members m join public.crews c on c.id = m.crew_id where m.user_id = v_uid), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('crew_id', cm.crew_id, 'body', cm.body, 'created_at', cm.created_at) order by cm.created_at)
                          from public.crew_messages cm where cm.user_id = v_uid), '[]'::jsonb),
    'polls_created', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'created_at', p.created_at) order by p.created_at)
                               from public.polls p where p.created_by = v_uid), '[]'::jsonb),
    'votes', coalesce((select jsonb_agg(jsonb_build_object('poll_id', v.poll_id, 'option', o.title, 'response', v.response, 'updated_at', v.updated_at) order by v.updated_at)
                       from public.poll_votes v join public.poll_options o on o.id = v.poll_option_id where v.user_id = v_uid), '[]'::jsonb),
    'plans', coalesce((select jsonb_agg(jsonb_build_object('plan_id', pl.id, 'title', pl.title, 'starts_at', pl.starts_at, 'attendance_status', pp.attendance_status,
                                                           'organizer', pl.created_by = v_uid) order by pl.starts_at)
                       from public.plan_participants pp join public.plans pl on pl.id = pp.plan_id where pp.user_id = v_uid), '[]'::jsonb),
    'booking_requests', coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at) from public.booking_requests b where b.created_by = v_uid), '[]'::jsonb),
    'ride_offers', coalesce((select jsonb_agg(to_jsonb(o) order by o.created_at) from public.ride_offers o where o.driver_user_id = v_uid), '[]'::jsonb),
    'ride_requests', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at) from public.ride_requests r where r.passenger_user_id = v_uid), '[]'::jsonb),
    'reward_transactions', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from public.reward_transactions t where t.user_id = v_uid), '[]'::jsonb),
    'notifications', coalesce((select jsonb_agg(jsonb_build_object('type', n.type, 'payload', n.payload, 'created_at', n.created_at, 'read_at', n.read_at) order by n.created_at)
                               from public.notifications n where n.user_id = v_uid), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at) from public.reports r where r.reporter_id = v_uid), '[]'::jsonb)
  );
end $$;

-- Löscht das Konto serverseitig und unwiderruflich. Profil, Einstellungen, Mitgliedschaften,
-- Stimmen, Teilnahmen, Punkte und Benachrichtigungen entfallen per ON DELETE CASCADE; selbst
-- erstellte Crews, Abstimmungen und Pläne bleiben den übrigen Mitgliedern ohne Personenbezug erhalten.
-- Die Bestätigungsphrase verhindert versehentliche Aufrufe.
create function public.delete_my_account(p_confirmation text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
begin
  if p_confirmation is distinct from 'DELETE' then
    perform app_private.fail('confirmation_required');
  end if;
  insert into public.audit_log (actor_id, action, entity_type, entity_id)
  values (null, 'account_deleted', 'user', null);
  delete from auth.users u where u.id = v_uid;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Ausführungsrechte
-- ---------------------------------------------------------------------------------------------
-- API-Funktionen: nur angemeldete Nutzer. Interne Funktionen: keine API-Rolle.
do $$
declare
  v_fn record;
begin
  for v_fn in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'create_crew', 'leave_crew', 'remove_crew_member', 'set_crew_member_role', 'send_crew_message',
      'create_crew_invitation', 'revoke_crew_invitation', 'preview_crew_invitation', 'accept_crew_invitation',
      'create_poll', 'cast_vote', 'retract_vote', 'close_poll', 'finalize_due_poll', 'start_runoff_poll', 'remind_poll',
      'create_plan', 'create_plan_from_poll', 'update_plan', 'set_plan_status', 'set_attendance',
      'create_booking_request', 'confirm_booking_request', 'record_booking_outcome', 'cancel_booking_request',
      'create_ride_offer', 'cancel_ride_offer', 'request_ride', 'respond_ride_request', 'cancel_ride_request',
      'mark_notifications_read', 'report_entity', 'assistant_quota', 'is_admin', 'admin_overview', 'export_my_data',
      'delete_my_account')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn.signature);
    execute format('grant execute on function %s to authenticated, service_role', v_fn.signature);
  end loop;

  for v_fn in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname not in ('is_crew_member', 'has_crew_role', 'shares_crew_with', 'can_access_poll',
                            'can_access_plan', 'can_access_ride_offer', 'is_admin')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn.signature);
  end loop;
end $$;
grant execute on function app_private.finalize_due_polls() to service_role;

-- Optional (Supabase: Extension pg_cron aktivieren): Abstimmungen minütlich automatisch schließen.
--   select cron.schedule('afterhours-finalize-polls', '* * * * *', $cron$ select app_private.finalize_due_polls() $cron$);
-- Ohne Cron schließt die App fällige Abstimmungen beim nächsten Aufruf durch ein Mitglied (finalize_due_poll).
