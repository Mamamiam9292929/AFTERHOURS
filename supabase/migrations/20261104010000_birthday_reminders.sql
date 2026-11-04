-- P20 · Geburtstage in der Crew (Etappe 2): Erinnerung eine Woche vorher und Hinweis auf Home
--
-- Hat jemand aus einer Crew in den nächsten 7 Tagen Geburtstag (Berliner Zeit), bekommen die anderen
-- Mitglieder genau eine Benachrichtigung „Bob hat am Samstag, 14. November Geburtstag – Feier planen?“.
-- Antippen öffnet die Karte „Bald Geburtstag“ der Crew mit „Feier planen“. Das Geburtstagskind selbst
-- bekommt nichts. Wer mit der Person in mehreren Crews ist, bekommt trotzdem nur eine (über die älteste
-- gemeinsame Crew). Eigene Gruppe „Geburtstage“ in den Einstellungen (`birthday_reminder`).
--
-- Ein 29. Februar wird in Jahren ohne Schalttag am 28. gefeiert – wie in der App (`src/lib/birthdays.ts`).
--
-- Angestoßen ohne Cron von der App (einmal je Sitzung beim Laden der Benachrichtigungen):
-- `send_birthday_reminders()` erinnert in allen eigenen Crews – öffnet irgendwer aus der Crew die App,
-- erfahren es alle (danach Push). Optional per pg_cron (`app_private.send_due_birthday_reminders()`).
--
-- Für Home: `my_crew_birthdays()` liefert die Geburtstage aller Mitglieder der eigenen Crews (ohne die
-- eigene Person) – wann der nächste ist, rechnet die App.

-- Geburtstag (Tag, Monat) in einem Jahr; 29. Februar in Jahren ohne Schalttag am 28.
create function app_private.birthday_in_year(p_month integer, p_day integer, p_year integer) returns date
language sql immutable set search_path = '' as $$
  select make_date(p_year, p_month,
                   least(p_day, extract(day from (make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day'))::integer))
$$;

-- Nächster Geburtstag ab p_today (heute eingeschlossen).
create function app_private.next_birthday(p_month integer, p_day integer, p_today date) returns date
language sql immutable set search_path = '' as $$
  select case
    when app_private.birthday_in_year(p_month, p_day, extract(year from p_today)::integer) >= p_today
      then app_private.birthday_in_year(p_month, p_day, extract(year from p_today)::integer)
    else app_private.birthday_in_year(p_month, p_day, extract(year from p_today)::integer + 1)
  end
$$;

revoke all on function app_private.birthday_in_year(integer, integer, integer) from public, anon, authenticated;
revoke all on function app_private.next_birthday(integer, integer, date) from public, anon, authenticated;

-- Wer an welchen Geburtstag schon erinnert wurde (je Geburtstagskind, Empfänger:in und Datum genau einmal).
create table public.birthday_reminders (
  birthday_user_id uuid not null references public.profiles (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  birthday date not null,
  sent_at timestamptz not null default now(),
  primary key (birthday_user_id, user_id, birthday)
);
create index birthday_reminders_user_idx on public.birthday_reminders (user_id);

-- Nur intern: Niemand liest oder schreibt die Tabelle über die API.
alter table public.birthday_reminders enable row level security;
revoke all on table public.birthday_reminders from public, anon, authenticated;

-- Neuer Benachrichtigungstyp (bestehende Liste lesen und ergänzen, wie in 20261102160000).
do $$
declare
  v_def text;
  v_types text[];
begin
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conrelid = 'public.notifications'::regclass and c.conname = 'notifications_type_check';
  if v_def ~ '''\{[a-z_,]+\}''' then
    v_types := substring(v_def from '''(\{[a-z_,]+\})''')::text[];
  else
    select array_agg(m.v[1] order by m.ord) into v_types
    from regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''', 'g') with ordinality as m(v, ord);
  end if;
  if v_types is null or cardinality(v_types) = 0 then
    raise exception 'notifications_type_check nicht gefunden';
  end if;
  if not ('birthday_reminder' = any (v_types)) then
    v_types := v_types || 'birthday_reminder'::text;
  end if;
  alter table public.notifications drop constraint notifications_type_check;
  execute format('alter table public.notifications add constraint notifications_type_check check (type = any (%L::text[]))', v_types);
end $$;

-- Fällige Erinnerungen zum Zeitpunkt p_now – für die Crews von p_user_id oder für alle (null). Liefert die
-- Zahl der neu erinnerten Personen. Idempotent über den Primärschlüssel, auch bei gleichzeitigen Aufrufen.
-- p_now gibt es nur für die Tests; die öffentlichen Wege rufen mit now().
create function app_private.send_birthday_reminders(p_user_id uuid, p_now timestamptz) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (p_now at time zone 'Europe/Berlin')::date;
  v_row record;
  v_count integer := 0;
begin
  if p_now is null then
    return 0;
  end if;
  -- Vergangene Geburtstage braucht niemand mehr.
  delete from public.birthday_reminders r where r.birthday < v_today - 30;

  for v_row in
    select y.* from (
      select distinct on (b.user_id, m.user_id)
             b.user_id as birthday_user_id, m.user_id, c.id as crew_id, c.name as crew_name, nb.birthday
      from public.birthdays b
      cross join lateral (select app_private.next_birthday(b.month, b.day, v_today) as birthday) nb
      join public.crew_members bm on bm.user_id = b.user_id
      join public.crews c on c.id = bm.crew_id
      join public.crew_members m on m.crew_id = bm.crew_id and m.user_id <> b.user_id
      where nb.birthday - v_today between 1 and 7
        and (p_user_id is null or exists (
          select 1 from public.crew_members me where me.crew_id = bm.crew_id and me.user_id = p_user_id
        ))
        and not exists (
          select 1 from public.birthday_reminders r
          where r.birthday_user_id = b.user_id and r.user_id = m.user_id and r.birthday = nb.birthday
        )
      order by b.user_id, m.user_id, c.created_at, c.id
    ) y
    order by y.birthday, y.birthday_user_id, y.user_id
    limit 1000
  loop
    insert into public.birthday_reminders (birthday_user_id, user_id, birthday)
    values (v_row.birthday_user_id, v_row.user_id, v_row.birthday)
    on conflict do nothing;
    if found then
      -- Wer die Gruppe abgeschaltet hat, bekommt nichts – der Geburtstag gilt trotzdem als erinnert.
      perform app_private.notify(v_row.user_id, 'birthday_reminder', v_row.birthday_user_id, v_row.crew_id, 'crew', v_row.crew_id,
        jsonb_build_object('date', v_row.birthday, 'crew_name', v_row.crew_name),
        'birthday_reminder:' || v_row.birthday_user_id::text || ':' || v_row.birthday::text);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end $$;

-- Für pg_cron: alle fälligen Erinnerungen (z. B. einmal am Tag um 9 Uhr).
create function app_private.send_due_birthday_reminders() returns integer
language sql security definer set search_path = '' as $$
  select app_private.send_birthday_reminders(null, now());
$$;

-- Für die App: fällige Erinnerungen in den eigenen Crews. Höchstens 120 Aufrufe je Stunde.
create function public.send_birthday_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
begin
  perform app_private.rate_limit('birthday_reminders', 120, interval '1 hour');
  return app_private.send_birthday_reminders(v_uid, now());
end $$;

revoke all on function app_private.send_birthday_reminders(uuid, timestamptz) from public, anon, authenticated;
revoke all on function app_private.send_due_birthday_reminders() from public, anon, authenticated;
revoke all on function public.send_birthday_reminders() from public, anon, authenticated;
grant execute on function public.send_birthday_reminders() to authenticated, service_role;

-- Für Home: Geburtstage der Mitglieder aller eigenen Crews, ohne die eigene Person. Eine Zeile je Person
-- und Crew (die App zeigt jede Person einmal).
create function public.my_crew_birthdays() returns table (user_id uuid, crew_id uuid, month integer, day integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
begin
  return query
    select b.user_id, m.crew_id, b.month::integer, b.day::integer
    from public.crew_members me
    join public.crew_members m on m.crew_id = me.crew_id and m.user_id <> v_uid
    join public.birthdays b on b.user_id = m.user_id
    where me.user_id = v_uid
    order by b.month, b.day, b.user_id, m.crew_id;
end $$;

revoke all on function public.my_crew_birthdays() from public, anon, authenticated;
grant execute on function public.my_crew_birthdays() to authenticated, service_role;
