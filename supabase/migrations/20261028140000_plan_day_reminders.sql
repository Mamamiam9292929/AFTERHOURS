-- P4 Etappe 2 · Erinnerung am Tag des Plans
-- Am Tag eines Plans bekommt jedes Mitglied der Crew, das nicht abgesagt hat, genau eine Benachrichtigung:
-- „Heute 20:00 Uhr: Bowling“ – mit „Bist du dabei?“, wenn die Antwort noch fehlt oder „vielleicht“ lautet.
-- Mit Push (Etappe 1) landet sie auf dem Handy, auch wenn die App zu ist.
--
-- Wann: ab 9 Uhr Berliner Zeit am Tag des Plans, bei frühen Plänen spätestens 3 Stunden vor Beginn, und
-- nur bis zum Beginn. Nicht für Pläne, die erst an diesem Tag angelegt wurden (die kennt die Crew gerade
-- erst aus „Plan erstellt“), nicht für abgesagte oder schon abgeschlossene Pläne. Wer abgesagt hat oder
-- die Gruppe „Am Tag des Plans“ abgeschaltet hat, bekommt nichts.
--
-- Angestoßen ohne Cron von der App: Beim ersten Laden der Benachrichtigungen je Sitzung ruft sie
-- `send_plan_day_reminders()`. Das verschickt die fälligen Erinnerungen für alle Pläne der eigenen Crews –
-- öffnet ein Mitglied am Tag des Plans die App, erfahren es alle (die App stößt danach Push an).
-- Optional per pg_cron für alle (`app_private.send_due_plan_day_reminders()`, README Abschnitt 3).

create table public.plan_day_reminders (
  plan_id uuid not null references public.plans (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (plan_id, user_id)
);
create index plan_day_reminders_user_idx on public.plan_day_reminders (user_id);

-- Nur intern: Niemand liest oder schreibt die Tabelle über die API.
alter table public.plan_day_reminders enable row level security;
revoke all on table public.plan_day_reminders from public, anon, authenticated;

-- Neuer Benachrichtigungstyp (bestehende Liste lesen und ergänzen, wie in 20261020060000).
do $$
declare
  v_def text;
  v_types text[];
begin
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conrelid = 'public.notifications'::regclass and c.conname = 'notifications_type_check';
  -- Seit 20261020060000 steht die Liste als Array-Literal da ('{a,b,…}'::text[]), davor als einzelne
  -- Zeichenketten ('a'::text, 'b'::text). Beides wird gelesen.
  if v_def ~ '''\{[a-z_,]+\}''' then
    v_types := substring(v_def from '''(\{[a-z_,]+\})''')::text[];
  else
    select array_agg(m.v[1] order by m.ord) into v_types
    from regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''', 'g') with ordinality as m(v, ord);
  end if;
  if v_types is null or cardinality(v_types) = 0 then
    raise exception 'notifications_type_check nicht gefunden';
  end if;
  if not ('plan_day_reminder' = any (v_types)) then
    v_types := v_types || 'plan_day_reminder'::text;
  end if;
  alter table public.notifications drop constraint notifications_type_check;
  execute format('alter table public.notifications add constraint notifications_type_check check (type = any (%L::text[]))', v_types);
end $$;

-- Fällige Erinnerungen zum Zeitpunkt p_now verschicken – für die Pläne der Crews von p_user_id oder für
-- alle (null). Liefert die Zahl der neu erinnerten Personen-Plan-Paare. Idempotent: Jede Person wird je
-- Plan höchstens einmal erinnert (Primärschlüssel), auch bei gleichzeitigen Aufrufen. p_now gibt es nur,
-- damit die Tests jede Uhrzeit prüfen können; die öffentlichen Wege rufen mit now().
create function app_private.send_plan_day_reminders(p_user_id uuid, p_now timestamptz) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_day date := (p_now at time zone 'Europe/Berlin')::date;
  v_day_start timestamptz := v_day::timestamp at time zone 'Europe/Berlin';
  v_day_end timestamptz := (v_day + 1)::timestamp at time zone 'Europe/Berlin';
  v_nine timestamptz := (v_day + time '09:00') at time zone 'Europe/Berlin';
  v_row record;
  v_count integer := 0;
begin
  if p_now is null then
    return 0;
  end if;
  for v_row in
    select p.id as plan_id, p.crew_id, p.title, p.starts_at, m.user_id,
           coalesce(pp.attendance_status::text, 'invited') as attendance
    from public.plans p
    join public.crew_members m on m.crew_id = p.crew_id
    left join public.plan_participants pp on pp.plan_id = p.id and pp.user_id = m.user_id
    where p.starts_at >= v_day_start and p.starts_at < v_day_end
      and p.starts_at > p_now
      and p_now >= least(v_nine, p.starts_at - interval '3 hours')
      and p.created_at < v_day_start
      and p.status in ('proposed', 'confirmed', 'booking_pending', 'booked')
      and pp.attendance_status is distinct from 'declined'
      and (p_user_id is null or exists (
        select 1 from public.crew_members me where me.crew_id = p.crew_id and me.user_id = p_user_id
      ))
      and not exists (select 1 from public.plan_day_reminders r where r.plan_id = p.id and r.user_id = m.user_id)
    order by p.starts_at, p.id, m.user_id
    limit 500
  loop
    insert into public.plan_day_reminders (plan_id, user_id) values (v_row.plan_id, v_row.user_id)
    on conflict do nothing;
    if found then
      -- Wer die Gruppe abgeschaltet hat, bekommt nichts – der Plan gilt trotzdem als erinnert.
      perform app_private.notify(v_row.user_id, 'plan_day_reminder', null, v_row.crew_id, 'plan', v_row.plan_id,
        jsonb_build_object('title', v_row.title, 'starts_at', v_row.starts_at, 'attendance', v_row.attendance),
        'plan_day_reminder:' || v_row.plan_id::text);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end $$;

-- Für pg_cron: alle fälligen Erinnerungen (z. B. jede Viertelstunde).
create function app_private.send_due_plan_day_reminders() returns integer
language sql security definer set search_path = '' as $$
  select app_private.send_plan_day_reminders(null, now());
$$;

-- Für die App: fällige Erinnerungen der Pläne in den eigenen Crews. Höchstens 120 Aufrufe je Stunde.
create function public.send_plan_day_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
begin
  perform app_private.rate_limit('plan_day_reminders', 120, interval '1 hour');
  return app_private.send_plan_day_reminders(v_uid, now());
end $$;

revoke all on function app_private.send_plan_day_reminders(uuid, timestamptz) from public, anon, authenticated;
revoke all on function app_private.send_due_plan_day_reminders() from public, anon, authenticated;
revoke all on function public.send_plan_day_reminders() from public, anon, authenticated;
grant execute on function public.send_plan_day_reminders() to authenticated, service_role;
