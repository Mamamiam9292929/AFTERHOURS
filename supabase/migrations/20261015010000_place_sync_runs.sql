-- =============================================================================================
-- AFTERHOURS – Protokoll der OSM-Importe (Roadmap O1)
--
-- Die Edge Function "places" fragt mehrere Overpass-Server der Reihe nach (Ersatzserver). Jeder
-- Import, der OSM erreicht hat oder daran gescheitert ist, wird hier mit allen Versuchen
-- festgehalten. Daraus ergibt sich die Fehlerquote, an der die Entscheidung vom 14.10.2026 hängt
-- (eigener OSM-Dienst erst ab über 2 % fehlgeschlagenen Importen in einer Woche).
--
-- Keine personenbezogenen Daten: kein Nutzer, nur Stadt, Ergebnis, Server (Hostname) und Dauer.
-- Einträge verfallen nach 90 Tagen.
-- =============================================================================================

create table public.place_sync_runs (
  id bigint generated always as identity primary key,
  region_id uuid references public.place_regions (id) on delete set null,
  -- Suchbegriff in Normalform (place_key), z. B. "leipzig".
  city text check (city is null or char_length(city) between 2 and 80),
  outcome text not null check (outcome in ('ready', 'failed')),
  error text check (error is null or error ~ '^[a-z_]{1,40}$'),
  -- Hostname des Servers, der geliefert hat (nur bei Erfolg).
  endpoint text check (endpoint is null or endpoint ~ '^[a-z0-9.-]{1,120}(:[0-9]{1,5})?$'),
  fallback_used boolean not null default false,
  -- [{ "host": "overpass-api.de", "result": "ok"|"busy"|"timeout"|"unavailable", "ms": 1234 }, …]
  attempts jsonb not null default '[]' check (jsonb_typeof(attempts) = 'array' and jsonb_array_length(attempts) <= 4),
  duration_ms integer not null default 0 check (duration_ms between 0 and 600000),
  created_at timestamptz not null default now()
);
create index place_sync_runs_created_idx on public.place_sync_runs (created_at desc);

-- Nur die Edge Function schreibt, nur Admins lesen – über die Funktionen unten.
alter table public.place_sync_runs enable row level security;
revoke all on public.place_sync_runs from public, anon, authenticated;
grant all on public.place_sync_runs to service_role;

-- ---------------------------------------------------------------------------------------------
-- Schreiben (nur service_role)
-- ---------------------------------------------------------------------------------------------
create function public.record_place_sync_run(
  p_city text, p_region uuid, p_outcome text, p_error text, p_attempts jsonb, p_duration_ms integer
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_city text;
  v_attempts jsonb := '[]';
  v_item jsonb;
  v_host text;
  v_result text;
  v_endpoint text;
  v_fallback boolean := false;
  v_index integer := 0;
begin
  if p_outcome is null or p_outcome not in ('ready', 'failed') then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;

  begin
    v_city := app_private.place_key(p_city);
  exception when others then
    v_city := null;
  end;

  if jsonb_typeof(p_attempts) = 'array' then
    for v_item in select e.value from jsonb_array_elements(p_attempts) with ordinality as e(value, n) where e.n <= 4 order by e.n
    loop
      v_host := lower(coalesce(v_item ->> 'host', ''));
      v_result := v_item ->> 'result';
      if v_host !~ '^[a-z0-9.-]{1,120}(:[0-9]{1,5})?$' then v_host := 'unknown'; end if;
      if v_result is null or v_result not in ('ok', 'busy', 'timeout', 'unavailable') then v_result := 'unavailable'; end if;
      v_attempts := v_attempts || jsonb_build_array(jsonb_build_object(
        'host', v_host, 'result', v_result,
        'ms', case when jsonb_typeof(v_item -> 'ms') = 'number'
                  then least(greatest((v_item ->> 'ms')::numeric, 0), 600000)::integer else 0 end));
      if v_result = 'ok' and v_endpoint is null then
        v_endpoint := v_host;
        v_fallback := v_index > 0;
      end if;
      v_index := v_index + 1;
    end loop;
  end if;

  insert into public.place_sync_runs (region_id, city, outcome, error, endpoint, fallback_used, attempts, duration_ms)
  values (
    (select r.id from public.place_regions r where r.id = p_region),
    v_city,
    p_outcome,
    case when p_outcome = 'failed' then coalesce(substring(lower(coalesce(p_error, '')) from '^[a-z_]{1,40}$'), 'unknown') end,
    case when p_outcome = 'ready' then v_endpoint end,
    p_outcome = 'ready' and v_fallback,
    v_attempts,
    least(greatest(coalesce(p_duration_ms, 0), 0), 600000)
  );

  delete from public.place_sync_runs where created_at < now() - interval '90 days';
end $$;

-- ---------------------------------------------------------------------------------------------
-- Lesen (nur Admins): Fehlerquote der letzten p_days Tage (1–90, Standard 7)
-- ---------------------------------------------------------------------------------------------
create function public.admin_place_sync_health(p_days integer default 7) returns jsonb
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
      ) s), '[]')
  );
end $$;

revoke all on function public.record_place_sync_run(text, uuid, text, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.record_place_sync_run(text, uuid, text, text, jsonb, integer) to service_role;

revoke all on function public.admin_place_sync_health(integer) from public, anon, authenticated;
grant execute on function public.admin_place_sync_health(integer) to authenticated, service_role;
