-- P42 · „Vertippt?“ – nachgereichten Vorschlag zurückziehen.
-- Seit P40 reicht jedes Mitglied in einer laufenden Abstimmung Termine und Orte nach. Wer sich dabei vertippt
-- (falscher Tag, falscher Ort), konnte den Vorschlag bisher nicht mehr loswerden – er stand bis zum Ende mit zur Wahl.
--
-- Regeln:
--   * zurückziehen lässt sich nur, was nachgereicht wurde (`poll_options.added_by`), nicht die Vorschläge vom Start
--     der Abstimmung (`poll_option_fixed`) – so bleiben immer mindestens die ursprünglichen Vorschläge stehen
--   * dürfen: wer ihn nachgereicht hat, wer die Abstimmung gestartet hat, Owner und Admins der Crew (sonst `forbidden`;
--     Außenstehende und unbekannte Vorschläge sehen gleich aus)
--   * nur solange die Abstimmung läuft (`poll_closed`)
--   * nur solange niemand sonst dazu geantwortet hat – weder aus der Crew noch als Gast (`poll_option_has_votes`).
--     Die eigene Antwort dessen, der ihn nachgereicht hat, verschwindet mit
--   * der Hinweis „X hat … vorgeschlagen“ an die Crew wird mit zurückgenommen
--   * Position bleibt verbraucht (`polls.withdrawn_position`): Der Stimmzettel für Gäste (W3) spricht Vorschläge über
--     ihre Position an – ein später nachgereichter Vorschlag bekommt nie die Position eines zurückgezogenen, damit
--     eine Gast-Stimme von einer veralteten Seite nicht auf dem falschen Vorschlag landet
--   * „Entscheidet sich selbst“ (S5): Hielt nur der zurückgezogene Vorschlag die Entscheidung auf, entscheidet sich
--     die Abstimmung jetzt – wie nach einer Stimme
--   * höchstens 20 je Person und Stunde
--
-- `add_poll_slot` und `add_poll_place` merken sich ab jetzt, wer nachgereicht hat. Für Vorschläge, die vor dieser
-- Migration nachgereicht wurden, kommt die Person aus dem Hinweis an die Crew (gab es keinen, bleibt es leer – dann
-- lässt sich der Vorschlag nicht zurückziehen).

alter table public.poll_options add column added_by uuid references public.profiles (id) on delete set null;
comment on column public.poll_options.added_by is
  'P42: wer den Vorschlag in der laufenden Abstimmung nachgereicht hat (P40); null bei Vorschlägen vom Start.';

alter table public.polls add column withdrawn_position smallint;
comment on column public.polls.withdrawn_position is
  'P42: höchste Position eines zurückgezogenen Vorschlags – neue Vorschläge kommen dahinter (Stimmzettel für Gäste).';

update public.poll_options o
set added_by = n.actor_id
from public.notifications n
where n.dedupe_key in ('poll_slot_added:' || o.id::text, 'poll_place_added:' || o.id::text)
  and n.actor_id is not null
  and o.added_by is null;

create or replace function public.add_poll_slot(p_poll_id uuid, p_date date, p_time time default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_poll public.polls%rowtype;
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_time time := date_trunc('minute', p_time::interval)::time;
  v_activity_id uuid;
  v_option_id uuid;
  v_member record;
begin
  select * into v_poll from public.polls p where p.id = p_poll_id for update;
  if not found or not app_private.is_crew_member(v_poll.crew_id) then
    perform app_private.forbid();
  end if;
  if v_poll.status <> 'open' or v_poll.ends_at <= now() then
    perform app_private.fail('poll_closed');
  end if;
  if v_poll.kind <> 'date' then
    perform app_private.fail('poll_slot_unsupported');
  end if;
  if v_poll.parent_poll_id is not null then
    perform app_private.fail('poll_slot_runoff');
  end if;
  if p_date is null or p_date > v_today + 365 then
    perform app_private.fail('poll_slot_invalid');
  end if;
  if p_date < v_today or (v_time is not null and (p_date + v_time) at time zone 'Europe/Berlin' <= now()) then
    perform app_private.fail('poll_slot_past');
  end if;
  if exists (select 1 from public.poll_options o
             where o.poll_id = v_poll.id and o.proposed_date = p_date and o.proposed_time is not distinct from v_time) then
    perform app_private.fail('poll_slot_duplicate');
  end if;
  if (select count(*) from public.poll_options o where o.poll_id = v_poll.id) >= 10 then
    perform app_private.fail('poll_slot_full');
  end if;
  perform app_private.rate_limit('poll_slot_add', 10, interval '1 hour');

  -- Fester Ort: alle bisherigen Termine tragen denselben (und keiner keinen).
  select min(o.activity_id::text)::uuid into v_activity_id from public.poll_options o
  where o.poll_id = v_poll.id
  having count(distinct o.activity_id) = 1 and count(*) = count(o.activity_id);
  if v_activity_id is not null
     and not exists (select 1 from public.activities a where a.id = v_activity_id and a.is_active) then
    v_activity_id := null;
  end if;

  insert into public.poll_options (poll_id, activity_id, title, proposed_date, proposed_time, position, added_by)
  values (v_poll.id, v_activity_id, app_private.german_date_label(p_date), p_date, v_time,
          greatest(coalesce((select max(o.position) + 1 from public.poll_options o where o.poll_id = v_poll.id), 0),
                   coalesce(v_poll.withdrawn_position + 1, 0))::smallint, v_uid)
  returning id into v_option_id;

  insert into public.poll_votes (poll_id, poll_option_id, user_id, response)
  values (v_poll.id, v_option_id, v_uid, 'yes');

  for v_member in
    select m.user_id from public.crew_members m
    where m.crew_id = v_poll.crew_id and m.user_id <> v_uid
      and exists (select 1 from public.poll_votes v where v.poll_id = v_poll.id and v.user_id = m.user_id)
  loop
    perform app_private.notify(v_member.user_id, 'poll_reminder', v_uid, v_poll.crew_id, 'poll', v_poll.id,
                               jsonb_build_object('title', v_poll.title, 'added', true,
                                                  'date', p_date, 'time', to_char(v_time, 'HH24:MI')),
                               'poll_slot_added:' || v_option_id::text);
  end loop;
  return v_option_id;
end $$;

create or replace function public.add_poll_place(p_poll_id uuid, p_activity_id uuid default null, p_title text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_poll public.polls%rowtype;
  v_activity public.activities%rowtype;
  v_title text;
  v_date date;
  v_time time;
  v_option_id uuid;
  v_member record;
begin
  select * into v_poll from public.polls p where p.id = p_poll_id for update;
  if not found or not app_private.is_crew_member(v_poll.crew_id) then
    perform app_private.forbid();
  end if;
  if v_poll.status <> 'open' or v_poll.ends_at <= now() then
    perform app_private.fail('poll_closed');
  end if;
  if v_poll.kind <> 'place' then
    perform app_private.fail('poll_place_unsupported');
  end if;
  if v_poll.parent_poll_id is not null then
    perform app_private.fail('poll_place_runoff');
  end if;

  if p_activity_id is not null then
    select * into v_activity from public.activities a where a.id = p_activity_id and a.is_active;
    if not found then
      perform app_private.fail('unknown_activity');
    end if;
  end if;
  v_title := coalesce(app_private.clean_line(p_title, 120), v_activity.name);
  if v_title is null then
    perform app_private.fail('poll_place_invalid');
  end if;

  if exists (select 1 from public.poll_options o
             where o.poll_id = v_poll.id
               and ((v_activity.id is not null and o.activity_id = v_activity.id)
                    or lower(o.title) = lower(v_title))) then
    perform app_private.fail('poll_place_duplicate');
  end if;
  if (select count(*) from public.poll_options o where o.poll_id = v_poll.id) >= 10 then
    perform app_private.fail('poll_place_full');
  end if;
  perform app_private.rate_limit('poll_place_add', 10, interval '1 hour');

  -- Gemeinsamer Termin: alle bisherigen Vorschläge haben denselben Tag und dieselbe (oder keine) Uhrzeit.
  select min(o.proposed_date), min(o.proposed_time) into v_date, v_time
  from public.poll_options o
  where o.poll_id = v_poll.id
  having count(*) = count(o.proposed_date) and count(distinct o.proposed_date) = 1
     and (count(o.proposed_time) = 0 or (count(o.proposed_time) = count(*) and count(distinct o.proposed_time) = 1));

  insert into public.poll_options (poll_id, activity_id, title, proposed_date, proposed_time, position, added_by)
  values (v_poll.id, v_activity.id, v_title, v_date, v_time,
          greatest(coalesce((select max(o.position) + 1 from public.poll_options o where o.poll_id = v_poll.id), 1),
                   coalesce(v_poll.withdrawn_position + 1, 1))::smallint, v_uid)
  returning id into v_option_id;

  insert into public.poll_votes (poll_id, poll_option_id, user_id, response)
  values (v_poll.id, v_option_id, v_uid, 'yes');

  for v_member in
    select m.user_id from public.crew_members m
    where m.crew_id = v_poll.crew_id and m.user_id <> v_uid
      and exists (select 1 from public.poll_votes v where v.poll_id = v_poll.id and v.user_id = m.user_id)
  loop
    perform app_private.notify(v_member.user_id, 'poll_reminder', v_uid, v_poll.crew_id, 'poll', v_poll.id,
                               jsonb_build_object('title', v_poll.title, 'added', true, 'place', v_title),
                               'poll_place_added:' || v_option_id::text);
  end loop;
  return v_option_id;
end $$;

create function public.remove_poll_option(p_option_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_option public.poll_options%rowtype;
  v_poll public.polls%rowtype;
begin
  select * into v_option from public.poll_options o where o.id = p_option_id;
  if found then
    select * into v_poll from public.polls p where p.id = v_option.poll_id for update;
  end if;
  if v_option.id is null or not app_private.is_crew_member(v_poll.crew_id) then
    perform app_private.forbid();
  end if;
  if v_poll.status <> 'open' or v_poll.ends_at <= now() then
    perform app_private.fail('poll_closed');
  end if;
  if v_option.added_by is null then
    perform app_private.fail('poll_option_fixed');
  end if;
  if not (v_option.added_by = v_uid
          or v_poll.created_by is not distinct from v_uid
          or app_private.has_crew_role(v_poll.crew_id, array['owner', 'admin']::public.crew_role[])) then
    perform app_private.forbid();
  end if;
  if exists (select 1 from public.poll_votes v where v.poll_option_id = v_option.id and v.user_id <> v_option.added_by)
     or exists (select 1 from public.poll_guest_votes g where g.poll_option_id = v_option.id) then
    perform app_private.fail('poll_option_has_votes');
  end if;
  perform app_private.rate_limit('poll_option_withdraw', 20, interval '1 hour');

  delete from public.notifications n
  where n.dedupe_key in ('poll_slot_added:' || v_option.id::text, 'poll_place_added:' || v_option.id::text);

  update public.polls p
  set withdrawn_position = greatest(coalesce(p.withdrawn_position, v_option.position), v_option.position)
  where p.id = v_poll.id;

  delete from public.poll_options o where o.id = v_option.id;

  if v_poll.auto_decide and app_private.poll_clear_winner(v_poll.id) is not null then
    perform app_private.close_poll_internal(v_poll.id, null);
  end if;
end $$;

revoke all on function public.remove_poll_option(uuid) from public, anon, authenticated;
grant execute on function public.remove_poll_option(uuid) to authenticated, service_role;

comment on function public.remove_poll_option(uuid) is
  'P42: nachgereichten Vorschlag zurückziehen (wer ihn nachgereicht hat, wer die Abstimmung gestartet hat, Owner/Admin), solange niemand sonst dazu geantwortet hat.';
