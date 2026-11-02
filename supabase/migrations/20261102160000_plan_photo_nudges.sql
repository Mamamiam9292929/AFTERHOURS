-- P16 · Fotos vom Abend einsammeln
-- Am Morgen nach einem Plan bekommt jedes Mitglied der Crew, das zugesagt hatte, genau eine
-- Benachrichtigung „Fotos von gestern? Teilt sie mit der Crew“ – Antippen öffnet „Fotos vom Abend“
-- (`/plans/<id>#fotos`). Damit landen die Fotos bei der Crew statt verstreut in Chats.
--
-- Wann: ab 10 Uhr Berliner Zeit am Tag nach dem Beginn, frühestens nach dem Ende (mehrtägige Pläne) und
-- höchstens bis 3 Tage nach dem Ende (ohne Ende: nach dem Beginn). Nur, solange höchstens ein Foto geteilt
-- ist – sind schon mehrere da, ist die Erinnerung überflüssig. Nicht bei abgesagten Plänen, nicht an
-- Personen, die selbst schon ein Foto geteilt haben, nicht an Personen ohne Zusage („vielleicht“ zählt
-- nicht). Eigene Gruppe „Fotos vom Abend“ in den Einstellungen (`plan_photo_nudge`).
--
-- Angestoßen ohne Cron von der App (beim ersten Laden der Benachrichtigungen je Sitzung):
-- `send_plan_photo_nudges()` erinnert in allen Plänen der eigenen Crews – öffnet am Morgen danach irgendwer
-- aus der Crew die App, erfahren es alle (danach Push). Optional per pg_cron für alle
-- (`app_private.send_due_plan_photo_nudges()`, README Abschnitt 3).

create table public.plan_photo_nudges (
  plan_id uuid not null references public.plans (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (plan_id, user_id)
);
create index plan_photo_nudges_user_idx on public.plan_photo_nudges (user_id);

-- Nur intern: Niemand liest oder schreibt die Tabelle über die API.
alter table public.plan_photo_nudges enable row level security;
revoke all on table public.plan_photo_nudges from public, anon, authenticated;

-- Neuer Benachrichtigungstyp (bestehende Liste lesen und ergänzen, wie in 20261028140000).
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
  if not ('plan_photo_nudge' = any (v_types)) then
    v_types := v_types || 'plan_photo_nudge'::text;
  end if;
  alter table public.notifications drop constraint notifications_type_check;
  execute format('alter table public.notifications add constraint notifications_type_check check (type = any (%L::text[]))', v_types);
end $$;

-- Fällige Erinnerungen zum Zeitpunkt p_now – für die Pläne der Crews von p_user_id oder für alle (null).
-- Liefert die Zahl der neu erinnerten Personen-Plan-Paare. Idempotent über den Primärschlüssel, auch bei
-- gleichzeitigen Aufrufen. p_now gibt es nur für die Tests; die öffentlichen Wege rufen mit now().
create function app_private.send_plan_photo_nudges(p_user_id uuid, p_now timestamptz) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (p_now at time zone 'Europe/Berlin')::date;
  v_row record;
  v_count integer := 0;
begin
  if p_now is null then
    return 0;
  end if;
  for v_row in
    select p.id as plan_id, p.crew_id, p.title, p.starts_at, m.user_id,
           (p.starts_at at time zone 'Europe/Berlin')::date = v_today - 1 as yesterday
    from public.plans p
    join public.crew_members m on m.crew_id = p.crew_id
    join public.plan_participants pp on pp.plan_id = p.id and pp.user_id = m.user_id and pp.attendance_status = 'going'
    where p.starts_at > p_now - interval '30 days'
      and p.starts_at < p_now
      and p.status <> 'cancelled'
      and p_now >= ((p.starts_at at time zone 'Europe/Berlin')::date + 1 + time '10:00') at time zone 'Europe/Berlin'
      and p_now >= coalesce(p.ends_at, p.starts_at)
      and p_now < coalesce(p.ends_at, p.starts_at) + interval '3 days'
      and (select count(*) from public.plan_photos ph where ph.plan_id = p.id and ph.uploaded_at is not null) <= 1
      and not exists (select 1 from public.plan_photos ph where ph.plan_id = p.id and ph.uploaded_by = m.user_id and ph.uploaded_at is not null)
      and (p_user_id is null or exists (
        select 1 from public.crew_members me where me.crew_id = p.crew_id and me.user_id = p_user_id
      ))
      and not exists (select 1 from public.plan_photo_nudges r where r.plan_id = p.id and r.user_id = m.user_id)
    order by p.starts_at, p.id, m.user_id
    limit 500
  loop
    insert into public.plan_photo_nudges (plan_id, user_id) values (v_row.plan_id, v_row.user_id)
    on conflict do nothing;
    if found then
      -- Wer die Gruppe abgeschaltet hat, bekommt nichts – der Plan gilt trotzdem als erinnert.
      perform app_private.notify(v_row.user_id, 'plan_photo_nudge', null, v_row.crew_id, 'plan', v_row.plan_id,
        jsonb_build_object('title', v_row.title, 'starts_at', v_row.starts_at, 'yesterday', v_row.yesterday),
        'plan_photo_nudge:' || v_row.plan_id::text);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end $$;

-- Für pg_cron: alle fälligen Erinnerungen (z. B. stündlich).
create function app_private.send_due_plan_photo_nudges() returns integer
language sql security definer set search_path = '' as $$
  select app_private.send_plan_photo_nudges(null, now());
$$;

-- Für die App: fällige Erinnerungen der Pläne in den eigenen Crews. Höchstens 120 Aufrufe je Stunde.
create function public.send_plan_photo_nudges() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
begin
  perform app_private.rate_limit('plan_photo_nudges', 120, interval '1 hour');
  return app_private.send_plan_photo_nudges(v_uid, now());
end $$;

revoke all on function app_private.send_plan_photo_nudges(uuid, timestamptz) from public, anon, authenticated;
revoke all on function app_private.send_due_plan_photo_nudges() from public, anon, authenticated;
revoke all on function public.send_plan_photo_nudges() from public, anon, authenticated;
grant execute on function public.send_plan_photo_nudges() to authenticated, service_role;
