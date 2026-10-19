-- P5 · Wetter für Plantag und Ort
-- Auf der Planseite steht unter „Wann?“ die Vorhersage für Beginn und Ort des Plans (Open-Meteo, frei
-- ohne Schlüssel). Abgefragt wird nicht aus dem Browser, sondern über die Edge Function `weather`:
-- So erfährt Open-Meteo weder IP-Adressen noch wer welchen Plan hat, nur einen gerundeten Ort (2
-- Nachkommastellen, rund 1 km) und einen Tag.
--
-- Ablauf:
--   1. plan_weather(p_plan) mit dem Token der Person: Darf sie den Plan sehen? Hat der Plan einen Ort
--      mit Koordinaten? Liegt der Beginn im Vorhersagezeitraum (bis 14 Tage voraus, nicht vorbei)?
--      Liegt für Ort und Tag schon eine frische Vorhersage (jünger als 3 Stunden) im Speicher, kommt
--      sie gleich mit – sonst sagt die Antwort, was die Function abfragen soll.
--   2. store_weather_forecast (nur service_role): legt die Stundenwerte des Tages ab, damit die
--      ganze Crew mit einer Abfrage auskommt.
--
-- Nichts davon wird erfunden: Fehlt der Ort, ist der Plan zu weit weg oder liefert Open-Meteo nichts,
-- zeigt die App das so an.

create table public.weather_forecasts (
  latitude numeric(5, 2) not null check (latitude between -90 and 90),
  longitude numeric(5, 2) not null check (longitude between -180 and 180),
  day date not null,
  -- [{ "hour": 0–23, "temperature": °C, "precipitation_probability": 0–100, "weather_code": WMO, "wind_speed": km/h }]
  hourly jsonb not null check (jsonb_typeof(hourly) = 'array' and jsonb_array_length(hourly) between 1 and 24),
  fetched_at timestamptz not null default now(),
  primary key (latitude, longitude, day)
);
alter table public.weather_forecasts enable row level security;
revoke all on table public.weather_forecasts from public, anon, authenticated;

-- Was die Function für einen Plan tun soll – und, wenn vorhanden, die gespeicherte Vorhersage.
create function public.plan_weather(p_plan uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans;
  v_lat numeric(5, 2);
  v_lon numeric(5, 2);
  v_setting text;
  v_local timestamp;
  v_day date;
  v_cached public.weather_forecasts;
begin
  select p.* into v_plan from public.plans p where p.id = p_plan;
  if v_plan.id is null or not app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.forbid();
  end if;

  -- Die Planseite fragt bei jedem Öffnen; mehr als 120 Abfragen je Stunde sind kein Mensch.
  perform app_private.rate_limit('plan_weather', 120, interval '1 hour');

  if v_plan.status in ('cancelled', 'completed') or coalesce(v_plan.ends_at, v_plan.starts_at + interval '3 hours') < now() then
    return jsonb_build_object('status', 'past');
  end if;

  select round(a.latitude::numeric, 2), round(a.longitude::numeric, 2), a.setting::text
    into v_lat, v_lon, v_setting
  from public.activities a where a.id = v_plan.activity_id;
  if v_lat is null or v_lon is null then
    return jsonb_build_object('status', 'no_location');
  end if;

  v_local := v_plan.starts_at at time zone 'Europe/Berlin';
  v_day := v_local::date;
  if v_plan.starts_at > now() + interval '14 days' then
    return jsonb_build_object('status', 'too_far', 'available_from', v_plan.starts_at - interval '14 days', 'setting', v_setting);
  end if;

  select f.* into v_cached from public.weather_forecasts f
  where f.latitude = v_lat and f.longitude = v_lon and f.day = v_day and f.fetched_at > now() - interval '3 hours';

  return jsonb_build_object(
    'status', case when v_cached.day is null then 'fetch' else 'cached' end,
    'latitude', v_lat,
    'longitude', v_lon,
    'day', v_day,
    'hour', extract(hour from v_local)::int,
    'setting', v_setting,
    'hourly', v_cached.hourly,
    'fetched_at', v_cached.fetched_at);
end $$;

-- Ablage der Stundenwerte eines Tages (nur die Edge Function mit service_role).
create function public.store_weather_forecast(p_latitude numeric, p_longitude numeric, p_day date, p_hourly jsonb) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  v_at timestamptz := now();
begin
  if p_latitude is null or p_longitude is null or p_day is null
     or p_hourly is null or jsonb_typeof(p_hourly) <> 'array' or jsonb_array_length(p_hourly) not between 1 and 24
     or exists (select 1 from jsonb_array_elements(p_hourly) h
                where case when jsonb_typeof(h) = 'object' and jsonb_typeof(h -> 'hour') = 'number'
                           then (h ->> 'hour')::numeric not between 0 and 23
                           else true end) then
    perform app_private.fail('invalid_forecast');
  end if;

  insert into public.weather_forecasts as f (latitude, longitude, day, hourly, fetched_at)
  values (round(p_latitude, 2), round(p_longitude, 2), p_day, p_hourly, v_at)
  on conflict (latitude, longitude, day) do update set hourly = excluded.hourly, fetched_at = excluded.fetched_at;

  -- Vergangene Tage braucht niemand mehr.
  delete from public.weather_forecasts f where f.day < (now() at time zone 'Europe/Berlin')::date - 1;
  return v_at;
end $$;

revoke all on function public.plan_weather(uuid) from public, anon, authenticated;
revoke all on function public.store_weather_forecast(numeric, numeric, date, jsonb) from public, anon, authenticated;
grant execute on function public.plan_weather(uuid) to authenticated, service_role;
grant execute on function public.store_weather_forecast(numeric, numeric, date, jsonb) to service_role;
