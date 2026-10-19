-- =============================================================================================
-- AFTERHOURS – Abstimmung entscheidet sich selbst (Roadmap S5, Etappe 1)
--
-- Bisher musste nach jeder Abstimmung jemand „Beenden“ und „Plan erstellen“ tippen. Jetzt kann eine
-- Orts-Abstimmung sich selbst entscheiden (polls.auto_decide, Standard aus; die Ein-Satz-Abstimmung S1
-- schaltet es beim Start ein):
--   - Klare Mehrheit: Mehr als die Hälfte der Crew ist bei einem Vorschlag dabei, und kein anderer
--     Vorschlag kann ihn noch einholen – selbst wenn alle, die dort noch nicht geantwortet haben, „dabei“
--     sagen. Gäste zählen bei den Stimmen mit, die Mehrheit bezieht sich auf die Crew. Dann wird die
--     Abstimmung sofort beendet (wie bei Fristablauf, closed_by = null).
--   - Frist: Endet die Abstimmung von selbst (finalize_due_poll, pg_cron), gilt der Gewinner wie bisher.
--   - Gleichstand: kein Plan, die Stichwahl startet wie bisher von Hand; sie erbt den Schalter.
--   - Ergebnis: Aus dem Gewinner wird automatisch ein bestätigter Plan (Termin aus dem Vorschlag, sonst
--     kein Plan), alle bekommen Bescheid. Wer beim Gewinner „dabei“ gesagt hat, ist zugesagt; alle
--     anderen sind eingeladen. plans.poll_id ist eindeutig – es gibt nie zwei Pläne je Abstimmung.
--   - Beendet jemand die Abstimmung von Hand, bleibt alles wie bisher (Plan per „Plan erstellen“).
-- Termin-Abstimmungen („Wann könnt ihr?“) entscheiden sich nicht selbst: dort folgt „Und wo?“.
-- =============================================================================================

alter table public.polls add column auto_decide boolean not null default false;

-- Stichwahlen erben den Schalter der ursprünglichen Abstimmung.
create function app_private.inherit_poll_auto_decide() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.parent_poll_id is not null then
    select p.auto_decide into new.auto_decide from public.polls p where p.id = new.parent_poll_id;
    new.auto_decide := coalesce(new.auto_decide, false);
  end if;
  if new.kind <> 'place' then
    new.auto_decide := false;
  end if;
  return new;
end $$;
-- Name sortiert nach polls_inherit_kind, damit kind beim Prüfen schon feststeht.
create trigger polls_inherit_tally before insert on public.polls
  for each row execute function app_private.inherit_poll_auto_decide();

-- ---------------------------------------------------------------------------------------------
-- Klare Mehrheit prüfen (nach jeder Stimme)
-- ---------------------------------------------------------------------------------------------
create function app_private.poll_clear_winner(p_poll_id uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_crew uuid;
  v_min integer;
  v_members bigint;
  v_leader uuid;
  v_leader_member_yes bigint;
  v_leader_total bigint;
  v_rival_best bigint;
begin
  select p.crew_id, p.min_participants into v_crew, v_min from public.polls p where p.id = p_poll_id;
  select count(*) into v_members from public.crew_members m where m.crew_id = v_crew;
  if v_members = 0 then
    return null;
  end if;

  with tally as (
    select o.id as option_id,
           count(v.id) filter (where v.response = 'yes') as member_yes,
           count(v.id) as member_answers,
           max(c.yes_count) as total_yes
    from public.poll_options o
    join app_private.poll_yes_counts(p_poll_id) c on c.option_id = o.id
    left join public.poll_votes v
      on v.poll_option_id = o.id
     and exists (select 1 from public.crew_members m where m.crew_id = v_crew and m.user_id = v.user_id)
    where o.poll_id = p_poll_id
    group by o.id
  ), leader as (
    select t.* from tally t order by t.total_yes desc, t.option_id limit 1
  )
  select l.option_id, l.member_yes, l.total_yes,
         -- Bestes, was ein anderer Vorschlag noch erreichen kann: seine Stimmen plus alle aus der Crew,
         -- die dort noch nicht geantwortet haben.
         (select max(t.total_yes + (v_members - t.member_answers)) from tally t where t.option_id <> l.option_id)
  into v_leader, v_leader_member_yes, v_leader_total, v_rival_best
  from leader l;

  if v_leader is null or v_leader_member_yes * 2 <= v_members or v_leader_total < coalesce(v_min, 1) then
    return null;
  end if;
  if v_rival_best is not null and v_rival_best >= v_leader_total then
    return null;
  end if;
  return v_leader;
end $$;

create function app_private.on_poll_vote_auto_decide() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_poll public.polls%rowtype;
begin
  select * into v_poll from public.polls p where p.id = new.poll_id;
  if v_poll.auto_decide and v_poll.status = 'open' and v_poll.ends_at > now()
     and app_private.poll_clear_winner(new.poll_id) is not null then
    perform app_private.close_poll_internal(new.poll_id, null);
  end if;
  return null;
end $$;

create trigger poll_votes_auto_decide after insert or update of response on public.poll_votes
  for each row execute function app_private.on_poll_vote_auto_decide();
create trigger poll_guest_votes_auto_decide after insert or update of response on public.poll_guest_votes
  for each row execute function app_private.on_poll_vote_auto_decide();

-- ---------------------------------------------------------------------------------------------
-- Plan aus dem Ergebnis (nach automatischem Ende)
-- ---------------------------------------------------------------------------------------------
create function app_private.on_poll_closed_auto_plan() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_option public.poll_options%rowtype;
  v_activity public.activities%rowtype;
  v_starts_at timestamptz;
  v_plan_id uuid;
begin
  if not (new.auto_decide and old.status = 'open' and new.status = 'closed'
          and new.closed_by is null and new.winning_option_id is not null) then
    return null;
  end if;
  select * into v_option from public.poll_options o where o.id = new.winning_option_id;
  if v_option.proposed_date is null then
    return null; -- ohne Termin kein Plan; „Plan erstellen“ fragt dann nach dem Tag
  end if;
  v_starts_at := (v_option.proposed_date + coalesce(v_option.proposed_time, time '19:00')) at time zone 'Europe/Berlin';
  if v_starts_at <= now() then
    return null;
  end if;
  select * into v_activity from public.activities a where a.id = v_option.activity_id;

  -- Ein Fehler hier darf die Stimme bzw. das Ende der Abstimmung nie verhindern: dann bleibt es beim
  -- Ergebnis, und „Plan erstellen“ funktioniert wie bisher.
  begin
    insert into public.plans (crew_id, created_by, poll_id, activity_id, title, starts_at, address, meeting_point,
                              estimated_cost_per_person_cents, status)
    values (new.crew_id, new.created_by, new.id, v_option.activity_id, v_option.title, v_starts_at,
            v_activity.address, new.meeting_point, v_option.estimated_price_cents, 'confirmed')
    on conflict (poll_id) do nothing
    returning id into v_plan_id;

    if v_plan_id is not null then
      -- Wer beim Gewinner „dabei“ gesagt hat, ist zugesagt; alle anderen aus der Crew sind eingeladen.
      insert into public.plan_participants (plan_id, user_id, attendance_status, responded_at)
      select v_plan_id, m.user_id,
             case when v.id is not null then 'going'::public.attendance_status else 'invited'::public.attendance_status end,
             case when v.id is not null then now() end
      from public.crew_members m
      left join public.poll_votes v on v.poll_option_id = v_option.id and v.user_id = m.user_id and v.response = 'yes'
      where m.crew_id = new.crew_id
      on conflict do nothing;

      perform app_private.notify_crew(new.crew_id, 'plan_created', null, 'plan', v_plan_id,
                                      jsonb_build_object('title', v_option.title, 'starts_at', v_starts_at,
                                                         'from_poll', true, 'auto', true),
                                      'plan_created:' || v_plan_id::text);
      insert into public.audit_log (actor_id, action, entity_type, entity_id, crew_id, meta)
      values (null, 'plan_created_from_poll', 'plan', v_plan_id, new.crew_id,
              jsonb_build_object('poll_id', new.id, 'automatic', true));
    end if;
  exception when others then
    raise warning 'auto plan for poll % failed: %', new.id, sqlerrm;
  end;
  return null;
end $$;

create trigger polls_auto_plan after update of status on public.polls
  for each row execute function app_private.on_poll_closed_auto_plan();

-- ---------------------------------------------------------------------------------------------
-- Schalter je Abstimmung: Ersteller:in oder Owner/Admin, nur solange sie läuft, nur Orts-Abstimmungen.
-- Beim Einschalten wird sofort geprüft – steht die Mehrheit schon, ist die Abstimmung gleich entschieden.
-- ---------------------------------------------------------------------------------------------
create function public.set_poll_auto_decide(p_poll_id uuid, p_enabled boolean) returns boolean
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
  if p_enabled is null then
    perform app_private.fail('invalid_input');
  end if;
  if v_poll.status <> 'open' or v_poll.ends_at <= now() then
    perform app_private.fail('poll_closed');
  end if;
  if v_poll.kind <> 'place' and p_enabled then
    perform app_private.fail('auto_decide_unsupported');
  end if;
  perform app_private.rate_limit('set_poll_auto_decide', 30, interval '10 minutes');

  update public.polls p set auto_decide = p_enabled where p.id = p_poll_id;
  if p_enabled and app_private.poll_clear_winner(p_poll_id) is not null then
    perform app_private.close_poll_internal(p_poll_id, null);
    return true;
  end if;
  return false;
end $$;

revoke all on function app_private.inherit_poll_auto_decide(), app_private.poll_clear_winner(uuid),
  app_private.on_poll_vote_auto_decide(), app_private.on_poll_closed_auto_plan() from public, anon, authenticated;
revoke all on function public.set_poll_auto_decide(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_poll_auto_decide(uuid, boolean) to authenticated, service_role;
