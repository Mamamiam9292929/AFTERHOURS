-- =============================================================================================
-- AFTERHOURS – Stadtsuche mit Ersatz (Roadmap O2)
--
-- Die Edge Function "places" sucht eine Stadt jetzt der Reihe nach bei Nominatim, in den schon
-- importierten Regionen und bei Photon (geocode.ts). Diese Migration
--   1. gibt der Edge Function die gespeicherte OSM-Kennung einer schon bekannten Stadt
--      (known_place_region, nur service_role),
--   2. protokolliert die Versuche der Stadtsuche getrennt von Overpass und den Schritt, an dem ein
--      Import gescheitert ist (neue Spalten in place_sync_runs, record_place_sync_run mit 8 Angaben),
--   3. zeigt Admins die Fehlerquote getrennt nach Stadtsuche und Overpass (admin_place_sync_health).
--
-- Bestehende Einträge bleiben unverändert (stage = null: vor O2 nicht unterschieden). Die bisherige
-- Funktion record_place_sync_run mit 6 Angaben bleibt bestehen, damit eine ältere Edge Function bis
-- zu ihrem Deploy weiter protokollieren kann.
-- =============================================================================================

alter table public.place_sync_runs
  -- Schritt, an dem ein Import gescheitert ist; null bei Erfolg oder vor O2.
  add column stage text check (stage is null or stage in ('geocode', 'overpass')),
  -- Versuche der Stadtsuche, gleiche Form wie attempts; Host "db" = gespeicherte Region.
  add column geocode_attempts jsonb not null default '[]'
    check (jsonb_typeof(geocode_attempts) = 'array' and jsonb_array_length(geocode_attempts) <= 3),
  -- Wer die Stadt geliefert hat (Hostname oder "db"), nur bei gefundener Stadt.
  add column geocoder text check (geocoder is null or geocoder ~ '^[a-z0-9.-]{1,120}(:[0-9]{1,5})?$'),
  add column geocode_fallback boolean not null default false;

-- ---------------------------------------------------------------------------------------------
-- Gespeicherte OSM-Kennung einer Stadt (nur service_role). Ergebnis: null oder
-- {"name","osm_type","osm_id","latitude","longitude"}.
-- ---------------------------------------------------------------------------------------------
create function public.known_place_region(p_city text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_region public.place_regions;
begin
  v_region := app_private.place_region_by_key(app_private.place_key(p_city));
  if v_region.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'name', v_region.name, 'osm_type', v_region.osm_type, 'osm_id', v_region.osm_id,
    'latitude', v_region.latitude, 'longitude', v_region.longitude);
end $$;

revoke all on function public.known_place_region(text) from public, anon, authenticated;
grant execute on function public.known_place_region(text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- Bereinigt eine Liste von Versuchen ([{host, result, ms}]) auf höchstens p_max Einträge.
-- ---------------------------------------------------------------------------------------------
create function app_private.clean_sync_attempts(p_attempts jsonb, p_max integer) returns jsonb
language plpgsql immutable security definer set search_path = '' as $$
declare
  v_attempts jsonb := '[]';
  v_item jsonb;
  v_host text;
  v_result text;
begin
  if jsonb_typeof(p_attempts) <> 'array' then
    return v_attempts;
  end if;
  for v_item in select e.value from jsonb_array_elements(p_attempts) with ordinality as e(value, n) where e.n <= p_max order by e.n
  loop
    v_host := lower(coalesce(v_item ->> 'host', ''));
    v_result := v_item ->> 'result';
    if v_host !~ '^[a-z0-9.-]{1,120}(:[0-9]{1,5})?$' then v_host := 'unknown'; end if;
    if v_result is null or v_result not in ('ok', 'busy', 'timeout', 'unavailable') then v_result := 'unavailable'; end if;
    v_attempts := v_attempts || jsonb_build_array(jsonb_build_object(
      'host', v_host, 'result', v_result,
      'ms', case when jsonb_typeof(v_item -> 'ms') = 'number'
                then least(greatest((v_item ->> 'ms')::numeric, 0), 600000)::integer else 0 end));
  end loop;
  return v_attempts;
end $$;

revoke all on function app_private.clean_sync_attempts(jsonb, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Schreiben (nur service_role): wie bisher, dazu Stadtsuche und Schritt des Fehlschlags.
-- ---------------------------------------------------------------------------------------------
create function public.record_place_sync_run(
  p_city text, p_region uuid, p_outcome text, p_error text, p_attempts jsonb, p_duration_ms integer,
  p_geocode_attempts jsonb, p_stage text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_city text;
  v_attempts jsonb := app_private.clean_sync_attempts(p_attempts, 4);
  v_geocode jsonb := app_private.clean_sync_attempts(p_geocode_attempts, 3);
  v_endpoint text;
  v_fallback boolean := false;
  v_geocoder text;
  v_geocode_fallback boolean := false;
begin
  if p_outcome is null or p_outcome not in ('ready', 'failed') then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;

  begin
    v_city := app_private.place_key(p_city);
  exception when others then
    v_city := null;
  end;

  -- Erster erfolgreicher Overpass-Server; Ersatz, wenn es nicht der erste Versuch war.
  select e.value ->> 'host', e.n > 1 into v_endpoint, v_fallback
  from jsonb_array_elements(v_attempts) with ordinality as e(value, n)
  where e.value ->> 'result' = 'ok' order by e.n limit 1;

  -- Wer die Stadt geliefert hat: der letzte erfolgreiche Versuch (davor sind alle gescheitert).
  -- Nur, wenn die Stadtsuche nicht der gescheiterte Schritt war.
  if p_stage is distinct from 'geocode' then
    select e.value ->> 'host', e.n > 1 into v_geocoder, v_geocode_fallback
    from jsonb_array_elements(v_geocode) with ordinality as e(value, n)
    where e.value ->> 'result' = 'ok' order by e.n desc limit 1;
  end if;

  insert into public.place_sync_runs (
    region_id, city, outcome, error, endpoint, fallback_used, attempts, duration_ms,
    stage, geocode_attempts, geocoder, geocode_fallback)
  values (
    (select r.id from public.place_regions r where r.id = p_region),
    v_city,
    p_outcome,
    case when p_outcome = 'failed' then coalesce(substring(lower(coalesce(p_error, '')) from '^[a-z_]{1,40}$'), 'unknown') end,
    case when p_outcome = 'ready' then v_endpoint end,
    p_outcome = 'ready' and coalesce(v_fallback, false),
    v_attempts,
    least(greatest(coalesce(p_duration_ms, 0), 0), 600000),
    case when p_outcome = 'failed' and p_stage in ('geocode', 'overpass') then p_stage end,
    v_geocode,
    v_geocoder,
    coalesce(v_geocode_fallback, false) and v_geocoder is not null
  );

  delete from public.place_sync_runs where created_at < now() - interval '90 days';
end $$;

revoke all on function public.record_place_sync_run(text, uuid, text, text, jsonb, integer, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_place_sync_run(text, uuid, text, text, jsonb, integer, jsonb, text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- Lesen (nur Admins): wie bisher, dazu Fehlschläge je Schritt und die Server der Stadtsuche.
-- ---------------------------------------------------------------------------------------------
create or replace function public.admin_place_sync_health(p_days integer default 7) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 7), 1), 90);
  v_since timestamptz := now() - make_interval(days => v_days);
  v_runs integer;
  v_failed integer;
  v_rate numeric;
begin
  if not app_private.is_admin() then
    perform app_private.forbid();
  end if;

  select count(*), count(*) filter (where r.outcome = 'failed')
  into v_runs, v_failed
  from public.place_sync_runs r where r.created_at >= v_since;

  v_rate := case when v_runs > 0 then round(100.0 * v_failed / v_runs, 1) end;

  return jsonb_build_object(
    'days', v_days,
    'runs', v_runs,
    'failed', v_failed,
    'failure_rate', v_rate,
    -- Schwelle aus der Entscheidung vom 14.10.2026.
    'threshold', 2,
    'over_threshold', coalesce(v_rate > 2, false),
    'fallback_runs', (select count(*) from public.place_sync_runs r where r.created_at >= v_since and r.fallback_used),
    'last_failure_at', (select max(r.created_at) from public.place_sync_runs r where r.created_at >= v_since and r.outcome = 'failed'),
    'errors', coalesce((
      select jsonb_object_agg(e.error, e.n) from (
        select r.error, count(*) as n from public.place_sync_runs r
        where r.created_at >= v_since and r.outcome = 'failed' group by r.error
      ) e), '{}'),
    'endpoints', coalesce((
      select jsonb_agg(jsonb_build_object('host', s.host, 'attempts', s.total, 'ok', s.ok) order by s.total desc, s.host)
      from (
        select a.value ->> 'host' as host, count(*) as total, count(*) filter (where a.value ->> 'result' = 'ok') as ok
        from public.place_sync_runs r, jsonb_array_elements(r.attempts) a
        where r.created_at >= v_since
        group by 1
      ) s), '[]'),
    -- O2: Fehlschläge je Schritt (vor O2 nicht unterschieden: stage = null).
    'stages', jsonb_build_object(
      'geocode', (select count(*) from public.place_sync_runs r where r.created_at >= v_since and r.outcome = 'failed' and r.stage = 'geocode'),
      'overpass', (select count(*) from public.place_sync_runs r where r.created_at >= v_since and r.outcome = 'failed' and r.stage = 'overpass')),
    'geocode_fallback_runs', (select count(*) from public.place_sync_runs r where r.created_at >= v_since and r.geocode_fallback),
    'geocoders', coalesce((
      select jsonb_agg(jsonb_build_object('host', s.host, 'attempts', s.total, 'ok', s.ok) order by s.total desc, s.host)
      from (
        select a.value ->> 'host' as host, count(*) as total, count(*) filter (where a.value ->> 'result' = 'ok') as ok
        from public.place_sync_runs r, jsonb_array_elements(r.geocode_attempts) a
        where r.created_at >= v_since
        group by 1
      ) s), '[]')
  );
end $$;

revoke all on function public.admin_place_sync_health(integer) from public, anon, authenticated;
grant execute on function public.admin_place_sync_health(integer) to authenticated, service_role;
