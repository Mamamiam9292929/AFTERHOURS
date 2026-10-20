-- =============================================================================================
-- AFTERHOURS – Runde jede Woche von selbst (Roadmap S7)
--
-- „Freitag, was geht?“ ohne Organisator: Wer eine Orts-Abstimmung verwaltet (Ersteller:in, Owner/Admin),
-- schaltet „Jede Woche neu“ ein. Ist die Runde vorbei, startet der Server rechtzeitig die nächste – eine
-- Woche später, mit denselben Vorschlägen (Termine eine Woche später), Frage, Beschreibung, Treffpunkt,
-- Budget, Mindestzahl, Gäste-Schalter und „Entscheidet sich selbst“. Sie öffnet so lange vor ihrem Ende,
-- wie die letzte Runde lief (mindestens 1, höchstens 6 Tage): Lief „Freitag, was geht?“ von Dienstag bis
-- Freitag 12 Uhr, öffnet die nächste am Dienstag darauf. Verpasste Wochen werden übersprungen, nie
-- rückwirkend angelegt; es läuft nie mehr als eine Runde je Serie.
--
-- Angestoßen wie bei P8 von der App (`roll_poll_series`, wenn die Abstimmungsliste eine fällige Runde
-- sieht) und optional per pg_cron (`app_private.roll_due_poll_series()`). Beides ist idempotent: Die Serie
-- wird gesperrt, und es entsteht nur eine Runde, wenn die letzte vorbei und die nächste fällig ist.
-- Termin-Abstimmungen und Stichwahlen lassen sich nicht wiederholen (`repeat_unsupported`).
-- =============================================================================================

create table public.poll_series (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crews (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  active boolean not null default true,
  stopped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index poll_series_crew_idx on public.poll_series (crew_id) where active;

alter table public.polls add column series_id uuid references public.poll_series (id) on delete set null;
create index polls_series_idx on public.polls (series_id, ends_at) where series_id is not null;

alter table public.poll_series enable row level security;
revoke all on table public.poll_series from public, anon, authenticated;
grant select on table public.poll_series to authenticated;
create policy poll_series_select_member on public.poll_series for select to authenticated
  using (app_private.is_crew_member(crew_id));

-- series_id ist nicht direkt schreibbar: Spaltenrechte auf polls gibt es für authenticated ohnehin nicht
-- (geschrieben wird nur über RPCs); Stichwahlen bekommen keine Serie (Trigger unten).

-- Nächste Runde nach einer Runde, die am p_ends_at endete und am p_created_at begann (gleiche Rechnung im
-- Browser: src/lib/pollrepeat.ts). weeks = Zahl der Wochen, ends_at = Ende, opens_at = ab wann sie läuft.
create function app_private.poll_series_next(p_ends_at timestamptz, p_created_at timestamptz, p_now timestamptz)
returns table (weeks integer, ends_at timestamptz, opens_at timestamptz)
language plpgsql stable set search_path = '' as $$
declare
  v_lead interval := least(greatest(p_ends_at - p_created_at, interval '1 day'), interval '6 days');
  v_weeks integer := 1;
  v_end timestamptz;
begin
  loop
    -- Wochen in Berliner Zeit addieren, damit 12:00 auch über die Zeitumstellung 12:00 bleibt.
    v_end := ((p_ends_at at time zone 'Europe/Berlin') + make_interval(days => 7 * v_weeks)) at time zone 'Europe/Berlin';
    exit when v_end > p_now + interval '1 hour';
    v_weeks := v_weeks + 1;
    if v_weeks > 520 then
      return;
    end if;
  end loop;
  weeks := v_weeks;
  ends_at := v_end;
  opens_at := v_end - v_lead;
  return next;
end $$;

create function app_private.poll_series_json(p_series_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_series public.poll_series%rowtype;
  v_last public.polls%rowtype;
  v_next_ends timestamptz; -- bleibt null bei beendeter Serie (ein nicht zugewiesener record würde beim Lesen scheitern)
  v_next_opens timestamptz;
begin
  select * into v_series from public.poll_series s where s.id = p_series_id;
  if not found then
    return null;
  end if;
  select * into v_last from public.polls p where p.series_id = p_series_id order by p.ends_at desc, p.created_at desc limit 1;
  if v_series.active and v_last.id is not null then
    select n.ends_at, n.opens_at into v_next_ends, v_next_opens
    from app_private.poll_series_next(v_last.ends_at, v_last.created_at, greatest(now(), v_last.ends_at)) n;
  end if;
  return jsonb_build_object('id', v_series.id, 'active', v_series.active, 'last_poll_id', v_last.id,
                            'next_ends_at', v_next_ends, 'next_opens_at', v_next_opens);
end $$;

-- Startet die nächste Runde einer Serie, wenn die letzte vorbei und die nächste fällig ist. 1 = gestartet, sonst 0.
create function app_private.roll_poll_series(p_series_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_series public.poll_series%rowtype;
  v_last public.polls%rowtype;
  v_next record;
  v_creator uuid;
  v_poll_id uuid;
begin
  select * into v_series from public.poll_series s where s.id = p_series_id for update;
  if not found or not v_series.active then
    return 0;
  end if;
  select * into v_last from public.polls p where p.series_id = p_series_id order by p.ends_at desc, p.created_at desc limit 1;
  if not found then
    -- Keine Runde mehr (gelöscht): Serie ruht, statt ins Leere zu laufen.
    update public.poll_series s set active = false, stopped_at = now(), updated_at = now() where s.id = p_series_id;
    return 0;
  end if;
  if v_last.status = 'open' and v_last.ends_at > now() then
    return 0; -- die Runde läuft noch
  end if;
  select * into v_next from app_private.poll_series_next(v_last.ends_at, v_last.created_at, now());
  if v_next.ends_at is null or now() < v_next.opens_at then
    return 0; -- noch nicht fällig
  end if;

  -- Wer die Serie angelegt hat, startet die Runde – solange sie/er noch in der Crew ist.
  select m.user_id into v_creator from public.crew_members m
  where m.crew_id = v_series.crew_id and m.user_id = v_series.created_by;

  insert into public.polls (crew_id, created_by, series_id, title, description, meeting_point, budget_cents,
                            min_participants, ends_at, guests_allowed, auto_decide)
  values (v_series.crew_id, v_creator, v_series.id, v_last.title, v_last.description, v_last.meeting_point,
          v_last.budget_cents, v_last.min_participants, v_next.ends_at, v_last.guests_allowed, v_last.auto_decide)
  returning id into v_poll_id;

  insert into public.poll_options (poll_id, activity_id, title, proposed_date, proposed_time, estimated_price_cents, position)
  select v_poll_id, o.activity_id, o.title, o.proposed_date + 7 * v_next.weeks, o.proposed_time, o.estimated_price_cents, o.position
  from public.poll_options o where o.poll_id = v_last.id
  order by o.position;

  perform app_private.notify_crew(v_series.crew_id, 'poll_created', null, 'poll', v_poll_id,
                                  jsonb_build_object('title', v_last.title, 'repeat', true, 'ends_at', v_next.ends_at),
                                  'poll_created:' || v_poll_id::text);
  perform app_private.audit('poll_series_rolled', 'poll', v_poll_id, v_series.crew_id,
                            jsonb_build_object('series_id', v_series.id, 'weeks', v_next.weeks));
  return 1;
end $$;

-- Für pg_cron bzw. service_role.
create function app_private.roll_due_poll_series() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_series record;
  v_count integer := 0;
begin
  for v_series in select s.id from public.poll_series s where s.active order by s.created_at loop
    v_count := v_count + app_private.roll_poll_series(v_series.id);
  end loop;
  return v_count;
end $$;

-- Stichwahlen gehören nie zu einer Serie (die Serie läuft über die eigentliche Runde weiter).
create function app_private.poll_series_no_runoff() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.parent_poll_id is not null then
    new.series_id := null;
  end if;
  return new;
end $$;
create trigger polls_series_no_runoff before insert on public.polls
  for each row execute function app_private.poll_series_no_runoff();

-- „Jede Woche neu“ ein- oder ausschalten. Ersteller:in oder Owner/Admin; nur Orts-Abstimmungen ohne
-- Stichwahl; auch nach dem Ende (dann startet die nächste Runde, sobald sie fällig ist). Gilt für die Serie.
create function public.set_poll_repeat(p_poll_id uuid, p_enabled boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_poll public.polls%rowtype;
  v_series public.poll_series%rowtype;
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
  if p_enabled and (v_poll.kind <> 'place' or v_poll.parent_poll_id is not null) then
    perform app_private.fail('repeat_unsupported');
  end if;
  perform app_private.rate_limit('poll_series', 30, interval '1 hour');

  if v_poll.series_id is not null then
    select * into v_series from public.poll_series s where s.id = v_poll.series_id for update;
  end if;

  if not p_enabled then
    if v_series.id is null then
      return null;
    end if;
    if v_series.active then
      update public.poll_series s set active = false, stopped_at = now(), updated_at = now() where s.id = v_series.id;
      perform app_private.audit('poll_series_stopped', 'poll', v_poll.id, v_poll.crew_id, jsonb_build_object('series_id', v_series.id));
    end if;
    return app_private.poll_series_json(v_series.id);
  end if;

  if v_series.id is null or not v_series.active then
    if (select count(*) from public.poll_series s where s.crew_id = v_poll.crew_id and s.active) >= 10 then
      perform app_private.fail('too_many_series');
    end if;
  end if;
  if v_series.id is null then
    insert into public.poll_series (crew_id, created_by) values (v_poll.crew_id, v_uid) returning * into v_series;
    update public.polls p set series_id = v_series.id where p.id = v_poll.id;
  elsif not v_series.active then
    update public.poll_series s set active = true, stopped_at = null, updated_at = now() where s.id = v_series.id;
  end if;
  perform app_private.audit('poll_series_set', 'poll', v_poll.id, v_poll.crew_id, jsonb_build_object('series_id', v_series.id));

  -- Ist die Runde schon vorbei und die nächste fällig, läuft sie sofort.
  perform app_private.roll_poll_series(v_series.id);
  return app_private.poll_series_json(v_series.id);
end $$;

-- Für die App: startet in den eigenen Crews fällige Runden; gibt die Zahl der neuen Runden zurück.
create function public.roll_poll_series() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_series record;
  v_count integer := 0;
begin
  perform app_private.rate_limit('poll_series_roll', 120, interval '1 hour');
  for v_series in
    select s.id from public.poll_series s
    join public.crew_members m on m.crew_id = s.crew_id and m.user_id = v_uid
    where s.active order by s.created_at
  loop
    v_count := v_count + app_private.roll_poll_series(v_series.id);
  end loop;
  return v_count;
end $$;

revoke all on function app_private.poll_series_next(timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function app_private.poll_series_json(uuid) from public, anon, authenticated;
revoke all on function app_private.roll_poll_series(uuid) from public, anon, authenticated;
revoke all on function app_private.roll_due_poll_series() from public, anon, authenticated;
revoke all on function app_private.poll_series_no_runoff() from public, anon, authenticated;
grant execute on function app_private.roll_due_poll_series() to service_role;
revoke all on function public.set_poll_repeat(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_poll_repeat(uuid, boolean) to authenticated;
revoke all on function public.roll_poll_series() from public, anon, authenticated;
grant execute on function public.roll_poll_series() to authenticated;
