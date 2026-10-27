-- Roadmap P7 Etappe 1: Fotos von Orten über Wikimedia Commons.
--
-- Gespeichert wird nur der Verweis aus OpenStreetMap: eine Datei bei Wikimedia Commons
-- (`wikimedia_commons` oder `image`) bzw. ein Wikidata-Eintrag (`wikidata`, dessen Bild P18).
-- Bild, Urheber:in und Lizenz holt der Browser erst, wenn die Person „Foto anzeigen“ tippt
-- (src/lib/commons.ts) – die Datenbank speichert keine Bilder und keine Lizenzangaben, die
-- veralten könnten. Bestehende Orte bekommen die Verweise beim nächsten Import ihrer Stadt.

-- Gültiger Dateiname (wie COMMONS_FILE in supabase/functions/places/osm.ts): „File:“, keine Pfad- oder
-- Steuerzeichen, Rastergrafik (JPEG, PNG, WebP).
alter table public.activities
  add column commons_file text check (commons_file is null or (char_length(commons_file) <= 250 and commons_file ~* '^File:[^][/|#<>{}[:cntrl:]]{1,240}\.(jpe?g|png|webp)$')),
  add column wikidata_id text check (wikidata_id is null or wikidata_id ~ '^Q[1-9][0-9]{0,11}$');

comment on column public.activities.commons_file is 'P7: Datei bei Wikimedia Commons („File:…“) laut OpenStreetMap';
comment on column public.activities.wikidata_id is 'P7: Wikidata-Eintrag („Q…“) laut OpenStreetMap; dessen Bild (P18) gilt, wenn keine Datei angegeben ist';

-- Import wie bisher (20261012120000_osm_places.sql), dazu die beiden Verweise. Ungültige Verweise
-- werden verworfen, nicht der Ort.
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
      commons_file text, wikidata_id text
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
      case when r.wikidata_id ~ '^Q[1-9][0-9]{0,11}$' then r.wikidata_id end as wikidata_id
    from raw r
    where r.external_id ~ '^(node|way|relation)/[0-9]+$'
      and r.category = any (enum_range(null::public.activity_category)::text[])
      and r.latitude between -90 and 90 and r.longitude between -180 and 180
  )
  insert into public.activities (
    provider_id, external_id, name, category, description, address, city, latitude, longitude,
    opening_hours, opening_hours_raw, website_url, phone, setting, data_source, source_url, quality,
    commons_file, wikidata_id, is_active, last_verified_at
  )
  select 'osm', c.external_id, c.name, c.category, c.description, c.address, v_region.name, c.latitude, c.longitude,
         c.opening_hours, c.opening_hours_raw, c.website_url, c.phone, c.setting, 'provider', c.source_url, c.quality,
         c.commons_file, c.wikidata_id, true, clock_timestamp()
  from clean c
  where c.name is not null and char_length(c.name) between 2 and 120
  on conflict (provider_id, external_id) do update set
    name = excluded.name, category = excluded.category, description = excluded.description,
    address = excluded.address, city = excluded.city, latitude = excluded.latitude, longitude = excluded.longitude,
    opening_hours = excluded.opening_hours, opening_hours_raw = excluded.opening_hours_raw,
    website_url = excluded.website_url, phone = excluded.phone, setting = excluded.setting,
    source_url = excluded.source_url, quality = excluded.quality,
    commons_file = excluded.commons_file, wikidata_id = excluded.wikidata_id, is_active = true,
    last_verified_at = excluded.last_verified_at, updated_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.ingest_place_batch(uuid, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_place_batch(uuid, timestamptz, jsonb) to service_role;
