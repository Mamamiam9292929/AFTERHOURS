-- P26 · „Nur 6 Plätze“ – Höchstzahl mit Nachrückliste
-- Oft passt nur ein Tisch für sechs, eine Bowlingbahn für acht oder ein Auto voll. Bisher sagten dann einfach
-- mehr zu, als reinpassten, und jemand musste im Chat sortieren. Jetzt legt, wer organisiert (oder Owner/Admin
-- ist), eine Höchstzahl fest. Ist sie erreicht, stellt man sich statt „Bin dabei“ auf die Nachrückliste; sagt
-- jemand ab, rückt die erste Person von selbst nach und bekommt einmal „Du bist nachgerückt: …“.
--
-- Bewusst so gebaut:
--   * Gezählt wird wie bei „Wer kommt mit?“ und der Mindestzahl (P25): Zusagen der Crew plus Zusagen von Gästen
--     über den Link (W10). Die Grenze gilt für jeden Weg zu „Bin dabei“ (set_attendance, Gast-Link,
--     claim_plan_guest) – ein Trigger prüft sie, unter Sperre der Planzeile, damit zwei gleichzeitige Zusagen
--     nicht beide den letzten Platz bekommen. Wer schon dabei ist, bleibt dabei.
--   * Die Höchstzahl ist die echte Grenze der Runde: 2–50, nicht unter den aktuellen Zusagen und nicht unter
--     einer Mindestzahl. Keine künstliche Verknappung, kein Countdown.
--   * Nachrückliste = `plan_participants.waitlisted_at` (Reihenfolge nach Zeitpunkt). Wer sich einträgt, steht
--     bei der eigenen Antwort auf „Vielleicht“ (mit Liste), bis ein Platz frei wird. Wer absagt oder dann doch
--     „Bin dabei“ bekommt, steht nicht mehr auf der Liste. Etappe 1: nur Mitglieder; Gäste zählen mit, stehen
--     aber noch nicht auf der Liste (bei voller Runde bekommen sie „Leider voll“).
--   * Nachrücken, sobald ein Platz frei wird: Absage oder „Vielleicht“ einer Zusage, Austritt aus der Crew,
--     gelöschte Gast-Antwort, höhere oder keine Höchstzahl. Nur vor Beginn und nur bei offenen Plänen.
--     Benachrichtigung genau einmal je Plan und Person (Gruppe „Pläne“).
--   * „Alle neu fragen“ (P23) setzt Antworten auf „eingeladen“ zurück – dabei rückt niemand nach und die Liste
--     leert sich (alle werden für die neue Zeit neu gefragt).

alter table public.plans
  add column max_going smallint check (max_going is null or max_going between 2 and 50);

comment on column public.plans.max_going is 'P26: höchstens so viele Zusagen (Mitglieder + Gäste), sonst null.';

alter table public.plan_participants
  add column waitlisted_at timestamptz;

comment on column public.plan_participants.waitlisted_at is 'P26: seit wann auf der Nachrückliste (Reihenfolge), sonst null.';

create index plan_participants_waitlist_idx on public.plan_participants (plan_id, waitlisted_at) where waitlisted_at is not null;

-- Neuer Benachrichtigungstyp (bestehende Liste lesen und ergänzen, wie in 20261105060000).
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
  if not ('plan_waitlist_promoted' = any (v_types)) then
    v_types := v_types || 'plan_waitlist_promoted'::text;
  end if;
  alter table public.notifications drop constraint notifications_type_check;
  execute format('alter table public.notifications add constraint notifications_type_check check (type = any (%L::text[]))', v_types);
end $$;

-- „Du bist nachgerückt“ gehört zur Gruppe „Pläne“ – abgeschaltete Gruppen werden übernommen.
update public.user_settings s
set notification_preferences = s.notification_preferences || '{"plan_waitlist_promoted": false}'::jsonb
where s.notification_preferences ->> 'plan_created' = 'false';

update public.push_subscriptions d
set muted_types = (select array_agg(distinct t order by t) from unnest(d.muted_types || 'plan_waitlist_promoted'::text) t)
where 'plan_created' = any (d.muted_types) and not ('plan_waitlist_promoted' = any (d.muted_types));

-- Mindest- und Höchstzahl passen zusammen (für jeden Weg, auch set_plan_min_going).
create function app_private.plan_capacity_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.min_going is not null and new.max_going is not null and new.min_going > new.max_going then
    perform app_private.fail('plan_capacity_conflict');
  end if;
  return new;
end $$;
revoke all on function app_private.plan_capacity_check() from public, anon, authenticated;

create trigger plans_capacity_check
  before insert or update of min_going, max_going on public.plans
  for each row execute function app_private.plan_capacity_check();

-- Läuft gerade ein Umbau, der Plätze nur umschichtet (Gast-Antwort wird übernommen)? Dann prüfen und rücken
-- die Trigger nicht – die Funktion ruft das Nachrücken am Ende selbst auf.
create function app_private.plan_capacity_hold(p_plan_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(current_setting('app.plan_capacity_hold', true), '') = p_plan_id::text;
$$;
revoke all on function app_private.plan_capacity_hold(uuid) from public, anon, authenticated;

-- Vor jeder neuen Zusage: Ist noch Platz? Dazu Liste aufräumen (wer dabei ist oder absagt, wartet nicht mehr).
create function app_private.plan_capacity_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_max smallint;
begin
  if tg_table_name = 'plan_participants' then
    if new.attendance_status in ('going', 'declined', 'invited') then
      new.waitlisted_at := null;
    end if;
  end if;
  -- INSERT … ON CONFLICT (set_attendance): Gibt es die Zeile schon, prüft der UPDATE-Trigger danach mit der alten Antwort.
  -- (Verschachtelt: plan_guests hat keine Spalte user_id, PL/pgSQL plant jeden Ausdruck als Ganzes.)
  if tg_op = 'INSERT' and tg_table_name = 'plan_participants' then
    if exists (select 1 from public.plan_participants pp where pp.plan_id = new.plan_id and pp.user_id = new.user_id) then
      return new;
    end if;
  end if;
  if new.attendance_status = 'going' and (tg_op = 'INSERT' or old.attendance_status is distinct from 'going')
     and not app_private.plan_capacity_hold(new.plan_id) then
    -- Sperre: gleichzeitige Zusagen warten aufeinander und zählen danach richtig.
    select p.max_going into v_max from public.plans p where p.id = new.plan_id for update;
    if v_max is not null and app_private.plan_going_count(new.plan_id) >= v_max then
      perform app_private.fail('plan_full');
    end if;
  end if;
  return new;
end $$;
revoke all on function app_private.plan_capacity_guard() from public, anon, authenticated;

create trigger plan_participants_capacity
  before insert or update of attendance_status on public.plan_participants
  for each row execute function app_private.plan_capacity_guard();

create trigger plan_guests_capacity
  before insert or update of attendance_status on public.plan_guests
  for each row execute function app_private.plan_capacity_guard();

-- Freie Plätze an die Nachrückliste geben – in der Reihenfolge, in der sich alle eingetragen haben.
-- Liefert die Zahl der Nachgerückten.
create function app_private.promote_plan_waitlist(p_plan_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.plans%rowtype;
  v_next record;
  v_count integer := 0;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id for update;
  if not found or v_plan.status in ('completed', 'cancelled') or v_plan.starts_at <= now() then
    return 0;
  end if;

  loop
    if v_plan.max_going is not null and app_private.plan_going_count(p_plan_id) >= v_plan.max_going then
      exit;
    end if;
    select pp.user_id into v_next
    from public.plan_participants pp
    join public.crew_members m on m.crew_id = v_plan.crew_id and m.user_id = pp.user_id
    where pp.plan_id = p_plan_id and pp.waitlisted_at is not null
    order by pp.waitlisted_at, pp.user_id
    limit 1
    for update of pp;
    exit when not found;

    update public.plan_participants pp
    set attendance_status = 'going', responded_at = now(), waitlisted_at = null
    where pp.plan_id = p_plan_id and pp.user_id = v_next.user_id;
    v_count := v_count + 1;

    perform app_private.notify(v_next.user_id, 'plan_waitlist_promoted', null, v_plan.crew_id, 'plan', p_plan_id,
                               jsonb_build_object('title', v_plan.title, 'starts_at', v_plan.starts_at),
                               'plan_waitlist_promoted:' || p_plan_id::text || ':' || v_next.user_id::text);
  end loop;

  if v_count > 0 then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, crew_id, meta)
    values (null, 'plan_waitlist_promoted', 'plan', p_plan_id, v_plan.crew_id, jsonb_build_object('count', v_count));
  end if;
  return v_count;
end $$;
revoke all on function app_private.promote_plan_waitlist(uuid) from public, anon, authenticated;

-- Nach jeder Änderung, die einen Platz frei macht: nachrücken lassen.
create function app_private.plan_waitlist_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.attendance_status = 'going' and not app_private.plan_capacity_hold(old.plan_id) then
      perform app_private.promote_plan_waitlist(old.plan_id);
    end if;
    return old;
  end if;
  -- „eingeladen“ setzt nur „Alle neu fragen“ (P23) – dann rückt niemand nach.
  if old.attendance_status = 'going' and new.attendance_status not in ('going', 'invited')
     and not app_private.plan_capacity_hold(new.plan_id) then
    perform app_private.promote_plan_waitlist(new.plan_id);
  end if;
  return new;
end $$;
revoke all on function app_private.plan_waitlist_trigger() from public, anon, authenticated;

create trigger plan_participants_waitlist
  after update of attendance_status or delete on public.plan_participants
  for each row execute function app_private.plan_waitlist_trigger();

create trigger plan_guests_waitlist
  after update of attendance_status or delete on public.plan_guests
  for each row execute function app_private.plan_waitlist_trigger();

-- Höchstzahl setzen (2–50) oder entfernen (null). Liefert die aktuelle Zahl der Zusagen.
create function public.set_plan_max_going(p_plan_id uuid, p_max integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
  v_going integer;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id for update;
  if not found or not app_private.can_manage_plan(v_plan) then
    perform app_private.forbid();
  end if;
  if v_plan.status in ('completed', 'cancelled') then
    perform app_private.fail('plan_locked');
  end if;
  if v_plan.starts_at <= now() then
    perform app_private.fail('plan_max_going_started');
  end if;
  if p_max is not null and (p_max < 2 or p_max > 50) then
    perform app_private.fail('invalid_input');
  end if;
  v_going := app_private.plan_going_count(p_plan_id);
  if p_max is not null and p_max < v_going then
    perform app_private.fail('plan_max_below_going');
  end if;
  if p_max is not null and v_plan.min_going is not null and p_max < v_plan.min_going then
    perform app_private.fail('plan_capacity_conflict');
  end if;
  perform app_private.rate_limit('plan_max_going', 30, interval '1 hour');

  if p_max is distinct from v_plan.max_going then
    update public.plans p set max_going = p_max where p.id = p_plan_id;
    insert into public.audit_log (actor_id, action, entity_type, entity_id, crew_id, meta)
    values (v_uid, 'plan_max_going_set', 'plan', p_plan_id, v_plan.crew_id,
            jsonb_build_object('max_going', p_max, 'going', v_going));
    -- Mehr Plätze (oder keine Grenze mehr): die Liste rückt nach.
    if p_max is null or v_plan.max_going is null or p_max > v_plan.max_going then
      perform app_private.promote_plan_waitlist(p_plan_id);
      v_going := app_private.plan_going_count(p_plan_id);
    end if;
  end if;
  return v_going;
end $$;

-- Auf die Nachrückliste (nur wenn die Runde voll ist). Liefert den eigenen Platz auf der Liste (1 = als Nächstes).
create function public.join_plan_waitlist(p_plan_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
  v_row public.plan_participants%rowtype;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id for update;
  if not found or not app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.forbid();
  end if;
  if v_plan.status in ('completed', 'cancelled') then
    perform app_private.fail('plan_locked');
  end if;
  if v_plan.starts_at <= now() then
    perform app_private.fail('plan_waitlist_started');
  end if;
  select * into v_row from public.plan_participants pp where pp.plan_id = p_plan_id and pp.user_id = v_uid for update;
  if v_row.attendance_status = 'going' then
    perform app_private.fail('plan_waitlist_going');
  end if;
  if v_plan.max_going is null or app_private.plan_going_count(p_plan_id) < v_plan.max_going then
    perform app_private.fail('plan_not_full');
  end if;
  perform app_private.rate_limit('plan_waitlist', 30, interval '1 hour');

  if v_row.plan_id is null then
    insert into public.plan_participants (plan_id, user_id, attendance_status, responded_at)
    values (p_plan_id, v_uid, 'maybe', now());
  elsif v_row.attendance_status <> 'maybe' then
    update public.plan_participants pp set attendance_status = 'maybe', responded_at = now()
    where pp.plan_id = p_plan_id and pp.user_id = v_uid;
  end if;
  -- Erst nach dem Statuswechsel – der Trigger räumt die Liste bei „eingeladen“/„abgesagt“ auf.
  update public.plan_participants pp set waitlisted_at = coalesce(v_row.waitlisted_at, clock_timestamp())
  where pp.plan_id = p_plan_id and pp.user_id = v_uid;

  if v_row.waitlisted_at is null then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, crew_id, meta)
    values (v_uid, 'plan_waitlist_joined', 'plan', p_plan_id, v_plan.crew_id, '{}'::jsonb);
  end if;

  return (select count(*)::integer from public.plan_participants pp
          where pp.plan_id = p_plan_id and pp.waitlisted_at is not null
            and (pp.waitlisted_at, pp.user_id) <= ((select w.waitlisted_at from public.plan_participants w where w.plan_id = p_plan_id and w.user_id = v_uid), v_uid));
end $$;

-- Von der Nachrückliste (die Antwort „Vielleicht“ bleibt).
create function public.leave_plan_waitlist(p_plan_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id;
  if not found or not app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.forbid();
  end if;
  perform app_private.rate_limit('plan_waitlist', 30, interval '1 hour');
  update public.plan_participants pp set waitlisted_at = null
  where pp.plan_id = p_plan_id and pp.user_id = v_uid and pp.waitlisted_at is not null;
end $$;

-- Gast-Antwort übernehmen (W10, P24): wie bisher, aber der Platz wandert vom Gast zur Person – ohne dass die
-- Grenze dazwischen greift. Wird dabei ein Platz frei (Person hatte schon eine eigene Antwort), rückt die Liste nach.
create or replace function public.claim_plan_guest(p_plan_id uuid, p_secret text, p_keep boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
  v_guest public.plan_guests%rowtype;
  v_own public.attendance_status;
  v_claimed boolean := false;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id;
  if not found or not app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.forbid();
  end if;
  if v_plan.status in ('completed', 'cancelled') then
    perform app_private.fail('plan_locked');
  end if;
  if p_secret is null or p_secret !~ '^[0-9a-f]{64}$' or p_keep is null then
    perform app_private.fail('invalid_input');
  end if;
  perform app_private.rate_limit('plan_guest_claim', 20, interval '1 hour');

  select g.* into v_guest from public.plan_guests g
  where g.plan_id = v_plan.id and g.secret_hash = app_private.hash_token(p_secret)
  for update;
  if v_guest.id is null then
    perform app_private.fail('plan_guest_not_found');
  end if;

  select pp.attendance_status into v_own from public.plan_participants pp
  where pp.plan_id = v_plan.id and pp.user_id = v_uid and pp.attendance_status <> 'invited'
  for update;

  perform set_config('app.plan_capacity_hold', v_plan.id::text, true);
  if p_keep and v_own is null then
    insert into public.plan_participants (plan_id, user_id, attendance_status, responded_at)
    values (v_plan.id, v_uid, v_guest.attendance_status, now())
    on conflict (plan_id, user_id) do update set attendance_status = excluded.attendance_status, responded_at = now();
    -- Erst nach dem Statuswechsel setzen – der Trigger leert den Zusatz bei jeder neuen Antwort.
    update public.plan_participants pp set note = v_guest.note where pp.plan_id = v_plan.id and pp.user_id = v_uid;
    v_own := v_guest.attendance_status;
    v_claimed := true;
  end if;

  delete from public.plan_guests g where g.id = v_guest.id;
  perform set_config('app.plan_capacity_hold', '', true);
  perform app_private.promote_plan_waitlist(v_plan.id);

  insert into public.audit_log (actor_id, action, entity_type, entity_id, crew_id, meta)
  values (v_uid, case when p_keep then 'plan_guest_claimed' else 'plan_guest_discarded' end, 'plan', v_plan.id, v_plan.crew_id,
          jsonb_build_object('claimed', v_claimed));

  return jsonb_build_object('claimed', v_claimed, 'status', v_own);
end $$;

revoke all on function
  public.set_plan_max_going(uuid, integer), public.join_plan_waitlist(uuid), public.leave_plan_waitlist(uuid),
  public.claim_plan_guest(uuid, text, boolean)
from public, anon, authenticated;
grant execute on function
  public.set_plan_max_going(uuid, integer), public.join_plan_waitlist(uuid), public.leave_plan_waitlist(uuid),
  public.claim_plan_guest(uuid, text, boolean)
to authenticated;
