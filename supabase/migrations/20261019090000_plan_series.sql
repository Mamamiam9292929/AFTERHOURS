-- P8 Etappe 1 · Wiederkehrende Pläne („Stammtisch“)
-- Wer einen Plan verwaltet (Ersteller:in, Owner/Admin), stellt ein, dass er sich wiederholt: jede Woche,
-- alle 2 Wochen, jeden n-ten (1.–4.) oder letzten Wochentag im Monat. Ist der letzte Termin der Serie
-- vorbei, legt der Server den nächsten an – mit Titel, Ort, Adresse, Treffpunkt, Notizen, Kosten,
-- Uhrzeit und Dauer des letzten Termins (wer ihn bearbeitet, ändert damit die folgenden), als Vorschlag,
-- alle Mitglieder eingeladen (niemand wird automatisch zugesagt). Verpasste Termine (niemand hat die App
-- geöffnet) werden übersprungen, nie rückwirkend angelegt.
--
-- Angestoßen wird das Anlegen ohne Cron von der App (`roll_plan_series`, sobald eine Liste einen
-- vergangenen letzten Termin einer aktiven Serie sieht) und optional per pg_cron
-- (`app_private.roll_due_plan_series()`, siehe README). Beides ist idempotent: Die Serie wird gesperrt,
-- und es entsteht nur ein Termin, wenn keiner mehr ansteht.

create table public.plan_series (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crews (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  rule text not null check (rule in ('weekly', 'biweekly', 'monthly_nth', 'monthly_last')),
  -- ISO-Wochentag (1 = Montag … 7 = Sonntag) und – nur bei monthly_nth – der wievielte im Monat.
  weekday smallint not null check (weekday between 1 and 7),
  nth smallint check (nth between 1 and 4),
  -- Kalendertag (Berlin) des letzten angelegten Termins laut Regel; daraus folgt der nächste.
  last_on date not null,
  active boolean not null default true,
  stopped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((rule = 'monthly_nth') = (nth is not null))
);
create index plan_series_crew_idx on public.plan_series (crew_id) where active;

alter table public.plans add column series_id uuid references public.plan_series (id) on delete set null;
create index plans_series_idx on public.plans (series_id, starts_at) where series_id is not null;

alter table public.plan_series enable row level security;
revoke all on table public.plan_series from public, anon, authenticated;
grant select on table public.plan_series to authenticated;
create policy plan_series_select_member on public.plan_series for select to authenticated
  using (app_private.is_crew_member(crew_id));

-- Nächster Termin (Kalendertag) nach p_after laut Regel. p_after ist selbst ein Termin der Serie.
create function app_private.plan_series_next_on(p_rule text, p_weekday integer, p_nth integer, p_after date) returns date
language plpgsql immutable set search_path = '' as $$
declare
  v_month date;
  v_candidate date;
  v_last date;
begin
  if p_rule = 'weekly' then
    return p_after + 7;
  elsif p_rule = 'biweekly' then
    return p_after + 14;
  end if;
  for i in 0..1 loop
    v_month := (date_trunc('month', p_after::timestamp) + make_interval(months => i))::date;
    if p_rule = 'monthly_nth' then
      v_candidate := v_month + ((p_weekday - extract(isodow from v_month)::integer + 7) % 7) + (p_nth - 1) * 7;
    elsif p_rule = 'monthly_last' then
      v_last := (v_month + interval '1 month' - interval '1 day')::date;
      v_candidate := v_last - ((extract(isodow from v_last)::integer - p_weekday + 7) % 7);
    else
      return null;
    end if;
    if v_candidate > p_after then
      return v_candidate;
    end if;
  end loop;
  return null;
end $$;

create function app_private.plan_series_json(p_series public.plan_series) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', p_series.id, 'crew_id', p_series.crew_id, 'rule', p_series.rule, 'weekday', p_series.weekday,
    'nth', p_series.nth, 'last_on', p_series.last_on, 'active', p_series.active,
    'next_on', case when p_series.active
                    then app_private.plan_series_next_on(p_series.rule, p_series.weekday, p_series.nth, p_series.last_on) end);
$$;

-- Legt den nächsten Termin einer Serie an, wenn ihr letzter Termin begonnen hat. Gibt 1 (angelegt) oder 0 zurück.
create function app_private.roll_plan_series(p_series_id uuid) returns integer
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
  if v_last.starts_at > now() then
    return 0;
  end if;

  v_time := (v_last.starts_at at time zone 'Europe/Berlin')::time;
  v_on := v_series.last_on;
  loop
    v_on := app_private.plan_series_next_on(v_series.rule, v_series.weekday, v_series.nth, v_on);
    if v_on is null then
      return 0;
    end if;
    v_start := (v_on + v_time) at time zone 'Europe/Berlin';
    exit when v_start > now();
    v_steps := v_steps + 1;
    if v_steps > 300 then
      return 0;
    end if;
  end loop;
  if v_start > now() + interval '2 years' then
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

-- Für pg_cron bzw. service_role: legt bei allen aktiven Serien fällige Termine an.
create function app_private.roll_due_plan_series() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_series record;
  v_count integer := 0;
begin
  for v_series in select s.id from public.plan_series s where s.active order by s.created_at loop
    v_count := v_count + app_private.roll_plan_series(v_series.id);
  end loop;
  return v_count;
end $$;

-- Wiederholung eines Plans einstellen (p_rule: weekly, biweekly, monthly_nth, monthly_last) oder mit
-- null/'none' beenden. Gilt für die ganze Serie; Wochentag und Tag im Monat kommen vom letzten Termin.
create function public.set_plan_repeat(p_plan_id uuid, p_rule text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_rule text := nullif(lower(btrim(coalesce(p_rule, ''))), '');
  v_plan public.plans%rowtype;
  v_latest public.plans%rowtype;
  v_series public.plan_series%rowtype;
  v_day date;
  v_weekday integer;
  v_nth integer;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id for update;
  if not found or not app_private.can_manage_plan(v_plan) then
    perform app_private.forbid();
  end if;
  if v_rule = 'none' then
    v_rule := null;
  end if;
  if v_rule is not null and v_rule not in ('weekly', 'biweekly', 'monthly_nth', 'monthly_last') then
    perform app_private.fail('invalid_repeat_rule');
  end if;
  perform app_private.rate_limit('plan_series', 30, interval '1 hour');

  if v_plan.series_id is not null then
    select * into v_series from public.plan_series s where s.id = v_plan.series_id for update;
  end if;

  -- Beenden: bereits angelegte Termine bleiben, es kommen keine neuen dazu.
  if v_rule is null then
    if v_series.id is null then
      return null;
    end if;
    if v_series.active then
      update public.plan_series s set active = false, stopped_at = now(), updated_at = now()
      where s.id = v_series.id returning * into v_series;
      perform app_private.audit('plan_series_stopped', 'plan', v_plan.id, v_plan.crew_id, jsonb_build_object('series_id', v_series.id));
    end if;
    return app_private.plan_series_json(v_series);
  end if;

  if v_plan.status = 'cancelled' then
    perform app_private.fail('plan_locked');
  end if;

  -- Regel am letzten Termin der Serie ausrichten (ohne Serie: an diesem Plan).
  v_latest := v_plan;
  if v_series.id is not null then
    select * into v_latest from public.plans p where p.series_id = v_series.id order by p.starts_at desc, p.created_at desc limit 1;
  end if;
  v_day := (v_latest.starts_at at time zone 'Europe/Berlin')::date;
  v_weekday := extract(isodow from v_day)::integer;
  v_nth := (extract(day from v_day)::integer + 6) / 7;
  if v_rule = 'monthly_nth' and v_nth > 4 then
    perform app_private.fail('repeat_no_nth');
  end if;
  if v_rule = 'monthly_last' and extract(month from v_day + 7) = extract(month from v_day) then
    perform app_private.fail('repeat_not_last_week');
  end if;

  if v_series.id is null then
    if (select count(*) from public.plan_series s where s.crew_id = v_plan.crew_id and s.active) >= 10 then
      perform app_private.fail('too_many_series');
    end if;
    insert into public.plan_series (crew_id, created_by, rule, weekday, nth, last_on)
    values (v_plan.crew_id, v_uid, v_rule, v_weekday, case when v_rule = 'monthly_nth' then v_nth end, v_day)
    returning * into v_series;
    update public.plans p set series_id = v_series.id where p.id = v_plan.id;
  else
    if not v_series.active
       and (select count(*) from public.plan_series s where s.crew_id = v_plan.crew_id and s.active) >= 10 then
      perform app_private.fail('too_many_series');
    end if;
    update public.plan_series s
    set rule = v_rule, weekday = v_weekday, nth = case when v_rule = 'monthly_nth' then v_nth end, last_on = v_day,
        active = true, stopped_at = null, updated_at = now()
    where s.id = v_series.id returning * into v_series;
  end if;
  perform app_private.audit('plan_series_set', 'plan', v_plan.id, v_plan.crew_id, jsonb_build_object('series_id', v_series.id, 'rule', v_rule));

  -- Liegt der letzte Termin schon zurück, steht der nächste sofort da.
  perform app_private.roll_plan_series(v_series.id);
  select * into v_series from public.plan_series s where s.id = v_series.id;
  return app_private.plan_series_json(v_series);
end $$;

-- Für die App: legt in den eigenen Crews fällige Termine an. Wird aufgerufen, wenn eine Liste den
-- vergangenen letzten Termin einer aktiven Serie sieht; gibt die Zahl der neuen Termine zurück.
create function public.roll_plan_series() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_series record;
  v_count integer := 0;
begin
  perform app_private.rate_limit('plan_series_roll', 120, interval '1 hour');
  for v_series in
    select s.id from public.plan_series s
    join public.crew_members m on m.crew_id = s.crew_id and m.user_id = v_uid
    where s.active order by s.created_at
  loop
    v_count := v_count + app_private.roll_plan_series(v_series.id);
  end loop;
  return v_count;
end $$;

revoke all on function app_private.plan_series_next_on(text, integer, integer, date) from public, anon, authenticated;
revoke all on function app_private.plan_series_json(public.plan_series) from public, anon, authenticated;
revoke all on function app_private.roll_plan_series(uuid) from public, anon, authenticated;
revoke all on function app_private.roll_due_plan_series() from public, anon, authenticated;
grant execute on function app_private.roll_due_plan_series() to service_role;
revoke all on function public.set_plan_repeat(uuid, text) from public, anon, authenticated;
grant execute on function public.set_plan_repeat(uuid, text) to authenticated;
revoke all on function public.roll_plan_series() from public, anon, authenticated;
grant execute on function public.roll_plan_series() to authenticated;
