-- P19 · Nachfragen beim Plan
-- Wer einen Plan organisiert (oder Owner/Admin der Crew ist), fragt mit einem Tipp alle, die noch nicht
-- geantwortet haben: „Alice fragt: Bist du dabei?“ – Antippen öffnet den Plan mit der Antwortkarte.
-- Wie `remind_poll`: höchstens alle 6 Stunden je Plan, nur solange der Plan nicht begonnen hat und weder
-- abgeschlossen noch abgesagt ist. Gefragt wird nur, wer noch Mitglied der Crew ist und den Status
-- „eingeladen“ hat – wer zugesagt, abgesagt oder „vielleicht“ gesagt hat, bekommt nichts.
-- Eigene Gruppe „Nachfragen zu Plänen“ in den Einstellungen (`plan_reminder`).

-- Wann zuletzt nachgefragt wurde, je Plan. Nur intern (über die API weder lesbar noch beschreibbar).
create table public.plan_reminders (
  plan_id uuid primary key references public.plans (id) on delete cascade,
  last_sent_at timestamptz not null default now()
);

alter table public.plan_reminders enable row level security;
revoke all on table public.plan_reminders from public, anon, authenticated;

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
  if not ('plan_reminder' = any (v_types)) then
    v_types := v_types || 'plan_reminder'::text;
  end if;
  alter table public.notifications drop constraint notifications_type_check;
  execute format('alter table public.notifications add constraint notifications_type_check check (type = any (%L::text[]))', v_types);
end $$;

-- Fragt alle ohne Antwort. Liefert die Zahl der gefragten Personen (0, wenn alle geantwortet haben –
-- dann zählt es auch nicht als Nachfrage, damit nach einer neuen Einladung gleich wieder gefragt werden kann).
create function public.remind_plan(p_plan_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
  v_member record;
  v_count integer := 0;
begin
  perform app_private.rate_limit('remind_plan', 30, interval '1 hour');

  select * into v_plan from public.plans p where p.id = p_plan_id;
  if not found or not app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.forbid();
  end if;
  if not (v_plan.created_by is not distinct from v_uid
          or app_private.has_crew_role(v_plan.crew_id, array['owner', 'admin']::public.crew_role[])) then
    perform app_private.forbid();
  end if;
  if v_plan.status in ('completed', 'cancelled') then
    perform app_private.fail('plan_locked');
  end if;
  if v_plan.starts_at <= now() then
    perform app_private.fail('plan_already_started');
  end if;

  -- Sperrt die Zeile je Plan – zwei gleichzeitige Tipps fragen nicht doppelt.
  insert into public.plan_reminders (plan_id, last_sent_at) values (p_plan_id, '-infinity')
  on conflict (plan_id) do nothing;
  perform 1 from public.plan_reminders r where r.plan_id = p_plan_id for update;
  if exists (select 1 from public.plan_reminders r
             where r.plan_id = p_plan_id and r.last_sent_at > now() - interval '6 hours') then
    perform app_private.fail('reminder_too_soon');
  end if;

  for v_member in
    select pp.user_id from public.plan_participants pp
    join public.crew_members m on m.crew_id = v_plan.crew_id and m.user_id = pp.user_id
    where pp.plan_id = p_plan_id and pp.attendance_status = 'invited' and pp.user_id <> v_uid
    order by pp.user_id
  loop
    perform app_private.notify(v_member.user_id, 'plan_reminder', v_uid, v_plan.crew_id, 'plan', p_plan_id,
                               jsonb_build_object('title', v_plan.title, 'starts_at', v_plan.starts_at),
                               'plan_reminder:' || p_plan_id::text || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    update public.plan_reminders r set last_sent_at = now() where r.plan_id = p_plan_id;
  end if;
  return v_count;
end $$;

revoke all on function public.remind_plan(uuid) from public, anon, authenticated;
grant execute on function public.remind_plan(uuid) to authenticated, service_role;
