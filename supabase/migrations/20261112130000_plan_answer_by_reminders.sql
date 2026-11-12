-- P46 Etappe 2 · Antwortfrist: Erinnerung vorher, Bescheid danach
-- Etappe 1 hat die Frist sichtbar gemacht („Antwort bis Do., 20:00“). Wer sie übersieht, antwortet trotzdem nicht –
-- und wer organisiert, muss nach Ablauf selbst nachzählen. Jetzt:
--   * Am letzten Tag vor Ablauf (24 Stunden) bekommt jedes Mitglied, dessen Antwort noch fehlt („eingeladen“),
--     genau eine Erinnerung: „Antwort bis 20:00 – deine fehlt noch“. Wer „vielleicht“ gesagt hat, hat geantwortet
--     (dafür gibt es „Vielleicht festmachen“, P45).
--   * Nach Ablauf bekommt, wer den Plan angelegt hat, genau einmal den Stand: „Frist vorbei: 5 dabei, 2 offen“
--     (mit „vielleicht“, wenn es welche gibt) – zum Reservieren, ohne nachzuzählen. Gäste über den Link (W10) zählen mit.
--
-- Bewusst so gebaut:
--   * Kein neuer Benachrichtigungstyp: `plan_reminder` (Gruppe „Nachfragen zu Plänen“) ohne auslösende Person,
--     mit `deadline: true` bzw. `deadline_over: true` im Payload (eigene Texte in der App). Wer die Gruppe
--     abgeschaltet hat, bekommt nichts – die Erinnerung gilt trotzdem als verschickt.
--   * Je Plan und Person höchstens einmal je Art – auch wenn die Frist verschoben wird. Niemand soll durch
--     wiederholtes Verschieben mehrfach angeschrieben werden können.
--   * Keine Erinnerung, wenn in den letzten 6 Stunden schon von Hand nachgefragt wurde („Noch offen“, P19) – dann
--     kommt sie beim nächsten Anstoß, sobald die 6 Stunden um sind, solange die Frist noch läuft.
--   * Nur vor Beginn, nicht bei abgeschlossenen oder abgesagten Plänen. Den Stand gibt es nur bis 7 Tage nach
--     Ablauf (danach ist er nicht mehr nützlich) und nur, wenn die Person noch in der Crew ist.
--
-- Angestoßen ohne Cron von der App (wie P15: beim Laden der Benachrichtigungen, höchstens alle 15 Minuten je
-- Sitzung): `send_plan_answer_by_reminders()` für alle Pläne der eigenen Crews. Optional per pg_cron für alle
-- (`app_private.send_due_plan_answer_by_reminders()`, README Abschnitt 3).

create table public.plan_answer_by_notices (
  plan_id uuid not null references public.plans (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('reminder', 'summary')),
  sent_at timestamptz not null default now(),
  primary key (plan_id, user_id, kind)
);
create index plan_answer_by_notices_user_idx on public.plan_answer_by_notices (user_id);

comment on table public.plan_answer_by_notices is 'P46 Etappe 2: wer zu welcher Antwortfrist schon erinnert (reminder) bzw. über den Stand informiert (summary) wurde.';

-- Nur intern: Niemand liest oder schreibt die Tabelle über die API.
alter table public.plan_answer_by_notices enable row level security;
revoke all on table public.plan_answer_by_notices from public, anon, authenticated;

-- Fällige Erinnerungen und Stände zum Zeitpunkt p_now – für die Pläne der Crews von p_user_id oder für alle
-- (null). Liefert die Zahl der neu verschickten Benachrichtigungen. Idempotent über den Primärschlüssel, auch bei
-- gleichzeitigen Aufrufen. p_now gibt es nur für die Tests.
create function app_private.send_plan_answer_by_reminders(p_user_id uuid, p_now timestamptz) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_row record;
  v_count integer := 0;
  v_going integer;
  v_maybe integer;
  v_open integer;
begin
  if p_now is null then
    return 0;
  end if;

  -- 1. Erinnerung am letzten Tag vor Ablauf an alle Mitglieder, deren Antwort fehlt.
  for v_row in
    select p.id as plan_id, p.crew_id, p.title, p.starts_at, p.answer_by, pp.user_id
    from public.plans p
    join public.plan_participants pp on pp.plan_id = p.id and pp.attendance_status = 'invited'
    join public.crew_members m on m.crew_id = p.crew_id and m.user_id = pp.user_id
    where p.answer_by is not null
      and p.answer_by > p_now
      and p.answer_by <= p_now + interval '24 hours'
      and p.starts_at > p_now
      and p.status not in ('completed', 'cancelled')
      and (p_user_id is null or exists (
        select 1 from public.crew_members me where me.crew_id = p.crew_id and me.user_id = p_user_id
      ))
      and not exists (select 1 from public.plan_reminders r
                      where r.plan_id = p.id and r.last_sent_at > p_now - interval '6 hours')
      and not exists (select 1 from public.plan_answer_by_notices n
                      where n.plan_id = p.id and n.user_id = pp.user_id and n.kind = 'reminder')
    order by p.answer_by, p.id, pp.user_id
    limit 500
  loop
    insert into public.plan_answer_by_notices (plan_id, user_id, kind) values (v_row.plan_id, v_row.user_id, 'reminder')
    on conflict do nothing;
    if found then
      perform app_private.notify(v_row.user_id, 'plan_reminder', null, v_row.crew_id, 'plan', v_row.plan_id,
        jsonb_build_object('title', v_row.title, 'starts_at', v_row.starts_at, 'answer_by', v_row.answer_by, 'deadline', true),
        'plan_answer_by:' || v_row.plan_id::text);
      v_count := v_count + 1;
    end if;
  end loop;

  -- 2. Nach Ablauf einmal der Stand an die Person, die den Plan angelegt hat (solange sie in der Crew ist).
  for v_row in
    select p.id as plan_id, p.crew_id, p.title, p.starts_at, p.answer_by, p.created_by as user_id
    from public.plans p
    join public.crew_members m on m.crew_id = p.crew_id and m.user_id = p.created_by
    where p.answer_by is not null
      and p.answer_by <= p_now
      and p.answer_by > p_now - interval '7 days'
      and p.starts_at > p_now
      and p.status not in ('completed', 'cancelled')
      and (p_user_id is null or exists (
        select 1 from public.crew_members me where me.crew_id = p.crew_id and me.user_id = p_user_id
      ))
      and not exists (select 1 from public.plan_answer_by_notices n
                      where n.plan_id = p.id and n.user_id = p.created_by and n.kind = 'summary')
    order by p.answer_by, p.id
    limit 200
  loop
    insert into public.plan_answer_by_notices (plan_id, user_id, kind) values (v_row.plan_id, v_row.user_id, 'summary')
    on conflict do nothing;
    if found then
      v_going := app_private.plan_going_count(v_row.plan_id);
      select (select count(*) from public.plan_participants pp where pp.plan_id = v_row.plan_id and pp.attendance_status = 'maybe')::integer
           + (select count(*) from public.plan_guests g where g.plan_id = v_row.plan_id and g.attendance_status = 'maybe')::integer
        into v_maybe;
      select count(*)::integer into v_open
      from public.plan_participants pp
      join public.crew_members m on m.crew_id = v_row.crew_id and m.user_id = pp.user_id
      where pp.plan_id = v_row.plan_id and pp.attendance_status = 'invited';
      perform app_private.notify(v_row.user_id, 'plan_reminder', null, v_row.crew_id, 'plan', v_row.plan_id,
        jsonb_build_object('title', v_row.title, 'starts_at', v_row.starts_at, 'answer_by', v_row.answer_by,
                           'deadline_over', true, 'going', v_going, 'unsure', v_maybe, 'open', v_open),
        'plan_answer_by_over:' || v_row.plan_id::text);
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end $$;

-- Für pg_cron: alle fälligen Erinnerungen (z. B. jede Viertelstunde).
create function app_private.send_due_plan_answer_by_reminders() returns integer
language sql security definer set search_path = '' as $$
  select app_private.send_plan_answer_by_reminders(null, now());
$$;

-- Für die App: fällige Erinnerungen in den Plänen der eigenen Crews. Höchstens 120 Aufrufe je Stunde.
create function public.send_plan_answer_by_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
begin
  perform app_private.rate_limit('plan_answer_by_reminders', 120, interval '1 hour');
  return app_private.send_plan_answer_by_reminders(v_uid, now());
end $$;

revoke all on function app_private.send_plan_answer_by_reminders(uuid, timestamptz) from public, anon, authenticated;
revoke all on function app_private.send_due_plan_answer_by_reminders() from public, anon, authenticated;
revoke all on function public.send_plan_answer_by_reminders() from public, anon, authenticated;
grant execute on function public.send_plan_answer_by_reminders() to authenticated, service_role;

comment on function public.send_plan_answer_by_reminders() is 'P46 Etappe 2: Erinnerung am letzten Tag vor der Antwortfrist an alle ohne Antwort, nach Ablauf der Stand an die Person, die den Plan angelegt hat – für die Pläne der eigenen Crews.';
