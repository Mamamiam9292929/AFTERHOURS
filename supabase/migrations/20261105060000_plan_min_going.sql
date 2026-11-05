-- P25 · „Findet statt ab 4“ – Mindestzahl für einen Plan
-- Im Gruppenchat heißt es oft „wenn mindestens vier mitkommen, reserviere ich“ – und dann zählt jemand
-- von Hand nach. Jetzt legt, wer organisiert (oder Owner/Admin ist), eine Mindestzahl fest. Alle sehen auf
-- der Planseite „Noch 2 fehlen“; sobald genug zugesagt haben, bekommt die Runde einmal Bescheid:
-- „Es findet statt: Bowling“.
--
-- Bewusst so gebaut:
--   * Gezählt wird wie bei „Wer kommt mit?“: alle Zusagen („Bin dabei“) der Crew plus Zusagen von Gästen über
--     den Link (W10). „Vielleicht“ zählt nicht.
--   * Die Benachrichtigung kommt genau einmal je Plan und Mindestzahl – auch wenn danach jemand absagt und
--     wieder zusagt. Wer die Zahl ändert, setzt das zurück. Ist die neue Zahl beim Speichern schon erreicht,
--     gilt sie still als erreicht (die Planseite zeigt „Findet statt“), damit niemand für eine Einstellung
--     angepingt wird.
--   * Bescheid bekommen alle Mitglieder der Crew mit Zeile am Plan, die nicht abgesagt haben – wer noch nicht
--     geantwortet hat, liest „Bist du auch dabei?“. Gruppe „Pläne“ in den Einstellungen.
--   * Geprüft wird per Trigger nach jeder Antwort (Mitglieder und Gäste) – damit gilt es für jeden Weg
--     (set_attendance, Gast-Link, claim_plan_guest, Plan aus Abstimmung).
--   * Nur vor Beginn und nur bei Plänen, die weder abgeschlossen noch abgesagt sind. Mindestzahl 2–50.

alter table public.plans
  add column min_going smallint check (min_going is null or min_going between 2 and 50),
  add column min_going_reached_at timestamptz;

comment on column public.plans.min_going is 'P25: Plan findet ab so vielen Zusagen statt (Mitglieder + Gäste), sonst null.';
comment on column public.plans.min_going_reached_at is 'P25: wann die Mindestzahl erreicht wurde (Benachrichtigung verschickt bzw. beim Setzen schon erreicht).';

-- Neuer Benachrichtigungstyp (bestehende Liste lesen und ergänzen, wie in 20261103160000).
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
  if not ('plan_quorum' = any (v_types)) then
    v_types := v_types || 'plan_quorum'::text;
  end if;
  alter table public.notifications drop constraint notifications_type_check;
  execute format('alter table public.notifications add constraint notifications_type_check check (type = any (%L::text[]))', v_types);
end $$;

-- „Es findet statt“ gehört zur Gruppe „Pläne“. Wer die Gruppe abgeschaltet hat (in der App oder als Push auf
-- einem Gerät), bekommt auch die neue Art nicht.
update public.user_settings s
set notification_preferences = s.notification_preferences || '{"plan_quorum": false}'::jsonb
where s.notification_preferences ->> 'plan_created' = 'false';

update public.push_subscriptions d
set muted_types = (select array_agg(distinct t order by t) from unnest(d.muted_types || 'plan_quorum'::text) t)
where 'plan_created' = any (d.muted_types) and not ('plan_quorum' = any (d.muted_types));

-- Zusagen eines Plans: Mitglieder mit „Bin dabei“ + Gäste mit „Bin dabei“ (wie „Wer kommt mit?“).
create function app_private.plan_going_count(p_plan_id uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select (select count(*) from public.plan_participants pp where pp.plan_id = p_plan_id and pp.attendance_status = 'going')::integer
       + (select count(*) from public.plan_guests g where g.plan_id = p_plan_id and g.attendance_status = 'going')::integer;
$$;
revoke all on function app_private.plan_going_count(uuid) from public, anon, authenticated;

-- Ist die Mindestzahl gerade erreicht worden? Dann einmal Bescheid geben.
create function app_private.check_plan_min_going(p_plan_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.plans%rowtype;
  v_going integer;
  v_member record;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id;
  if not found or v_plan.min_going is null or v_plan.min_going_reached_at is not null
     or v_plan.status in ('completed', 'cancelled') or v_plan.starts_at <= now() then
    return;
  end if;
  v_going := app_private.plan_going_count(p_plan_id);
  if v_going < v_plan.min_going then
    return;
  end if;

  update public.plans p set min_going_reached_at = now()
  where p.id = p_plan_id and p.min_going_reached_at is null;
  if not found then
    return;
  end if;

  for v_member in
    select pp.user_id, pp.attendance_status from public.plan_participants pp
    join public.crew_members m on m.crew_id = v_plan.crew_id and m.user_id = pp.user_id
    where pp.plan_id = p_plan_id and pp.attendance_status <> 'declined'
  loop
    perform app_private.notify(v_member.user_id, 'plan_quorum', null, v_plan.crew_id, 'plan', p_plan_id,
                               jsonb_build_object('title', v_plan.title, 'starts_at', v_plan.starts_at, 'going', v_going,
                                                  'min_going', v_plan.min_going, 'answered', v_member.attendance_status <> 'invited'),
                               'plan_quorum:' || p_plan_id::text || ':' || v_plan.min_going::text);
  end loop;
end $$;
revoke all on function app_private.check_plan_min_going(uuid) from public, anon, authenticated;

create function app_private.plan_min_going_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    return old;  -- weniger Zusagen erreichen nie eine Mindestzahl
  end if;
  if new.attendance_status = 'going' and (tg_op = 'INSERT' or old.attendance_status is distinct from 'going') then
    perform app_private.check_plan_min_going(new.plan_id);
  end if;
  return new;
end $$;
revoke all on function app_private.plan_min_going_trigger() from public, anon, authenticated;

create trigger plan_participants_min_going
  after insert or update of attendance_status on public.plan_participants
  for each row execute function app_private.plan_min_going_trigger();

create trigger plan_guests_min_going
  after insert or update of attendance_status on public.plan_guests
  for each row execute function app_private.plan_min_going_trigger();

-- Mindestzahl setzen (2–50) oder entfernen (null). Liefert die aktuelle Zahl der Zusagen.
create function public.set_plan_min_going(p_plan_id uuid, p_min integer) returns integer
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
    perform app_private.fail('plan_min_going_started');
  end if;
  if p_min is not null and (p_min < 2 or p_min > 50) then
    perform app_private.fail('invalid_input');
  end if;
  perform app_private.rate_limit('plan_min_going', 30, interval '1 hour');

  v_going := app_private.plan_going_count(p_plan_id);
  if p_min is distinct from v_plan.min_going then
    update public.plans p
    set min_going = p_min,
        min_going_reached_at = case when p_min is not null and v_going >= p_min then now() end
    where p.id = p_plan_id;

    insert into public.audit_log (actor_id, action, entity_type, entity_id, crew_id, meta)
    values (v_uid, 'plan_min_going_set', 'plan', p_plan_id, v_plan.crew_id,
            jsonb_build_object('min_going', p_min, 'going', v_going));
  end if;
  return v_going;
end $$;

revoke all on function public.set_plan_min_going(uuid, integer) from public, anon, authenticated;
grant execute on function public.set_plan_min_going(uuid, integer) to authenticated;
