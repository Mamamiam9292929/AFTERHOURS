-- P5 Etappe 3 · „Wann könnt ihr?“ für einen festen Ort – mit Wetter
-- Steht schon fest, wo es hingeht („Bowling bei Strike“), fragt die Termin-Abstimmung nur noch nach
-- dem Tag. Technisch eine normale Termin-Abstimmung (create_date_poll mit allen Prüfungen: Mitglied,
-- Termine, Frist, Rate Limit, Höchstzahl offener Abstimmungen, Benachrichtigung), bei der jede Option
-- denselben Ort aus Discover trägt (poll_options.activity_id). Daraus folgt ohne weitere Änderungen:
--   - poll_weather (P5 Etappe 2) liefert je Termin das Wetter am Ort (Ort mit Koordinaten vorausgesetzt)
--   - der Plan aus dem Gewinner-Termin übernimmt Ort und Adresse (create_plan_from_poll)
--   - Stichwahl und Wochenrunde (S7) kopieren den Ort mit
-- Der Titel jeder Option bleibt das Datum („Freitag, 17. Oktober“). Keine neue Tabelle, keine Spalte.

create function public.create_place_date_poll(
  p_crew_id uuid, p_title text, p_ends_at timestamptz, p_slots jsonb, p_activity_id uuid, p_description text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_activity_id uuid;
  v_poll_id uuid;
begin
  perform app_private.require_user();
  -- Erst die Crew, dann der Ort: Außenstehende erfahren nicht, ob es einen Ort gibt.
  if not app_private.is_crew_member(p_crew_id) then
    perform app_private.forbid();
  end if;
  select a.id into v_activity_id from public.activities a where a.id = p_activity_id and a.is_active;
  if v_activity_id is null then
    perform app_private.fail('unknown_activity');
  end if;

  v_poll_id := public.create_date_poll(p_crew_id, p_title, p_ends_at, p_slots, p_description);
  update public.poll_options set activity_id = v_activity_id where poll_id = v_poll_id;
  return v_poll_id;
end $$;

revoke all on function public.create_place_date_poll(uuid, text, timestamptz, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.create_place_date_poll(uuid, text, timestamptz, jsonb, uuid, text) to authenticated, service_role;
