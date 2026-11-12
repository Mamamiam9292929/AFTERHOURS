-- P48 · Frist auch für die nächste Runde
-- Bei regelmäßigen Plänen (P8, „jeden ersten Freitag“) legt die Serie jede Runde neu an – die Antwortfrist
-- (P46/P47) fiel dabei bisher weg, und wer reserviert, musste sie jede Woche von Hand setzen. Jetzt bekommt die
-- neue Runde denselben Abstand zum Beginn wie die Runde, aus der sie entsteht („2 Tage vorher, 18:00“).
--
-- Bewusst so gebaut:
--   * Gerechnet wird in Berliner Ortszeit: Frist und Beginn behalten Tage und Uhrzeit, auch wenn zwischen den
--     Runden (oder zwischen Frist und Beginn) die Zeitumstellung liegt. „Freitag 18:00 für Samstag 20:00“
--     bleibt Freitag 18:00 – nicht 17:00 oder 19:00.
--   * Es gelten dieselben Regeln wie beim Setzen von Hand: Die Frist liegt in der Zukunft und spätestens eine
--     Stunde vor Beginn. Sonst bekommt die neue Runde keine Frist (z. B. weil sie wegen „Diesmal aussetzen“
--     sofort angelegt wird und der Abstand schon verstrichen wäre) – lieber keine als eine falsche.
--   * Vorbild ist die letzte Runde der Serie, auch wenn sie ausgesetzt oder abgesagt wurde: Ihre Frist bleibt
--     gespeichert, und wer aussetzt, will die Frist ja nicht abschaffen. Wer die Frist an der letzten Runde
--     entfernt, schaltet sie damit auch für die folgenden ab.
--   * Kein Eingriff in `roll_plan_series`: Ein Trigger vor dem Anlegen eines Plans mit Serie setzt die Frist.
--     Nur der Server legt Pläne mit Serie an (Nutzer schreiben nicht direkt in `plans`). Eine Frist, die beim
--     Anlegen schon mitgegeben wird, bleibt unangetastet.

-- Frist der neuen Runde aus der vorigen: gleicher Abstand in Berliner Ortszeit, sonst null.
create function app_private.plan_series_answer_by(p_prev_starts_at timestamptz, p_prev_answer_by timestamptz,
                                                  p_starts_at timestamptz, p_now timestamptz) returns timestamptz
language plpgsql stable set search_path = '' as $$
declare
  v_at timestamptz;
begin
  if p_prev_starts_at is null or p_prev_answer_by is null or p_starts_at is null then
    return null;
  end if;
  v_at := ((p_starts_at at time zone 'Europe/Berlin')
           - ((p_prev_starts_at at time zone 'Europe/Berlin') - (p_prev_answer_by at time zone 'Europe/Berlin')))
          at time zone 'Europe/Berlin';
  if v_at <= p_now or v_at > p_starts_at - interval '1 hour' then
    return null;
  end if;
  return v_at;
end $$;
revoke all on function app_private.plan_series_answer_by(timestamptz, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;

create function app_private.plan_series_answer_by_inherit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_prev public.plans%rowtype;
begin
  if new.series_id is null or new.answer_by is not null then
    return new;
  end if;
  select * into v_prev from public.plans p
  where p.series_id = new.series_id and p.starts_at < new.starts_at
  order by p.starts_at desc, p.created_at desc limit 1;
  if found then
    new.answer_by := app_private.plan_series_answer_by(v_prev.starts_at, v_prev.answer_by, new.starts_at, now());
  end if;
  return new;
end $$;
revoke all on function app_private.plan_series_answer_by_inherit() from public, anon, authenticated;

create trigger plans_series_answer_by
  before insert on public.plans
  for each row execute function app_private.plan_series_answer_by_inherit();
