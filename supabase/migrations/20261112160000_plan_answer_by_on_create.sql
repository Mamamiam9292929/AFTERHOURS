-- P47 · Antwortfrist gleich beim Erstellen
-- Bisher legte man den Plan an und setzte die Frist danach unter „Organisieren“ – meist erst, wenn alle schon
-- eingeladen waren. Jetzt wählt man sie im Formular „Plan erstellen“ bzw. „Plan aus Abstimmung“ mit.
--
-- Bewusst so gebaut:
--   * create_plan und create_plan_from_poll bleiben unverändert (keine neue Überladung, die PostgREST bei
--     benannten Parametern verwechseln könnte). Zwei schmale Hüllen rufen sie auf und danach set_plan_answer_by –
--     dieselben Prüfungen (Rechte, Frist in der Zukunft, spätestens 1 h vor Beginn, Rate Limit), nichts doppelt.
--   * Alles in einer Transaktion: Ist die Frist ungültig, entsteht auch kein Plan (und niemand bekommt Bescheid).
--   * Ohne Frist (null) verhalten sich die Hüllen genau wie die ursprünglichen Funktionen.

create function public.create_plan_with_answer_by(
  p_crew_id uuid, p_title text, p_starts_at timestamptz, p_answer_by timestamptz,
  p_activity_id uuid default null, p_address text default null, p_meeting_point text default null,
  p_notes text default null, p_cost_per_person_cents integer default null, p_total_cost_cents integer default null,
  p_ends_at timestamptz default null, p_confirmed boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_plan_id uuid;
begin
  v_plan_id := public.create_plan(p_crew_id, p_title, p_starts_at, p_activity_id, p_address, p_meeting_point, p_notes,
                                  p_cost_per_person_cents, p_total_cost_cents, p_ends_at, p_confirmed);
  if p_answer_by is not null then
    perform public.set_plan_answer_by(v_plan_id, p_answer_by);
  end if;
  return v_plan_id;
end $$;

revoke all on function public.create_plan_with_answer_by(uuid, text, timestamptz, timestamptz, uuid, text, text, text, integer, integer, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.create_plan_with_answer_by(uuid, text, timestamptz, timestamptz, uuid, text, text, text, integer, integer, timestamptz, boolean)
  to authenticated;

create function public.create_plan_from_poll_with_answer_by(
  p_poll_id uuid, p_option_id uuid, p_answer_by timestamptz, p_starts_at timestamptz default null, p_title text default null,
  p_address text default null, p_meeting_point text default null, p_notes text default null,
  p_cost_per_person_cents integer default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_plan_id uuid;
begin
  v_plan_id := public.create_plan_from_poll(p_poll_id, p_option_id, p_starts_at, p_title, p_address, p_meeting_point, p_notes,
                                            p_cost_per_person_cents);
  if p_answer_by is not null then
    perform public.set_plan_answer_by(v_plan_id, p_answer_by);
  end if;
  return v_plan_id;
end $$;

revoke all on function public.create_plan_from_poll_with_answer_by(uuid, uuid, timestamptz, timestamptz, text, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.create_plan_from_poll_with_answer_by(uuid, uuid, timestamptz, timestamptz, text, text, text, text, integer)
  to authenticated;
