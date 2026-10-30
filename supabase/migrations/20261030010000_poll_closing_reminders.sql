-- P15 · Endspurt: „Abstimmung endet um 20:00 – deine Stimme fehlt“
-- In den letzten drei Stunden einer laufenden Abstimmung bekommt jedes Mitglied der Crew, das noch bei
-- keinem Vorschlag geantwortet hat, genau eine Erinnerung – ohne dass die Person, die gefragt hat,
-- hinterherschreiben muss. Gleicher Typ wie die Erinnerung von Hand (`poll_reminder`, Gruppe
-- „Erinnerungen“), aber ohne auslösende Person und mit `closing: true` und dem Ende im Payload.
--
-- Nicht für kurze Abstimmungen (weniger als 6 Stunden Laufzeit – da ist „Neue Abstimmung“ noch frisch),
-- nicht, wenn in den letzten 3 Stunden schon von Hand erinnert wurde (`polls.last_reminded_at`), nicht
-- nach dem Ende oder wenn die Abstimmung schon entschieden ist. Wer die Gruppe „Erinnerungen“
-- abgeschaltet hat, bekommt nichts.
--
-- Angestoßen ohne Cron von der App (beim Laden der Benachrichtigungen, höchstens alle 15 Minuten je
-- Sitzung): `send_poll_closing_reminders()` erinnert in allen Abstimmungen der eigenen Crews – öffnet
-- irgendwer aus der Crew in den letzten drei Stunden die App, erfahren es alle (danach Push).
-- Optional per pg_cron für alle (`app_private.send_due_poll_closing_reminders()`, README Abschnitt 3).

create table public.poll_closing_reminders (
  poll_id uuid not null references public.polls (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);
create index poll_closing_reminders_user_idx on public.poll_closing_reminders (user_id);

-- Nur intern: Niemand liest oder schreibt die Tabelle über die API.
alter table public.poll_closing_reminders enable row level security;
revoke all on table public.poll_closing_reminders from public, anon, authenticated;

-- Fällige Erinnerungen zum Zeitpunkt p_now – für die Abstimmungen der Crews von p_user_id oder für alle
-- (null). Liefert die Zahl der neu erinnerten Personen-Abstimmungs-Paare. Idempotent über den
-- Primärschlüssel, auch bei gleichzeitigen Aufrufen. p_now gibt es nur für die Tests.
create function app_private.send_poll_closing_reminders(p_user_id uuid, p_now timestamptz) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_row record;
  v_count integer := 0;
begin
  if p_now is null then
    return 0;
  end if;
  for v_row in
    select p.id as poll_id, p.crew_id, p.title, p.ends_at, m.user_id
    from public.polls p
    join public.crew_members m on m.crew_id = p.crew_id
    where p.status = 'open'
      and p.ends_at > p_now
      and p.ends_at <= p_now + interval '3 hours'
      and p.created_at <= p.ends_at - interval '6 hours'
      and (p.last_reminded_at is null or p.last_reminded_at <= p_now - interval '3 hours')
      and (p_user_id is null or exists (
        select 1 from public.crew_members me where me.crew_id = p.crew_id and me.user_id = p_user_id
      ))
      and not exists (select 1 from public.poll_votes v where v.poll_id = p.id and v.user_id = m.user_id)
      and not exists (select 1 from public.poll_closing_reminders r where r.poll_id = p.id and r.user_id = m.user_id)
    order by p.ends_at, p.id, m.user_id
    limit 500
  loop
    insert into public.poll_closing_reminders (poll_id, user_id) values (v_row.poll_id, v_row.user_id)
    on conflict do nothing;
    if found then
      -- Wer „Erinnerungen“ abgeschaltet hat, bekommt nichts – die Abstimmung gilt trotzdem als erinnert.
      perform app_private.notify(v_row.user_id, 'poll_reminder', null, v_row.crew_id, 'poll', v_row.poll_id,
        jsonb_build_object('title', v_row.title, 'ends_at', v_row.ends_at, 'closing', true),
        'poll_closing:' || v_row.poll_id::text);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end $$;

-- Für pg_cron: alle fälligen Erinnerungen (z. B. jede Viertelstunde).
create function app_private.send_due_poll_closing_reminders() returns integer
language sql security definer set search_path = '' as $$
  select app_private.send_poll_closing_reminders(null, now());
$$;

-- Für die App: fällige Erinnerungen in den Abstimmungen der eigenen Crews. Höchstens 120 Aufrufe je Stunde.
create function public.send_poll_closing_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
begin
  perform app_private.rate_limit('poll_closing_reminders', 120, interval '1 hour');
  return app_private.send_poll_closing_reminders(v_uid, now());
end $$;

revoke all on function app_private.send_poll_closing_reminders(uuid, timestamptz) from public, anon, authenticated;
revoke all on function app_private.send_due_poll_closing_reminders() from public, anon, authenticated;
revoke all on function public.send_poll_closing_reminders() from public, anon, authenticated;
grant execute on function public.send_poll_closing_reminders() to authenticated, service_role;
