-- Roadmap P11 Etappe 2f: Beschreibungen von Orten aus OpenStreetMap in der Sprache der App.
--
-- Bisher speicherte der Import nur einen deutschen Satz („Küche: Italienisch. Außenplätze.“). Jetzt kommen
-- dieselben Angaben zusätzlich als Merkmale (`activities.features`): OSM-Schlüssel für Küche und Sport,
-- vegan, Außenplätze, Rollstuhl, dazu die eigene Beschreibung aus OSM auf Deutsch (`description:de` bzw.
-- `description`) und auf Englisch (nur `description:en`). Die App setzt daraus den Satz in ihrer Sprache
-- zusammen (src/lib/placeText.ts). `description` bleibt wie bisher – Rückfall für Orte, die noch nicht neu
-- importiert wurden; bestehende Orte bekommen die Merkmale beim nächsten Import ihrer Stadt (nach 30 Tagen).
--
-- Die Datenbank nimmt nur bekannte Felder in fester Form an; alles andere wird verworfen, nicht der Ort.

create function app_private.clean_place_features(p_features jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  with f as (select case when jsonb_typeof(p_features) = 'object' then p_features else '{}'::jsonb end as v),
  built as (
    select jsonb_strip_nulls(jsonb_build_object(
      'cuisine', (
        select jsonb_agg(c.k order by c.o) from (
          select e.k, min(e.o) as o
          from jsonb_array_elements_text(case when jsonb_typeof(f.v -> 'cuisine') = 'array' then f.v -> 'cuisine' else '[]'::jsonb end) with ordinality as e(k, o)
          where e.k ~ '^[a-z][a-z_]{1,29}$'
          group by e.k order by min(e.o) limit 8
        ) c
      ),
      'sport', (
        select jsonb_agg(s.k order by s.o) from (
          select e.k, min(e.o) as o
          from jsonb_array_elements_text(case when jsonb_typeof(f.v -> 'sport') = 'array' then f.v -> 'sport' else '[]'::jsonb end) with ordinality as e(k, o)
          where e.k ~ '^[a-z][a-z_]{1,29}$'
          group by e.k order by min(e.o) limit 4
        ) s
      ),
      'vegan', case when f.v ->> 'vegan' in ('only', 'yes') then f.v ->> 'vegan' end,
      'outdoor_seating', case when f.v -> 'outdoor_seating' = 'true'::jsonb then true end,
      'wheelchair', case when f.v ->> 'wheelchair' in ('yes', 'limited') then f.v ->> 'wheelchair' end,
      'about_de', case when jsonb_typeof(f.v -> 'about_de') = 'string' then app_private.clean_line(f.v ->> 'about_de', 300) end,
      'about_en', case when jsonb_typeof(f.v -> 'about_en') = 'string' then app_private.clean_line(f.v ->> 'about_en', 300) end
    )) as v
    from f
  )
  select case when built.v = '{}'::jsonb then null else built.v end from built;
$$;

revoke all on function app_private.clean_place_features(jsonb) from public, anon, authenticated;

alter table public.activities
  add column features jsonb check (features is null or (jsonb_typeof(features) = 'object' and octet_length(features::text) <= 4096));

comment on column public.activities.features is 'P11 Etappe 2f: Merkmale aus OpenStreetMap (Küche, Sport, vegan, Außenplätze, Rollstuhl, eigene Beschreibung de/en) – die App setzt daraus die Beschreibung in ihrer Sprache zusammen';

-- Import wie bisher (20261027130000_place_photos.sql), dazu die Merkmale.
create or replace function public.ingest_place_batch(p_region uuid, p_started timestamptz, p_places jsonb) returns integer
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
      website_url text, phone text, setting text, source_url text, quality integer,
      commons_file text, wikidata_id text, features jsonb
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
      least(greatest(coalesce(r.quality, 0), 0), 20)::smallint as quality,
      case when char_length(r.commons_file) <= 250 and r.commons_file ~* '^File:[^][/|#<>{}[:cntrl:]]{1,240}\.(jpe?g|png|webp)$' then r.commons_file end as commons_file,
      case when r.wikidata_id ~ '^Q[1-9][0-9]{0,11}$' then r.wikidata_id end as wikidata_id,
      app_private.clean_place_features(r.features) as features
    from raw r
    where r.external_id ~ '^(node|way|relation)/[0-9]+$'
      and r.category = any (enum_range(null::public.activity_category)::text[])
      and r.latitude between -90 and 90 and r.longitude between -180 and 180
  )
  insert into public.activities (
    provider_id, external_id, name, category, description, address, city, latitude, longitude,
    opening_hours, opening_hours_raw, website_url, phone, setting, data_source, source_url, quality,
    commons_file, wikidata_id, features, is_active, last_verified_at
  )
  select 'osm', c.external_id, c.name, c.category, c.description, c.address, v_region.name, c.latitude, c.longitude,
         c.opening_hours, c.opening_hours_raw, c.website_url, c.phone, c.setting, 'provider', c.source_url, c.quality,
         c.commons_file, c.wikidata_id, c.features, true, clock_timestamp()
  from clean c
  where c.name is not null and char_length(c.name) between 2 and 120
  on conflict (provider_id, external_id) do update set
    name = excluded.name, category = excluded.category, description = excluded.description,
    address = excluded.address, city = excluded.city, latitude = excluded.latitude, longitude = excluded.longitude,
    opening_hours = excluded.opening_hours, opening_hours_raw = excluded.opening_hours_raw,
    website_url = excluded.website_url, phone = excluded.phone, setting = excluded.setting,
    source_url = excluded.source_url, quality = excluded.quality,
    commons_file = excluded.commons_file, wikidata_id = excluded.wikidata_id, features = excluded.features, is_active = true,
    last_verified_at = excluded.last_verified_at, updated_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.ingest_place_batch(uuid, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_place_batch(uuid, timestamptz, jsonb) to service_role;
