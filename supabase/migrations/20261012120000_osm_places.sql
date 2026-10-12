-- =============================================================================================
-- AFTERHOURS – Echte Orte aus OpenStreetMap
--
-- Orte werden pro Stadt bei Bedarf importiert: Wählt jemand in Discover eine Stadt, ruft die App
-- die Edge Function "places" auf. Sie fragt OpenStreetMap (Nominatim + Overpass) ab und schreibt
-- die Orte über die service_role-Funktionen unten in `activities` (provider_id = 'osm').
-- Nutzerinnen und Nutzer können selbst keine Orte schreiben – nur einen Import anstoßen.
--
-- Datenlizenz: © OpenStreetMap-Mitwirkende, ODbL 1.0. Die App nennt die Quelle bei jedem Ort.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- activities: Felder für importierte Orte
-- ---------------------------------------------------------------------------------------------
alter table public.activities
  -- Öffnungszeiten im OSM-Format, wenn sie sich nicht sicher in `opening_hours` übersetzen ließen.
  add column opening_hours_raw text check (opening_hours_raw is null or char_length(opening_hours_raw) <= 255),
  -- Link zum Objekt bei der Quelle (z. B. https://www.openstreetmap.org/node/123).
  add column source_url text check (source_url is null or source_url ~ '^https://'),
  -- Vollständigkeit der Angaben (Öffnungszeiten, Website, Adresse …) – nur für die Sortierung.
  add column quality smallint not null default 0 check (quality between 0 and 20);

create index activities_city_quality_idx on public.activities (lower(city), quality desc, name) where is_active;

-- ---------------------------------------------------------------------------------------------
-- place_regions: welche Städte importiert sind
-- ---------------------------------------------------------------------------------------------
create table public.place_regions (
  id uuid primary key default gen_random_uuid(),
  -- Kanonischer Name laut OSM; identisch mit activities.city der importierten Orte.
  name text not null check (char_length(name) between 1 and 80),
  osm_type text not null check (osm_type in ('node', 'way', 'relation')),
  osm_id bigint not null check (osm_id > 0),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  -- Weitere Schreibweisen, unter denen die Stadt gesucht wurde (klein geschrieben), z. B. "frankfurt".
  aliases text[] not null default '{}',
  status text not null default 'syncing' check (status in ('syncing', 'ready', 'failed')),
  place_count integer not null default 0 check (place_count >= 0),
  sync_started_at timestamptz,
  synced_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 200),
  requested_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (osm_type, osm_id)
);
create unique index place_regions_name_idx on public.place_regions (lower(name));
create index place_regions_aliases_idx on public.place_regions using gin (aliases);

create trigger place_regions_touch before update on public.place_regions
  for each row execute function app_private.touch_updated_at();

alter table public.place_regions enable row level security;
create policy place_regions_select on public.place_regions for select to authenticated using (true);

revoke all on public.place_regions from public, anon, authenticated;
grant select (id, name, latitude, longitude, status, place_count, sync_started_at, synced_at, created_at)
  on public.place_regions to authenticated;
grant all on public.place_regions to service_role;

-- ---------------------------------------------------------------------------------------------
-- Hilfsfunktionen
-- ---------------------------------------------------------------------------------------------
-- Daten gelten 30 Tage als aktuell; ein laufender Import blockiert 3 Minuten lang.
create function app_private.place_region_by_key(p_key text) returns public.place_regions
language sql stable security definer set search_path = '' as $$
  select r.* from public.place_regions r
  where lower(r.name) = p_key or p_key = any (r.aliases)
  order by (lower(r.name) = p_key) desc
  limit 1;
$$;

create function app_private.place_key(p_city text) returns text
language plpgsql immutable security definer set search_path = '' as $$
declare
  v_key text := lower(regexp_replace(btrim(coalesce(p_city, '')), '\s+', ' ', 'g'));
begin
  if char_length(v_key) < 2 or char_length(v_key) > 80 or v_key !~ '^[[:alpha:]0-9 .''()/-]+$' then
    raise exception 'invalid_city' using errcode = 'P0001';
  end if;
  return v_key;
end $$;

create function app_private.place_region_json(r public.place_regions) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id,
    'name', r.name,
    'latitude', r.latitude,
    'longitude', r.longitude,
    'status', r.status,
    'place_count', r.place_count,
    'synced_at', r.synced_at,
    'stale', r.synced_at is null or r.synced_at < now() - interval '30 days',
    'busy', r.status = 'syncing' and r.sync_started_at > now() - interval '3 minutes'
  );
$$;

-- ---------------------------------------------------------------------------------------------
-- Für angemeldete Nutzer
-- ---------------------------------------------------------------------------------------------
-- Stand einer Stadt: {"status":"none"} oder Name, Status, Anzahl, Aktualität.
create function public.place_region_status(p_city text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_region public.place_regions;
begin
  perform app_private.require_user();
  v_region := app_private.place_region_by_key(app_private.place_key(p_city));
  if v_region.id is null then
    return jsonb_build_object('status', 'none');
  end if;
  return app_private.place_region_json(v_region);
end $$;

-- Prüft vor einem Import, ob er nötig ist, und verbraucht dann das Kontingent:
-- 10 Importe pro Person und Stunde, 60 insgesamt (Nutzungsregeln der OSM-Dienste).
-- Ergebnis: {"action":"ready"|"busy"|"sync", ...}
create function public.request_place_sync(p_city text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_key text := app_private.place_key(p_city);
  v_region public.place_regions;
begin
  perform app_private.require_user();
  v_region := app_private.place_region_by_key(v_key);
  if v_region.id is not null then
    if v_region.status = 'ready' and v_region.synced_at >= now() - interval '30 days' then
      return app_private.place_region_json(v_region) || jsonb_build_object('action', 'ready');
    end if;
    if v_region.status = 'syncing' and v_region.sync_started_at > now() - interval '3 minutes' then
      return app_private.place_region_json(v_region) || jsonb_build_object('action', 'busy');
    end if;
  end if;

  if (select count(*) from public.place_regions r where r.sync_started_at > now() - interval '1 hour') >= 60 then
    raise exception 'rate_limited' using errcode = 'P0001', detail = 'place_sync_global';
  end if;
  perform app_private.rate_limit('place_sync', 10, interval '1 hour');
  return jsonb_build_object('action', 'sync');
end $$;

-- Suche innerhalb einer Stadt. Demo-Orte werden ausgeblendet, sobald es dort echte Orte gibt.
-- Ergebnis: {"total": n, "categories": {"bar": 12, …}, "items": [...]} – höchstens 500 Einträge.
create function public.search_activities(
  p_city text,
  p_category public.activity_category default null,
  p_query text default null,
  p_limit integer default 300
) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_city text := lower(btrim(coalesce(p_city, '')));
  v_query text := nullif(lower(btrim(coalesce(p_query, ''))), '');
  v_has_real boolean;
  v_result jsonb;
begin
  if v_city = '' then
    raise exception 'invalid_city' using errcode = 'P0001';
  end if;
  if v_query is not null and char_length(v_query) > 80 then
    v_query := left(v_query, 80);
  end if;

  select exists (
    select 1 from public.activities a
    where a.is_active and lower(a.city) = v_city and a.data_source <> 'demo'
  ) into v_has_real;

  with in_city as (
    select a.* from public.activities a
    where a.is_active and lower(a.city) = v_city
      and not (v_has_real and a.data_source = 'demo')
  ),
  matching as (
    select c.* from in_city c
    where (p_category is null or c.category = p_category)
      and (v_query is null
           or position(v_query in lower(c.name)) > 0
           or position(v_query in lower(coalesce(c.address, ''))) > 0
           or position(v_query in lower(coalesce(c.description, ''))) > 0)
  ),
  page as (
    select m.* from matching m
    order by m.quality desc, m.name
    limit least(greatest(coalesce(p_limit, 300), 1), 500)
  )
  select jsonb_build_object(
    'total', (select count(*) from matching),
    'categories', coalesce((select jsonb_object_agg(x.category, x.n) from (select c.category, count(*) as n from in_city c group by c.category) x), '{}'::jsonb),
    'items', coalesce((select jsonb_agg(to_jsonb(p) order by p.quality desc, p.name) from page p), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Nur für die Edge Function (service_role)
-- ---------------------------------------------------------------------------------------------
-- Legt die Region an bzw. sperrt sie für den Import. Ergebnis wie request_place_sync, bei "sync"
-- zusätzlich das Sperr-Token `started_at`, das ingest/complete/fail mitgeben müssen.
create function public.begin_place_sync(
  p_query text, p_name text, p_osm_type text, p_osm_id bigint,
  p_latitude double precision, p_longitude double precision, p_user uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_query_key text := app_private.place_key(p_query);
  v_name text := app_private.clean_line(p_name, 80);
  v_region public.place_regions;
  v_started timestamptz := clock_timestamp();
begin
  if v_name is null or char_length(v_name) < 1 then
    raise exception 'invalid_city' using errcode = 'P0001';
  end if;

  select * into v_region from public.place_regions r
  where lower(r.name) = lower(v_name) or (r.osm_type = p_osm_type and r.osm_id = p_osm_id)
  order by (r.osm_type = p_osm_type and r.osm_id = p_osm_id) desc
  limit 1
  for update;

  if v_region.id is null then
    insert into public.place_regions (name, osm_type, osm_id, latitude, longitude, aliases, status, sync_started_at, requested_by)
    values (v_name, p_osm_type, p_osm_id, p_latitude, p_longitude,
            case when v_query_key <> lower(v_name) then array[v_query_key] else '{}' end,
            'syncing', v_started, p_user)
    returning * into v_region;
    return app_private.place_region_json(v_region) || jsonb_build_object('action', 'sync', 'started_at', v_started);
  end if;

  if v_query_key <> lower(v_region.name) and not v_query_key = any (v_region.aliases) then
    update public.place_regions set aliases = array_append(aliases, v_query_key) where id = v_region.id
    returning * into v_region;
  end if;

  if v_region.status = 'ready' and v_region.synced_at >= now() - interval '30 days' then
    return app_private.place_region_json(v_region) || jsonb_build_object('action', 'ready');
  end if;
  if v_region.status = 'syncing' and v_region.sync_started_at > now() - interval '3 minutes' then
    return app_private.place_region_json(v_region) || jsonb_build_object('action', 'busy');
  end if;

  update public.place_regions
  set status = 'syncing', sync_started_at = v_started, requested_by = p_user,
      osm_type = p_osm_type, osm_id = p_osm_id, latitude = p_latitude, longitude = p_longitude
  where id = v_region.id
  returning * into v_region;
  return app_private.place_region_json(v_region) || jsonb_build_object('action', 'sync', 'started_at', v_started);
end $$;

create function app_private.require_sync_token(p_region uuid, p_started timestamptz) returns public.place_regions
language plpgsql security definer set search_path = '' as $$
declare
  v_region public.place_regions;
begin
  select * into v_region from public.place_regions where id = p_region for update;
  if v_region.id is null or v_region.status <> 'syncing' or v_region.sync_started_at is distinct from p_started then
    raise exception 'sync_token_invalid' using errcode = 'P0001';
  end if;
  return v_region;
end $$;

-- Schreibt einen Stapel Orte (max. 2000). Ungültige Einträge werden übersprungen, nicht der Stapel.
create function public.ingest_place_batch(p_region uuid, p_started timestamptz, p_places jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_region public.place_regions := app_private.require_sync_token(p_region, p_started);
  v_count integer;
begin
  if jsonb_typeof(p_places) <> 'array' or jsonb_array_length(p_places) > 2000 then
    raise exception 'invalid_batch' using errcode = 'P0001';
  end if;

  with raw as (
    select * from jsonb_to_recordset(p_places) as x(
      external_id text, name text, category text, description text, address text,
      latitude double precision, longitude double precision, opening_hours jsonb, opening_hours_raw text,
      website_url text, phone text, setting text, source_url text, quality integer
    )
  ),
  clean as (
    select
      r.external_id,
      app_private.clean_line(r.name, 120) as name,
      r.category::public.activity_category as category,
      app_private.clean_text(r.description, 2000) as description,
      app_private.clean_line(r.address, 200) as address,
      r.latitude, r.longitude,
      case when jsonb_typeof(r.opening_hours) = 'object' then r.opening_hours end as opening_hours,
      left(app_private.clean_line(r.opening_hours_raw, 255), 255) as opening_hours_raw,
      case when r.website_url ~ '^https://[^[:space:]]+$' and char_length(r.website_url) <= 500 then r.website_url end as website_url,
      left(app_private.clean_line(r.phone, 40), 40) as phone,
      case when r.setting in ('indoor', 'outdoor', 'both') then r.setting::public.activity_setting end as setting,
      case when r.source_url ~ '^https://www\.openstreetmap\.org/(node|way|relation)/[0-9]+$' then r.source_url end as source_url,
      least(greatest(coalesce(r.quality, 0), 0), 20)::smallint as quality
    from raw r
    where r.external_id ~ '^(node|way|relation)/[0-9]+$'
      and r.category = any (enum_range(null::public.activity_category)::text[])
      and r.latitude between -90 and 90 and r.longitude between -180 and 180
  )
  insert into public.activities (
    provider_id, external_id, name, category, description, address, city, latitude, longitude,
    opening_hours, opening_hours_raw, website_url, phone, setting, data_source, source_url, quality,
    is_active, last_verified_at
  )
  select 'osm', c.external_id, c.name, c.category, c.description, c.address, v_region.name, c.latitude, c.longitude,
         c.opening_hours, c.opening_hours_raw, c.website_url, c.phone, c.setting, 'provider', c.source_url, c.quality,
         true, clock_timestamp()
  from clean c
  where c.name is not null and char_length(c.name) between 2 and 120
  on conflict (provider_id, external_id) do update set
    name = excluded.name, category = excluded.category, description = excluded.description,
    address = excluded.address, city = excluded.city, latitude = excluded.latitude, longitude = excluded.longitude,
    opening_hours = excluded.opening_hours, opening_hours_raw = excluded.opening_hours_raw,
    website_url = excluded.website_url, phone = excluded.phone, setting = excluded.setting,
    source_url = excluded.source_url, quality = excluded.quality, is_active = true,
    last_verified_at = excluded.last_verified_at, updated_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Schließt den Import ab: Orte, die bei OSM nicht mehr auftauchen, werden deaktiviert (nicht gelöscht,
-- weil Abstimmungen und Pläne auf sie verweisen können).
create function public.complete_place_sync(p_region uuid, p_started timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_region public.place_regions := app_private.require_sync_token(p_region, p_started);
  v_count integer;
begin
  update public.activities a
  set is_active = false, updated_at = now()
  where a.provider_id = 'osm' and a.is_active and lower(a.city) = lower(v_region.name)
    and (a.last_verified_at is null or a.last_verified_at < p_started);

  select count(*) into v_count from public.activities a
  where a.provider_id = 'osm' and a.is_active and lower(a.city) = lower(v_region.name);

  update public.place_regions
  set status = 'ready', synced_at = now(), place_count = v_count, last_error = null
  where id = v_region.id
  returning * into v_region;
  return app_private.place_region_json(v_region);
end $$;

create function public.fail_place_sync(p_region uuid, p_started timestamptz, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_sync_token(p_region, p_started);
  update public.place_regions
  set status = 'failed', last_error = left(coalesce(p_error, 'unknown'), 200)
  where id = p_region;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Rechte
-- ---------------------------------------------------------------------------------------------
revoke all on function
  app_private.place_region_by_key(text), app_private.place_key(text), app_private.place_region_json(public.place_regions),
  app_private.require_sync_token(uuid, timestamptz),
  public.place_region_status(text), public.request_place_sync(text),
  public.search_activities(text, public.activity_category, text, integer),
  public.begin_place_sync(text, text, text, bigint, double precision, double precision, uuid),
  public.ingest_place_batch(uuid, timestamptz, jsonb), public.complete_place_sync(uuid, timestamptz),
  public.fail_place_sync(uuid, timestamptz, text)
from public, anon, authenticated;

grant execute on function
  public.place_region_status(text), public.request_place_sync(text),
  public.search_activities(text, public.activity_category, text, integer)
to authenticated, service_role;

grant execute on function
  public.begin_place_sync(text, text, text, bigint, double precision, double precision, uuid),
  public.ingest_place_batch(uuid, timestamptz, jsonb), public.complete_place_sync(uuid, timestamptz),
  public.fail_place_sync(uuid, timestamptz, text)
to service_role;
