-- P5 Etappe 2 · Wetter schon beim Abstimmen
-- In einer laufenden Abstimmung steht bei jedem Vorschlag mit Ort (aus Discover, mit Koordinaten) und
-- Termin das Wetter – damit es bei der Wahl hilft und nicht erst auf der Planseite. Gleicher Weg wie
-- beim Plan (20261019030000_plan_weather.sql): Die Edge Function `weather` fragt poll_weather mit dem
-- Token der Person, holt fehlende Tage bei Open-Meteo und legt sie mit store_weather_forecast für alle
-- ab. Ein Ort und ein Tag werden nur einmal abgefragt, egal wie viele Vorschläge oder Mitglieder.
--
-- Je Vorschlag kommt genau eine dieser Antworten (Vorschläge ohne Ort, ohne Koordinaten, ohne Datum
-- oder in der Vergangenheit fehlen – es wird nichts geraten):
--   too_far: Termin mehr als 14 Tage voraus, mit dem Tag, ab dem es eine Vorhersage gibt
--   fetch / cached: gerundeter Ort, Tag, Stunde (null, wenn der Vorschlag keine Uhrzeit hat),
--            draußen/drinnen und – falls frisch gespeichert – die Stundenwerte
--
-- Nur Mitglieder der Crew, nur laufende Abstimmungen. Gäste ohne Konto (W3) sehen kein Wetter.

create function public.poll_weather(p_poll uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_poll public.polls;
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_options jsonb;
begin
  perform app_private.require_user();
  select p.* into v_poll from public.polls p where p.id = p_poll;
  if v_poll.id is null or not app_private.is_crew_member(v_poll.crew_id) then
    perform app_private.forbid();
  end if;

  -- Die Abstimmung lädt bei jedem Öffnen; mehr als 120 Abfragen je Stunde sind kein Mensch.
  perform app_private.rate_limit('poll_weather', 120, interval '1 hour');

  if v_poll.status <> 'open' or v_poll.ends_at <= now() then
    return jsonb_build_object('status', 'closed');
  end if;

  with candidates as (
    select o.id, o.position, o.proposed_date as day, o.proposed_time,
           round(a.latitude::numeric, 2) as lat, round(a.longitude::numeric, 2) as lon, a.setting::text as setting
    from public.poll_options o
    join public.activities a on a.id = o.activity_id
    where o.poll_id = v_poll.id
      and o.proposed_date is not null
      and a.latitude is not null and a.longitude is not null
      -- Vorbei ist ein Termin drei Stunden nach seiner Uhrzeit; ohne Uhrzeit mit dem Ende des Tages.
      and o.proposed_date >= v_today
      and o.proposed_date + coalesce(o.proposed_time, time '21:00') + interval '3 hours' > (now() at time zone 'Europe/Berlin')
  )
  select coalesce(jsonb_agg(
    case when c.day > v_today + 14 then
      jsonb_build_object('option_id', c.id, 'status', 'too_far', 'available_from', c.day - 14, 'setting', c.setting)
    else
      jsonb_build_object(
        'option_id', c.id,
        'status', case when f.day is null then 'fetch' else 'cached' end,
        'latitude', c.lat,
        'longitude', c.lon,
        'day', c.day,
        'hour', case when c.proposed_time is null then null else extract(hour from c.proposed_time)::int end,
        'setting', c.setting,
        'hourly', f.hourly,
        'fetched_at', f.fetched_at)
    end order by c.position, c.id), '[]'::jsonb)
  into v_options
  from candidates c
  left join public.weather_forecasts f
    on c.day <= v_today + 14
   and f.latitude = c.lat and f.longitude = c.lon and f.day = c.day
   and f.fetched_at > now() - interval '3 hours';

  return jsonb_build_object('status', 'open', 'options', v_options);
end $$;

revoke all on function public.poll_weather(uuid) from public, anon, authenticated;
grant execute on function public.poll_weather(uuid) to authenticated, service_role;
