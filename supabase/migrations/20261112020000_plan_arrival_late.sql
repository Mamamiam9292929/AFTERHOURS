-- P43 Etappe 2b · „Kommt später“ – Bescheid an die, die schon da sind
-- Wer schon am Tisch sitzt, schaut nicht dauernd auf die Planseite. Sagt jemand „Bin in 20 Min. da“, bekommen
-- alle, die vorher „Bin da“ gesagt haben, einmal Bescheid: „Carol kommt später – gegen 20:40“. Damit muss
-- niemand mehr in den Gruppenchat schreiben „bin 20 min später, fangt schon an“.
--
-- Bewusst so gebaut:
--   * Nur an die, die schon da sind (eigene Ansage „Bin da“ aus dem aktuellen Fenster, Zusage oder „Vielleicht“,
--     Mitglied der Crew) – nie an die Person selbst, nie an alle anderen. Wer noch unterwegs ist, braucht es nicht.
--   * Nur wenn es Neuigkeiten gibt: beim ersten „Bin in … da“ und wenn die angesagte Zeit danach um mindestens
--     5 Minuten später wird („noch später“). Früher kommen, zurücknehmen oder „Bin da“ schickt nichts – das sieht
--     man ohnehin, wenn die Person reinkommt.
--   * Höchstens drei Hinweise je Person, Abend und Empfänger:in, damit dauerndes Umstellen niemanden zuspammt.
--   * Kein Standort: Die Uhrzeit ist die eigene Ansage, vom Server gerechnet (P43 Etappe 1).
--   * Eigene Gruppe „Wer später kommt“ in den Einstellungen und je Gerät; stumme Crews (P35) bekommen keinen Push.
--   * Per Trigger auf `plan_arrivals` – gilt für jeden Weg, auf dem eine Ansage entsteht.

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
  if not ('plan_arrival_late' = any (v_types)) then
    v_types := v_types || 'plan_arrival_late'::text;
  end if;
  alter table public.notifications drop constraint notifications_type_check;
  execute format('alter table public.notifications add constraint notifications_type_check check (type = any (%L::text[]))', v_types);
end $$;

create function app_private.plan_arrival_late_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.plans%rowtype;
  v_from timestamptz;
  v_later boolean;
  v_to record;
begin
  if new.state <> 'late' or new.eta is null then
    return new;
  end if;
  v_later := tg_op = 'UPDATE' and old.state = 'late' and old.eta is not null;
  -- Gleiche oder frühere Zeit (bzw. nur wenige Minuten später): nichts Neues.
  if v_later and new.eta < old.eta + interval '5 minutes' then
    return new;
  end if;

  select * into v_plan from public.plans p where p.id = new.plan_id;
  if not found or not app_private.plan_arrival_open(v_plan) then
    return new;
  end if;
  v_from := app_private.plan_arrival_from(v_plan);

  for v_to in
    select a.user_id
    from public.plan_arrivals a
    join public.crew_members m on m.crew_id = v_plan.crew_id and m.user_id = a.user_id
    join public.plan_participants pp on pp.plan_id = a.plan_id and pp.user_id = a.user_id
                                     and pp.attendance_status in ('going', 'maybe')
    where a.plan_id = new.plan_id
      and a.user_id <> new.user_id
      and a.state = 'here'
      and a.updated_at >= v_from
      and (select count(*) from public.notifications n
           where n.user_id = a.user_id and n.type = 'plan_arrival_late'
             and n.related_entity_id = new.plan_id and n.actor_id = new.user_id) < 3
  loop
    perform app_private.notify(v_to.user_id, 'plan_arrival_late', new.user_id, v_plan.crew_id, 'plan', new.plan_id,
                               jsonb_build_object('title', v_plan.title, 'eta', new.eta, 'later', v_later),
                               'plan_arrival_late:' || new.plan_id::text || ':' || new.user_id::text || ':'
                                 || floor(extract(epoch from new.eta) / 60)::bigint::text);
  end loop;
  return new;
end $$;
revoke all on function app_private.plan_arrival_late_trigger() from public, anon, authenticated;

create trigger plan_arrivals_late_notify
after insert or update of state, eta on public.plan_arrivals
for each row execute function app_private.plan_arrival_late_trigger();

comment on function app_private.plan_arrival_late_trigger() is 'P43 Etappe 2b: „Kommt später“ an alle, die schon „Bin da“ gesagt haben – beim ersten „Bin in … da“ und wenn es mindestens 5 Minuten später wird, höchstens dreimal je Person und Abend.';
