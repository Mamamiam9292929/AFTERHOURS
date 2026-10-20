-- =============================================================================================
-- AFTERHOURS – Stichwahl startet von selbst (Roadmap S5, Etappe 2)
--
-- Endet eine Abstimmung, die sich selbst entscheidet (polls.auto_decide), mit Fristablauf unentschieden,
-- musste bisher jemand „Stichwahl starten“ tippen. Jetzt startet die Stichwahl sofort von selbst:
--   - nur bei automatischem Ende (closed_by = null) mit Gleichstand (is_tie) und nur bei der ersten
--     Abstimmung – endet eine Stichwahl wieder unentschieden, entscheidet die Crew von Hand (keine Kette);
--   - Vorschläge = die gleichauf liegenden, wie bei start_runoff_poll; Titel „Stichwahl: …“, gestartet
--     im Namen der Person, die die Abstimmung gestartet hat; Gäste-Schalter und „Entscheidet sich selbst“
--     werden übernommen (Trigger polls_inherit_*);
--   - Frist 24 Stunden, aber spätestens 30 Minuten vor dem frühesten Termin der Vorschläge (ohne Uhrzeit
--     12:00). Bleiben dafür keine 30 Minuten, startet nichts – dann wie bisher von Hand;
--   - die Crew bekommt „Stichwahl gestartet“; höchstens eine Stichwahl je Abstimmung (wie bisher).
-- Ein Fehler hier verhindert nie das Ende der Abstimmung (Warnung im Log, Knopf bleibt).
-- =============================================================================================

create function app_private.on_poll_closed_auto_runoff() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_first timestamptz;
  v_ends timestamptz;
  v_title text;
  v_new_id uuid;
begin
  if not (new.auto_decide and old.status = 'open' and new.status = 'closed'
          and new.closed_by is null and new.is_tie and new.parent_poll_id is null) then
    return null;
  end if;

  begin
    if exists (select 1 from public.polls c where c.parent_poll_id = new.id) then
      return null;
    end if;

    -- Frühester anstehender Termin unter den gleichauf liegenden Vorschlägen (Berliner Zeit).
    with counts as (
      select c.option_id as id, c.yes_count from app_private.poll_yes_counts(new.id) c
    )
    select min((o.proposed_date + coalesce(o.proposed_time, time '12:00')) at time zone 'Europe/Berlin')
    into v_first
    from public.poll_options o join counts c on c.id = o.id
    where c.yes_count = (select max(yes_count) from counts)
      and o.proposed_date is not null
      and (o.proposed_date + coalesce(o.proposed_time, time '12:00')) at time zone 'Europe/Berlin' > now();

    v_ends := now() + interval '24 hours';
    if v_first is not null then
      v_ends := least(v_ends, v_first - interval '30 minutes');
    end if;
    if v_ends < now() + interval '30 minutes' then
      return null;
    end if;
    v_ends := date_trunc('minute', v_ends);

    v_title := left('Stichwahl: ' || new.title, 80);

    insert into public.polls (crew_id, created_by, parent_poll_id, title, description, meeting_point, budget_cents,
                              min_participants, ends_at, guests_allowed)
    values (new.crew_id, new.created_by, new.id, v_title, new.description, new.meeting_point, new.budget_cents,
            new.min_participants, v_ends, new.guests_allowed)
    returning id into v_new_id;

    with counts as (
      select c.option_id as id, c.yes_count from app_private.poll_yes_counts(new.id) c
    )
    insert into public.poll_options (poll_id, activity_id, title, proposed_date, proposed_time, estimated_price_cents, position)
    select v_new_id, o.activity_id, o.title, o.proposed_date, o.proposed_time, o.estimated_price_cents, o.position
    from public.poll_options o join counts c on c.id = o.id
    where c.yes_count = (select max(yes_count) from counts)
    order by o.position;

    perform app_private.notify_crew(new.crew_id, 'poll_created', null, 'poll', v_new_id,
                                    jsonb_build_object('title', v_title, 'runoff', true, 'auto', true),
                                    'poll_created:' || v_new_id::text);
    insert into public.audit_log (actor_id, action, entity_type, entity_id, crew_id, meta)
    values (null, 'poll_runoff_started', 'poll', v_new_id, new.crew_id,
            jsonb_build_object('parent_poll_id', new.id, 'automatic', true));
  exception when others then
    raise warning 'auto runoff for poll % failed: %', new.id, sqlerrm;
  end;
  return null;
end $$;

create trigger polls_auto_runoff after update of status on public.polls
  for each row execute function app_private.on_poll_closed_auto_runoff();

revoke all on function app_private.on_poll_closed_auto_runoff() from public, anon, authenticated;
