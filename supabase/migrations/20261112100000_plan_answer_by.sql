-- P46 · „Sagt bis Donnerstag Bescheid“ – Antwortfrist für Pläne
-- Wer reservieren muss, schreibt im Gruppenchat „sagt bis Donnerstag Bescheid“ – und am Donnerstag fehlen
-- trotzdem drei Antworten. Jetzt legt, wer organisiert (oder Owner/Admin ist), eine Frist fest. Alle sehen
-- sie auf der Planseite und am Ticket („Deine Antwort fehlt · bis Do., 12. Nov., 20:00 Uhr“), der
-- Zwischenstand für den Gruppenchat (P37) nennt sie mit.
--
-- Bewusst so gebaut:
--   * Die Frist ist ein Hinweis, keine Sperre: Wer danach antwortet, kann das weiter tun – sonst wäre ein
--     verspätetes „Bin dabei“ für die Runde verloren. Nach Ablauf zeigt die Planseite, wer noch fehlt.
--   * Nur vor Beginn, nur bei Plänen, die weder abgeschlossen noch abgesagt sind. Die Frist liegt in der
--     Zukunft und spätestens eine Stunde vor Beginn.
--   * Wird der Plan so verschoben, dass die Frist nicht mehr mindestens eine Stunde vor Beginn liegt, fällt
--     sie weg (Trigger) – eine Frist nach dem Abend ergibt keinen Sinn, und niemand soll still eine falsche sehen.
--   * Etappe 2 (offen): Erinnerung an alle ohne Antwort kurz vor Ablauf, Bescheid an die organisierende Person
--     danach.

alter table public.plans
  add column answer_by timestamptz;

comment on column public.plans.answer_by is 'P46: Bitte bis dann antworten (Hinweis, keine Sperre), sonst null. Spätestens 1 h vor Beginn.';

-- Verschoben? Liegt die Frist nicht mehr mindestens eine Stunde vor Beginn, fällt sie weg.
create function app_private.plan_answer_by_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.answer_by is not null and new.answer_by > new.starts_at - interval '1 hour' then
    new.answer_by := null;
  end if;
  return new;
end $$;
revoke all on function app_private.plan_answer_by_guard() from public, anon, authenticated;

create trigger plans_answer_by_guard
  before update of starts_at, answer_by on public.plans
  for each row execute function app_private.plan_answer_by_guard();

-- Frist setzen oder entfernen (null). Liefert die gespeicherte Frist.
create function public.set_plan_answer_by(p_plan_id uuid, p_answer_by timestamptz) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id for update;
  if not found or not app_private.can_manage_plan(v_plan) then
    perform app_private.forbid();
  end if;
  if v_plan.status in ('completed', 'cancelled') then
    perform app_private.fail('plan_locked');
  end if;
  if v_plan.starts_at <= now() then
    perform app_private.fail('plan_answer_by_started');
  end if;
  if p_answer_by is not null and (p_answer_by <= now() or p_answer_by > v_plan.starts_at - interval '1 hour') then
    perform app_private.fail('plan_answer_by_invalid');
  end if;
  perform app_private.rate_limit('plan_answer_by', 30, interval '1 hour');

  if p_answer_by is distinct from v_plan.answer_by then
    update public.plans p set answer_by = p_answer_by where p.id = p_plan_id;

    insert into public.audit_log (actor_id, action, entity_type, entity_id, crew_id, meta)
    values (v_uid, 'plan_answer_by_set', 'plan', p_plan_id, v_plan.crew_id, jsonb_build_object('answer_by', p_answer_by));
  end if;
  return p_answer_by;
end $$;

revoke all on function public.set_plan_answer_by(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.set_plan_answer_by(uuid, timestamptz) to authenticated;
