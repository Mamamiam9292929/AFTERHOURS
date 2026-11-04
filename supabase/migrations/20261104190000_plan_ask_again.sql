-- P23 · Neue Uhrzeit – alle neu fragen
-- Wird ein Plan verschoben, galten bisher alle Antworten einfach weiter: Wer für Freitag zugesagt hatte,
-- stand plötzlich auch für Samstag bei „Dabei“. Jetzt kann, wer organisiert (oder Owner/Admin ist), beim
-- Speichern der neuen Zeit „Alle neu fragen“ wählen (in der App vorausgewählt, sobald sich die Zeit ändert).
--
-- Bewusst so gebaut:
--   * Die Antworten der anderen gehen auf „eingeladen“ zurück; die alte Antwort bleibt in
--     `plan_participants.previous_status` stehen, damit die Planseite „Vorher: Bin dabei“ zeigen kann.
--     Die eigene Antwort der Person, die verschiebt, bleibt.
--   * Gäste ohne Konto (W10) lassen sich nicht benachrichtigen. Ihre Antworten gelten für die alte Zeit und
--     werden gelöscht – sonst zählten sie bei „x sind dabei“ weiter mit. Über den Link sagen sie neu zu
--     (der Name ist auf ihrem Gerät gemerkt). Das steht vorher im Hinweis beim Speichern.
--   * Keine zweite Benachrichtigung: `update_plan` hat gerade „Plan geändert: Zeit“ verschickt. Diese
--     (noch ungelesene) Benachrichtigung bekommt `asked_again` und wird zu „Neue Zeit – bist du noch dabei?“.
--     Nur wer keine solche hat (z. B. weil sie älter ist), bekommt eine neue.
--   * Nur vor Beginn, nur bei Plänen, die weder abgeschlossen noch abgesagt sind; Rate Limit, Audit-Log.

alter table public.plan_participants
  add column previous_status public.attendance_status check (previous_status is distinct from 'invited');

comment on column public.plan_participants.previous_status is
  'P23: Antwort vor dem letzten „Alle neu fragen“ (nur Hinweis, zählt nirgends mit).';

-- Liefert die Zahl der neu Gefragten (Mitglieder mit Antwort + gelöschte Gast-Antworten).
create function public.ask_plan_again(p_plan_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
  v_member record;
  v_members integer := 0;
  v_guests integer := 0;
  v_updated integer;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id for update;
  if not found or not app_private.can_manage_plan(v_plan) then
    perform app_private.forbid();
  end if;
  if v_plan.status in ('completed', 'cancelled') then
    perform app_private.fail('plan_locked');
  end if;
  if v_plan.starts_at <= now() then
    perform app_private.fail('plan_already_started');
  end if;
  perform app_private.rate_limit('plan_ask_again', 10, interval '1 hour');

  for v_member in
    update public.plan_participants pp
    set previous_status = pp.attendance_status, attendance_status = 'invited', responded_at = null
    where pp.plan_id = p_plan_id and pp.user_id <> v_uid and pp.attendance_status <> 'invited'
    returning pp.user_id
  loop
    v_members := v_members + 1;
    -- Wer nicht mehr in der Crew ist, wird nicht benachrichtigt (die Zeile bleibt wie bisher stehen).
    continue when not exists (select 1 from public.crew_members m
                              where m.crew_id = v_plan.crew_id and m.user_id = v_member.user_id);

    update public.notifications n
    set payload = n.payload || jsonb_build_object('asked_again', true, 'starts_at', v_plan.starts_at)
    where n.user_id = v_member.user_id and n.type = 'plan_changed' and n.related_entity_id = p_plan_id
      and n.actor_id is not distinct from v_uid and n.read_at is null
      and n.created_at > now() - interval '15 minutes';
    get diagnostics v_updated = row_count;

    if v_updated = 0 then
      perform app_private.notify(v_member.user_id, 'plan_changed', v_uid, v_plan.crew_id, 'plan', p_plan_id,
                                 jsonb_build_object('title', v_plan.title, 'changed', jsonb_build_array('starts_at'),
                                                    'starts_at', v_plan.starts_at, 'asked_again', true),
                                 'plan_ask_again:' || p_plan_id::text || ':' || to_char(now(), 'YYYYMMDDHH24MISS'));
    end if;
  end loop;

  delete from public.plan_guests g where g.plan_id = p_plan_id;
  get diagnostics v_guests = row_count;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, crew_id, meta)
  values (v_uid, 'plan_asked_again', 'plan', p_plan_id, v_plan.crew_id,
          jsonb_build_object('members', v_members, 'guests', v_guests));

  return v_members + v_guests;
end $$;

revoke all on function public.ask_plan_again(uuid) from public, anon, authenticated;
grant execute on function public.ask_plan_again(uuid) to authenticated;
