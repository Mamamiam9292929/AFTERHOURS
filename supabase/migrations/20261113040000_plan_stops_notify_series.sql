-- P50 Etappe 2a · Stationen: Bescheid am Abend und nächste Runde einer Serie
-- Etappe 1 (#261) hat die Stationen eines Abends auf die Planseite gebracht. Zwei Lücken blieben:
--   1. Kommt am Abend selbst eine Station dazu („wir ziehen weiter in die Bar Raval“), erfuhr das nur, wer die
--      Planseite gerade offen hatte – alle anderen fragten wieder im Gruppenchat. Jetzt bekommen alle mit Zusage
--      Bescheid.
--   2. Bei regelmäßigen Plänen (P8, „jeden ersten Freitag: erst Essen, dann Kneipe“) fehlten die Stationen in der
--      nächsten Runde und mussten jede Woche neu eingetragen werden. Jetzt übernimmt die neue Runde sie.
--
-- Bewusst so gebaut:
--   * Bescheid nur „am Abend“: ab 3 Stunden vor Beginn bis 18 Stunden danach (so lange darf eine Station nach dem
--     Beginn liegen). Wer Tage vorher die Stationen plant, plant – das sieht die Crew auf der Planseite, ohne dass
--     bei jedem Eintrag das Handy brummt.
--   * Nur an Personen mit „Bin dabei“, die noch in der Crew sind, nie an die Person, die die Station einträgt.
--     „Vielleicht“ und „Kann nicht“ betrifft der Ortswechsel nicht; Gäste haben kein Konto.
--   * Keine neue Art: `plan_changed` mit `changed = ['stops']` und `stop`/`stop_at` in den Daten. So gilt der
--     Schalter „Pläne“ in den Einstellungen, Stummschalten der Crew (P35) und die Nachtruhe (P49) wie bei jeder
--     Planänderung. Je Station höchstens ein Hinweis (Schlüssel aus der ID der Station).
--   * `add_plan_stop` wird neu angelegt (gleiche Signatur, gleiche Prüfungen, gleiche Rechte), nur um den Hinweis
--     ergänzt. Die alte Migration bleibt unverändert.
--   * Serie: Ein Trigger nach dem Anlegen eines Plans mit Serie kopiert die Stationen der vorigen Runde (auch
--     wenn sie ausgesetzt oder abgesagt wurde – wie bei der Frist, P48). Uhrzeiten behalten ihren Abstand zum
--     Beginn in Berliner Ortszeit („22:30“ bleibt 22:30, auch über die Zeitumstellung). Passt eine Uhrzeit
--     danach nicht mehr in „nach Beginn, höchstens 18 h“, kommt die Station ohne Uhrzeit mit – lieber keine als
--     eine falsche. Hat die neue Runde schon Stationen, wird nichts kopiert. Kein Hinweis beim Kopieren.

-- Station anhängen (wie Etappe 1) – am Abend mit Bescheid an alle mit Zusage.
create or replace function public.add_plan_stop(p_plan_id uuid, p_title text, p_at timestamptz default null, p_address text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_plan public.plans%rowtype;
  v_title text := app_private.clean_line(p_title, 60);
  v_address text := app_private.clean_line(p_address, 200);
  v_id uuid;
  v_member record;
begin
  v_plan := app_private.plan_for_stops(p_plan_id);
  if v_title is null or char_length(v_title) < 2 then
    perform app_private.fail('invalid_plan_stop');
  end if;
  if p_at is not null and (p_at <= v_plan.starts_at or p_at > v_plan.starts_at + interval '18 hours') then
    perform app_private.fail('plan_stop_time');
  end if;
  -- Gleichzeitiges Anhängen zählt sauber gegen die Grenze.
  perform 1 from public.plans p where p.id = p_plan_id for update;
  if (select count(*) from public.plan_stops s where s.plan_id = p_plan_id) >= 4 then
    perform app_private.fail('plan_stop_limit');
  end if;
  perform app_private.rate_limit('plan_stop', 30, interval '1 hour');

  insert into public.plan_stops (plan_id, title, at, address)
  values (p_plan_id, v_title, p_at, v_address)
  returning id into v_id;

  if app_private.plan_stop_notify_due(v_plan.starts_at, now()) then
    for v_member in
      select pp.user_id from public.plan_participants pp
      join public.crew_members m on m.crew_id = v_plan.crew_id and m.user_id = pp.user_id
      where pp.plan_id = p_plan_id and pp.attendance_status = 'going' and pp.user_id is distinct from v_uid
    loop
      perform app_private.notify(v_member.user_id, 'plan_changed', v_uid, v_plan.crew_id, 'plan', p_plan_id,
                                 jsonb_build_object('title', v_plan.title, 'changed', jsonb_build_array('stops'),
                                                    'stop', v_title, 'stop_at', p_at, 'starts_at', v_plan.starts_at),
                                 'plan_stop:' || v_id::text);
    end loop;
  end if;
  return v_id;
end $$;

-- „Am Abend“: ab 3 Stunden vor Beginn bis 18 Stunden danach.
create function app_private.plan_stop_notify_due(p_starts_at timestamptz, p_now timestamptz) returns boolean
language sql immutable set search_path = '' as $$
  select p_starts_at is not null and p_now >= p_starts_at - interval '3 hours' and p_now <= p_starts_at + interval '18 hours';
$$;

-- Uhrzeit einer Station in der nächsten Runde: gleicher Abstand zum Beginn in Berliner Ortszeit; passt sie nicht
-- mehr in „nach Beginn, höchstens 18 h“, dann ohne Uhrzeit.
create function app_private.plan_series_stop_at(p_prev_starts_at timestamptz, p_prev_at timestamptz, p_starts_at timestamptz)
returns timestamptz
language plpgsql immutable set search_path = '' as $$
declare
  v_at timestamptz;
begin
  if p_prev_starts_at is null or p_prev_at is null or p_starts_at is null then
    return null;
  end if;
  v_at := ((p_starts_at at time zone 'Europe/Berlin')
           + ((p_prev_at at time zone 'Europe/Berlin') - (p_prev_starts_at at time zone 'Europe/Berlin')))
          at time zone 'Europe/Berlin';
  if v_at <= p_starts_at or v_at > p_starts_at + interval '18 hours' then
    return null;
  end if;
  return v_at;
end $$;

create function app_private.plan_series_stops_inherit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_prev public.plans%rowtype;
begin
  if new.series_id is null then
    return null;
  end if;
  if exists (select 1 from public.plan_stops s where s.plan_id = new.id) then
    return null;
  end if;
  select * into v_prev from public.plans p
  where p.series_id = new.series_id and p.id <> new.id and p.starts_at < new.starts_at
  order by p.starts_at desc, p.created_at desc limit 1;
  if not found then
    return null;
  end if;
  insert into public.plan_stops (plan_id, title, at, address, created_at)
  select new.id, s.title, app_private.plan_series_stop_at(v_prev.starts_at, s.at, new.starts_at), s.address,
         -- Reihenfolge ohne Uhrzeit bleibt wie in der vorigen Runde.
         now() + (row_number() over (order by s.at nulls last, s.created_at, s.id)) * interval '1 microsecond'
  from public.plan_stops s
  where s.plan_id = v_prev.id
  order by s.at nulls last, s.created_at, s.id
  limit 4;
  return null;
end $$;

create trigger plans_series_stops
  after insert on public.plans
  for each row execute function app_private.plan_series_stops_inherit();

revoke all on function app_private.plan_stop_notify_due(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function app_private.plan_series_stop_at(timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function app_private.plan_series_stops_inherit() from public, anon, authenticated;
revoke all on function public.add_plan_stop(uuid, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.add_plan_stop(uuid, text, timestamptz, text) to authenticated, service_role;

comment on function public.add_plan_stop(uuid, text, timestamptz, text) is 'P50: weitere Station des Abends anhängen (Organisator:in, Owner, Admins; höchstens 4; Uhrzeit nach Beginn, höchstens 18 h danach). Etappe 2a: am Abend Bescheid an alle mit Zusage.';
comment on function app_private.plan_series_stops_inherit() is 'P50 Etappe 2a: neue Runde einer Serie übernimmt die Stationen der vorigen (Uhrzeit in Berliner Ortszeit).';
