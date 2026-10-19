-- P8 Etappe 2 · Stammtisch: „Diesmal aussetzen“ und früher Bescheid
--
-- 1. Früher Bescheid: Der nächste Termin einer Serie entsteht nicht mehr erst, wenn der letzte begonnen hat,
--    sondern sobald er höchstens 7 Tage entfernt ist (bei „jede Woche“ ist das derselbe Zeitpunkt; bei
--    „jeden 1. Freitag im Monat“ steht der Termin eine Woche vorher in der App). Es steht weiterhin höchstens
--    ein Termin an – der nächste entsteht nie vor dem Beginn des letzten.
-- 2. Diesmal aussetzen: Wer den Plan verwaltet, setzt einen anstehenden Termin einer laufenden Serie aus.
--    Der Termin wird abgesagt (`skipped_at` gesetzt), die Serie läuft weiter, und der nächste Termin steht
--    sofort da – auch wenn er weiter als 7 Tage entfernt ist. Benachrichtigt werden alle Teilnehmenden.
--    Ist der letzte Termin einer Serie abgesagt (ausgesetzt oder regulär), gilt dasselbe: der nächste kommt sofort.

alter table public.plans add column skipped_at timestamptz;
comment on column public.plans.skipped_at is 'P8: Termin einer Serie wurde „diesmal ausgesetzt“ (status = cancelled, Serie läuft weiter).';

create or replace function app_private.roll_plan_series(p_series_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_series public.plan_series%rowtype;
  v_last public.plans%rowtype;
  v_on date;
  v_time time;
  v_start timestamptz;
  v_plan_id uuid;
  v_creator uuid;
  v_steps integer := 0;
begin
  select * into v_series from public.plan_series s where s.id = p_series_id for update;
  if not found or not v_series.active then
    return 0;
  end if;

  select * into v_last from public.plans p where p.series_id = p_series_id
  order by p.starts_at desc, p.created_at desc limit 1;
  if not found then
    -- Kein Termin mehr (z. B. gelöscht): Serie ruht, statt ins Leere zu laufen.
    update public.plan_series s set active = false, stopped_at = now(), updated_at = now() where s.id = p_series_id;
    return 0;
  end if;

  -- Nächster Kalendertag laut Regel, der nach jetzt und nach dem letzten Termin beginnt.
  -- Verpasste Termine (niemand hat die App geöffnet) werden übersprungen.
  v_time := (v_last.starts_at at time zone 'Europe/Berlin')::time;
  v_on := v_series.last_on;
  loop
    v_on := app_private.plan_series_next_on(v_series.rule, v_series.weekday, v_series.nth, v_on);
    if v_on is null then
      return 0;
    end if;
    v_start := (v_on + v_time) at time zone 'Europe/Berlin';
    exit when v_start > greatest(now(), v_last.starts_at);
    v_steps := v_steps + 1;
    if v_steps > 300 then
      return 0;
    end if;
  end loop;
  if v_start > now() + interval '2 years' then
    return 0;
  end if;
  -- Früher Bescheid: eine Woche vorher. Ist der letzte Termin abgesagt, wartet niemand auf ihn – sofort.
  if v_last.status <> 'cancelled' and v_start > now() + interval '7 days' then
    return 0;
  end if;

  -- Wer die Serie angelegt hat, bleibt Organisator:in – solange sie/er noch in der Crew ist.
  select m.user_id into v_creator from public.crew_members m
  where m.crew_id = v_series.crew_id and m.user_id = v_series.created_by;

  insert into public.plans (crew_id, created_by, series_id, activity_id, title, starts_at, ends_at, address, meeting_point,
                            notes, estimated_cost_per_person_cents, estimated_total_cost_cents, status)
  values (v_series.crew_id, v_creator, v_series.id, v_last.activity_id, v_last.title, v_start,
          case when v_last.ends_at is not null then v_start + (v_last.ends_at - v_last.starts_at) end,
          v_last.address, v_last.meeting_point, v_last.notes,
          v_last.estimated_cost_per_person_cents, v_last.estimated_total_cost_cents, 'proposed')
  returning id into v_plan_id;

  -- Niemand ist automatisch dabei – jede:r antwortet selbst.
  perform app_private.add_plan_participants(v_plan_id, v_series.crew_id, null);
  update public.plan_series s set last_on = v_on, updated_at = now() where s.id = v_series.id;

  perform app_private.notify_crew(v_series.crew_id, 'plan_created', null, 'plan', v_plan_id,
                                  jsonb_build_object('title', v_last.title, 'starts_at', v_start, 'repeat', true),
                                  'plan_created:' || v_plan_id::text);
  perform app_private.audit('plan_series_rolled', 'plan', v_plan_id, v_series.crew_id, jsonb_build_object('series_id', v_series.id));
  return 1;
end $$;

-- Diesmal aussetzen: sagt diesen Termin ab, ohne die Serie zu beenden. Gibt die Serie und den nächsten
-- anstehenden Termin zurück ({ series, next_plan_id, next_starts_at }).
create function public.skip_plan_occurrence(p_plan_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
  v_series public.plan_series%rowtype;
  v_next public.plans%rowtype;
  v_participant record;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id for update;
  if not found or not app_private.can_manage_plan(v_plan) then
    perform app_private.forbid();
  end if;
  if v_plan.series_id is not null then
    select * into v_series from public.plan_series s where s.id = v_plan.series_id for update;
  end if;
  if v_series.id is null or not v_series.active then
    perform app_private.fail('series_not_active');
  end if;
  if v_plan.status not in ('proposed', 'confirmed', 'booking_pending', 'booked') then
    perform app_private.fail('plan_locked');
  end if;
  if v_plan.starts_at <= now() then
    perform app_private.fail('skip_too_late');
  end if;
  perform app_private.rate_limit('plan_series', 30, interval '1 hour');

  update public.booking_requests b set status = 'cancelled_by_user'
  where b.plan_id = p_plan_id and b.status in ('not_started', 'in_progress', 'awaiting_response');
  update public.plans p
  set status = 'cancelled', cancelled_at = now(), skipped_at = now(),
      booking_status = case when p.booking_status in ('in_progress', 'awaiting_response') then 'cancelled_by_user'::public.booking_status else p.booking_status end
  where p.id = p_plan_id;
  perform app_private.audit('plan_occurrence_skipped', 'plan', p_plan_id, v_plan.crew_id, jsonb_build_object('series_id', v_series.id));

  -- War es der letzte Termin, steht der nächste sofort da.
  perform app_private.roll_plan_series(v_series.id);
  select * into v_next from public.plans p
  where p.series_id = v_series.id and p.status <> 'cancelled' and p.starts_at > now()
  order by p.starts_at limit 1;

  for v_participant in
    select pp.user_id from public.plan_participants pp where pp.plan_id = p_plan_id and pp.user_id <> v_uid
  loop
    perform app_private.notify(v_participant.user_id, 'plan_cancelled', v_uid, v_plan.crew_id, 'plan', p_plan_id,
                               jsonb_build_object('title', v_plan.title, 'skipped', true, 'starts_at', v_plan.starts_at,
                                                  'next_starts_at', v_next.starts_at),
                               'plan_cancelled:' || p_plan_id::text);
  end loop;

  select * into v_series from public.plan_series s where s.id = v_series.id;
  return jsonb_build_object('series', app_private.plan_series_json(v_series), 'next_plan_id', v_next.id, 'next_starts_at', v_next.starts_at);
end $$;

revoke all on function app_private.roll_plan_series(uuid) from public, anon, authenticated;
revoke all on function public.skip_plan_occurrence(uuid) from public, anon, authenticated;
grant execute on function public.skip_plan_occurrence(uuid) to authenticated;
