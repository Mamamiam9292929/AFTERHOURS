-- =============================================================================================
-- AFTERHOURS – Termin-Abstimmung „Wann könnt ihr?“ (Roadmap P1, Etappe 1)
--
-- Eine Abstimmung über Termine statt Orte. Technisch eine normale Abstimmung (gleiche Stimmen,
-- gleiches Ergebnis, Stichwahl, Gäste, Plan aus dem Gewinner), aber:
--   - polls.kind = 'date'
--   - jede Option ist ein Termin (proposed_date, optional proposed_time) ohne Ort und Preis
--   - der Titel der Option entsteht hier auf dem Server („Freitag, 17. Oktober“), damit überall –
--     Benachrichtigung, Teilen-Karte, Stimmzettel, Plan – dasselbe steht
-- Angelegt wird sie über create_date_poll, das create_poll mit allen Prüfungen (Mitgliedschaft,
-- Frist, Rate Limit, Höchstzahl offener Abstimmungen, Benachrichtigung) wiederverwendet.
-- =============================================================================================

alter table public.polls
  add column kind text not null default 'place' check (kind in ('place', 'date'));

-- Stichwahlen erben die Art der ursprünglichen Abstimmung.
create function app_private.inherit_poll_kind() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.parent_poll_id is not null then
    select p.kind into new.kind from public.polls p where p.id = new.parent_poll_id;
    new.kind := coalesce(new.kind, 'place');
  end if;
  return new;
end $$;

create trigger polls_inherit_kind before insert on public.polls
  for each row execute function app_private.inherit_poll_kind();

-- „Freitag, 17. Oktober“ – unabhängig von der Spracheinstellung der Datenbank.
create function app_private.german_date_label(p_date date) returns text
language sql immutable set search_path = '' as $$
  select (array['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'])[extract(isodow from p_date)::int]
    || ', ' || extract(day from p_date)::int || '. '
    || (array['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'])[extract(month from p_date)::int];
$$;

-- p_slots: [{"date": "2026-10-17", "time": "20:00"}, {"date": "2026-10-18"}, …] – 2 bis 10 verschiedene
-- Termine, alle in der Zukunft (Berliner Zeit; ohne Uhrzeit zählt der Tag) und höchstens ein Jahr voraus.
create function public.create_date_poll(
  p_crew_id uuid, p_title text, p_ends_at timestamptz, p_slots jsonb, p_description text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_slot record;
  v_date date;
  v_time time;
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_options jsonb := '[]';
  v_seen text[] := '{}';
  v_key text;
  v_poll_id uuid;
begin
  perform app_private.require_user();
  if not app_private.is_crew_member(p_crew_id) then
    perform app_private.forbid();
  end if;
  if p_slots is null or jsonb_typeof(p_slots) <> 'array' or jsonb_array_length(p_slots) not between 2 and 10 then
    perform app_private.fail('invalid_slots');
  end if;

  for v_slot in select e.value from jsonb_array_elements(p_slots) e loop
    if jsonb_typeof(v_slot.value) <> 'object' then
      perform app_private.fail('invalid_slots');
    end if;
    begin
      v_date := (v_slot.value ->> 'date')::date;
      v_time := nullif(v_slot.value ->> 'time', '')::time;
    exception when others then
      perform app_private.fail('invalid_slots');
    end;
    if v_date is null or v_date > v_today + 365 then
      perform app_private.fail('invalid_slots');
    end if;
    if v_date < v_today or (v_time is not null and (v_date + v_time) at time zone 'Europe/Berlin' <= now()) then
      perform app_private.fail('slot_in_past');
    end if;
    v_key := v_date::text || ' ' || coalesce(v_time::text, '');
    if v_key = any (v_seen) then
      perform app_private.fail('invalid_slots');
    end if;
    v_seen := v_seen || v_key;
    v_options := v_options || jsonb_build_array(jsonb_build_object(
      'title', app_private.german_date_label(v_date),
      'proposed_date', v_date,
      'proposed_time', to_char(v_time, 'HH24:MI')));
  end loop;

  -- Chronologisch, damit die Liste in der App von früh nach spät läuft.
  select jsonb_agg(o order by (o ->> 'proposed_date'), coalesce(o ->> 'proposed_time', '')) into v_options
  from jsonb_array_elements(v_options) o;

  v_poll_id := public.create_poll(p_crew_id, p_title, p_ends_at, v_options, p_description);
  update public.polls set kind = 'date' where id = v_poll_id;
  return v_poll_id;
end $$;

revoke all on function app_private.inherit_poll_kind(), app_private.german_date_label(date) from public, anon, authenticated;
revoke all on function public.create_date_poll(uuid, text, timestamptz, jsonb, text) from public, anon, authenticated;
grant execute on function public.create_date_poll(uuid, text, timestamptz, jsonb, text) to authenticated, service_role;
