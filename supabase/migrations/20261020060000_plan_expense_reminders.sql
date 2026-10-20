-- P3 Etappe 3b · Freundliche Erinnerung an offene Beträge
-- Ist eine Woche nach dem Abend (und eine Woche nach dem letzten Eintrag bei „Kosten teilen“) noch
-- Geld offen, bekommt jede Person mit offenem Betrag genau eine Benachrichtigung je Abend:
-- „Bei „Bowling“ sind von dir noch 14 € offen“ bzw. „… bekommst du noch 19 €“. Danach nie wieder für
-- diesen Abend – auch nicht, wenn neue Einträge dazukommen. Abschaltbar wie jede andere Benachrichtigung
-- (Typ `plan_expense_reminder`, eigene Gruppe in den Einstellungen).
--
-- Kein Druck: nur eine Erinnerung, keine Namen anderer in der Benachrichtigung, keine Wiederholung,
-- nichts nach außen. Abende, deren letzter Eintrag älter als 30 Tage ist, bekommen keine Erinnerung
-- mehr (sonst kämen beim Einspielen dieser Migration Erinnerungen für alte Abende auf einmal).
--
-- Angestoßen ohne Cron von der App: Beim ersten Laden der Benachrichtigungen je Sitzung ruft sie
-- `send_my_expense_reminders()` (nur eigene Erinnerungen). Optional per pg_cron für alle
-- (`app_private.send_due_expense_reminders()`, README Abschnitt 3).

create table public.plan_expense_reminders (
  plan_id uuid not null references public.plans (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (plan_id, user_id)
);
create index plan_expense_reminders_user_idx on public.plan_expense_reminders (user_id);

-- Nur intern: Niemand liest oder schreibt die Tabelle über die API.
alter table public.plan_expense_reminders enable row level security;
revoke all on table public.plan_expense_reminders from public, anon, authenticated;

-- Neuer Benachrichtigungstyp. Die Liste wird aus der bestehenden Regel gelesen und ergänzt, statt sie
-- neu aufzuschreiben – so gehen Typen anderer Migrationen nicht verloren.
do $$
declare
  v_def text;
  v_types text[];
begin
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conrelid = 'public.notifications'::regclass and c.conname = 'notifications_type_check';
  select array_agg(m.v[1] order by m.ord) into v_types
  from regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''', 'g') with ordinality as m(v, ord);
  if v_types is null or cardinality(v_types) = 0 then
    raise exception 'notifications_type_check nicht gefunden';
  end if;
  if not ('plan_expense_reminder' = any (v_types)) then
    v_types := v_types || 'plan_expense_reminder'::text;
  end if;
  alter table public.notifications drop constraint notifications_type_check;
  execute format('alter table public.notifications add constraint notifications_type_check check (type = any (%L::text[]))', v_types);
end $$;

-- Fällige Erinnerungen verschicken: für eine Person (p_user_id) oder alle (null). Liefert die Zahl der
-- neu erinnerten Personen-Abend-Paare. Idempotent: Jede Person wird je Abend höchstens einmal erinnert
-- (Primärschlüssel), auch bei gleichzeitigen Aufrufen.
create function app_private.send_expense_reminders(p_user_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    with quiet as (
      -- Abende, bei denen seit einer Woche nichts eingetragen wurde und deren Beginn eine Woche her ist.
      select p.id as plan_id, p.crew_id, p.title
      from public.plans p
      join lateral (select max(e.created_at) as last_at from public.plan_expenses e where e.plan_id = p.id) l on l.last_at is not null
      where greatest(p.starts_at, l.last_at) <= now() - interval '7 days'
        and l.last_at > now() - interval '30 days'
        and (p_user_id is null or exists (
          select 1 from public.plan_expense_shares s where s.plan_id = p.id and s.user_id = p_user_id
          union all
          select 1 from public.plan_expenses e where e.plan_id = p.id and e.paid_by = p_user_id
        ))
    ),
    balances as (
      -- Dieselbe Regel wie `crew_open_balances`: jeder Anteil einer anderen Person ist eine Schuld
      -- gegenüber der zahlenden Person.
      select q.plan_id, q.crew_id, q.title, x.user_id, sum(x.cents)::integer as balance_cents
      from quiet q
      join public.plan_expenses e on e.plan_id = q.plan_id
      join public.plan_expense_shares s on s.expense_id = e.id and s.user_id <> e.paid_by and s.amount_cents > 0
      cross join lateral (values (e.paid_by, s.amount_cents), (s.user_id, -s.amount_cents)) as x(user_id, cents)
      group by q.plan_id, q.crew_id, q.title, x.user_id
      having sum(x.cents) <> 0
    )
    select b.* from balances b
    where (p_user_id is null or b.user_id = p_user_id)
      and app_private.is_member_of(b.crew_id, b.user_id)
      and not exists (select 1 from public.plan_expense_reminders r where r.plan_id = b.plan_id and r.user_id = b.user_id)
    order by b.plan_id, b.user_id
    limit 200
  loop
    insert into public.plan_expense_reminders (plan_id, user_id) values (v_row.plan_id, v_row.user_id)
    on conflict do nothing;
    if found then
      -- Wer die Gruppe abgeschaltet hat, bekommt nichts – der Abend gilt trotzdem als erinnert.
      perform app_private.notify(v_row.user_id, 'plan_expense_reminder', null, v_row.crew_id, 'plan', v_row.plan_id,
        jsonb_build_object('title', v_row.title, 'balance_cents', v_row.balance_cents),
        'plan_expense_reminder:' || v_row.plan_id::text);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end $$;

-- Für pg_cron: alle fälligen Erinnerungen.
create function app_private.send_due_expense_reminders() returns integer
language sql security definer set search_path = '' as $$
  select app_private.send_expense_reminders(null);
$$;

-- Für die App: nur die eigenen Erinnerungen. Die App ruft das bei jedem Start einmal auf; höchstens
-- 120 Aufrufe je Stunde (wer öfter neu lädt, bekommt die Erinnerung beim nächsten erlaubten Start).
create function public.send_my_expense_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
begin
  perform app_private.rate_limit('expense_reminders', 120, interval '1 hour');
  return app_private.send_expense_reminders(v_uid);
end $$;

revoke all on function app_private.send_expense_reminders(uuid) from public, anon, authenticated;
revoke all on function app_private.send_due_expense_reminders() from public, anon, authenticated;
revoke all on function public.send_my_expense_reminders() from public, anon, authenticated;
grant execute on function public.send_my_expense_reminders() to authenticated, service_role;
