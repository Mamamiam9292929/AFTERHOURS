-- P50 Etappe 2b · Stationen auch auf der Zusagekarte für Gäste (`/s/<token>`) und im Kalender-Abo
-- Wer über den Link ohne Konto zugesagt hat oder den Abend nur im Kalender hat, sah bisher nur den ersten Ort –
-- „wo geht's danach hin?“ lief dann wieder über den Gruppenchat. Jetzt liefern beide Wege die Stationen mit.
--
-- Bewusst so gebaut:
--   * Zusagekarte (`shared_plan_rsvp`): Stationen nur, wo heute schon Ort, Adresse und Treffpunkt stehen – also nur,
--     wenn Gäste für den Plan freigeschaltet sind. Die öffentliche Vorschau (`preview_shared_plan`, Messenger)
--     bleibt ohne Ort und damit auch ohne Stationen.
--   * Kalender-Abo (`calendar_feed_events`): je Plan die Stationen; nur für die Person, der das Abo gehört, und nur
--     Pläne, die sie ohnehin sieht. Stationen enthalten keine Personen.
--   * Reihenfolge wie auf der Planseite (`sortStops`): mit Uhrzeit früh → spät, danach ohne Uhrzeit in
--     Eintragsreihenfolge. Je Station nur Name, Uhrzeit und Adresse – keine ID.
-- Ersetzt `shared_plan_rsvp` aus 20261109100000 und `calendar_feed_events` aus 20261029140000 (gleiche Signatur,
-- Rechte unten trotzdem ausdrücklich gesetzt).

-- Stationen eines Plans als JSON-Liste (leer: []).
create function app_private.plan_stops_json(p_plan_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('title', s.title, 'at', s.at, 'address', s.address)
                            order by s.at nulls last, s.created_at, s.id), '[]'::jsonb)
  from public.plan_stops s
  where s.plan_id = p_plan_id
$$;
revoke all on function app_private.plan_stops_json(uuid) from public, anon, authenticated;

create or replace function public.shared_plan_rsvp(p_token text, p_secret text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.plans;
  v_guest public.plan_guests;
  v_place text;
begin
  v_plan := app_private.plan_by_share_token(p_token);
  if v_plan.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if coalesce(v_plan.ends_at, v_plan.starts_at) < now() - interval '3 days' then
    return jsonb_build_object('status', 'expired');
  end if;

  perform app_private.rate_limit_key(p_token, 'plan_guest_rsvp_read', 240, interval '10 minutes');
  if not v_plan.guests_allowed then
    return jsonb_build_object('status', 'guests_off');
  end if;

  if p_secret ~ '^[0-9a-f]{64}$' then
    select g.* into v_guest from public.plan_guests g
    where g.plan_id = v_plan.id and g.secret_hash = app_private.hash_token(p_secret);
  end if;
  select a.name into v_place from public.activities a where a.id = v_plan.activity_id;

  return jsonb_build_object(
    'status', 'valid',
    'plan', jsonb_build_object(
      'title', v_plan.title,
      'starts_at', v_plan.starts_at,
      'ends_at', v_plan.ends_at,
      'status', v_plan.status,
      'open', app_private.plan_guests_open(v_plan),
      'place', v_place,
      'address', v_plan.address,
      'meeting_point', v_plan.meeting_point,
      'can_join', app_private.plan_guest_join_open(v_plan),
      -- P50 Etappe 2b: weitere Stationen des Abends (Name, Uhrzeit, Adresse).
      'stops', app_private.plan_stops_json(v_plan.id)),
    'counts', (
      select jsonb_build_object(
               'going', count(*) filter (where x.s = 'going'),
               'maybe', count(*) filter (where x.s = 'maybe'))
      from (select pp.attendance_status as s from public.plan_participants pp where pp.plan_id = v_plan.id
            union all
            select g.attendance_status from public.plan_guests g where g.plan_id = v_plan.id) x),
    'me', case when v_guest.id is null then null else jsonb_strip_nulls(jsonb_build_object(
      'name', v_guest.display_name,
      'status', v_guest.attendance_status,
      'note', v_guest.note,
      'waitlist', case when v_guest.waitlisted_at is not null then app_private.plan_waitlist_position(v_plan.id, null, v_guest.id) end,
      'promoted', case when v_guest.promoted_at is not null and v_guest.attendance_status = 'going' then true end)) end);
end $$;
revoke all on function public.shared_plan_rsvp(text, text) from public, anon, authenticated;
grant execute on function public.shared_plan_rsvp(text, text) to anon, authenticated;

create or replace function public.calendar_feed_events(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_feed public.calendar_feeds;
begin
  -- Alles, was kein Token sein kann, wird gar nicht erst gesucht (und schreibt nichts).
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'not_found');
  end if;

  select f.* into v_feed from public.calendar_feeds f where f.token = p_token;
  if v_feed.user_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Kalender fragen alle paar Minuten bis Stunden; mehr als 60 Abrufe in 10 Minuten sind kein Kalender.
  perform app_private.rate_limit_key(p_token, 'calendar_feed', 60, interval '10 minutes');

  -- „Zuletzt abgerufen“ höchstens einmal je Viertelstunde schreiben.
  if v_feed.last_used_at is null or v_feed.last_used_at < now() - interval '15 minutes' then
    update public.calendar_feeds f set last_used_at = now() where f.user_id = v_feed.user_id;
  end if;

  return jsonb_build_object(
    'status', 'valid',
    -- P11 Etappe 2a: Sprache im Profil der Person, der das Abo gehört (null → Deutsch).
    'locale', (select s.locale from public.user_settings s where s.user_id = v_feed.user_id),
    'events', coalesce((
      select jsonb_agg(e.event order by e.starts_at, e.id)
      from (
        select p.id, p.starts_at,
               jsonb_build_object(
                 'id', p.id,
                 'title', p.title,
                 'starts_at', p.starts_at,
                 'ends_at', p.ends_at,
                 'address', p.address,
                 'meeting_point', p.meeting_point,
                 'status', p.status,
                 'attendance', coalesce(pp.attendance_status::text, 'invited'),
                 'crew', c.name,
                 'created_at', p.created_at,
                 'updated_at', p.updated_at,
                 -- P50 Etappe 2b: weitere Stationen des Abends.
                 'stops', app_private.plan_stops_json(p.id)) as event
        from public.plans p
        join public.crews c on c.id = p.crew_id
        join public.crew_members m on m.crew_id = p.crew_id and m.user_id = v_feed.user_id
        left join public.plan_participants pp on pp.plan_id = p.id and pp.user_id = v_feed.user_id
        where coalesce(p.ends_at, p.starts_at) >= now() - interval '60 days'
          and pp.attendance_status is distinct from 'declined'
        order by p.starts_at
        limit 300
      ) e), '[]'::jsonb));
end $$;
revoke all on function public.calendar_feed_events(text) from public, anon, authenticated;
grant execute on function public.calendar_feed_events(text) to anon, authenticated, service_role;

comment on function app_private.plan_stops_json(uuid) is 'P50 Etappe 2b: Stationen eines Plans (Name, Uhrzeit, Adresse) in der Reihenfolge des Abends.';
