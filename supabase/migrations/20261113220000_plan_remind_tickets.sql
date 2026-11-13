-- P53 Etappe 2a · Nachfragen bei „noch ohne Ticket“
-- Der Ticket-Check (P53) zeigt, wer zugesagt hat und noch kein Ticket hat. Bisher musste die organisierende Person
-- diese Leute dann doch im Gruppenchat einzeln anschreiben („Tom, Lisa – habt ihr schon Tickets?“). Jetzt fragt,
-- wer organisiert (oder Owner/Admin ist), mit einem Tipp genau diese Personen: „Bob fragt: Hast du dein Ticket?“ –
-- Antippen öffnet den Plan mit „Hast du dein Ticket?“ in der Antwortkarte.
--
-- Bewusst so gebaut:
--   * Gleiche Regeln wie P19/P45: nur vor Beginn, nicht bei abgeschlossenen/abgesagten Plänen, nur wer noch Mitglied
--     der Crew ist, nicht die fragende Person selbst; Gruppe „Nachfragen zu Plänen“ (`plan_reminder`) schaltet es ab.
--   * Nur bei eingeschaltetem Ticket-Check, nur wer „Bin dabei“ gesagt hat und noch nicht „Hab mein Ticket“ –
--     genau die Liste „Noch ohne Ticket“, die alle sehen. Wer „vielleicht“ gesagt hat, fragt P45.
--   * Eigene Frist von 6 Stunden je Plan (`plan_reminders.ticket_sent_at`) – unabhängig von P19/P45.
--   * Kein neuer Benachrichtigungstyp: `plan_reminder` mit `ticket: true` im Payload (eigener Text in der App).
--   * AFTERHOURS behauptet nichts über Tickets und verlinkt keinen Kauf – es fragt nur nach der eigenen Angabe.

alter table public.plan_reminders
  add column ticket_sent_at timestamptz not null default '-infinity';

comment on column public.plan_reminders.ticket_sent_at is 'P53: wann zuletzt alle mit Zusage, aber ohne Ticket gefragt wurden.';

-- Fragt alle mit „Bin dabei“, die noch kein Ticket angegeben haben. Liefert die Zahl der gefragten Personen
-- (0 zählt nicht als Nachfrage).
create function public.remind_plan_tickets(p_plan_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
  v_member record;
  v_count integer := 0;
begin
  perform app_private.rate_limit('remind_plan_tickets', 30, interval '1 hour');

  select * into v_plan from public.plans p where p.id = p_plan_id;
  if not found or not app_private.can_manage_plan(v_plan) then
    perform app_private.forbid();
  end if;
  if v_plan.status in ('completed', 'cancelled') then
    perform app_private.fail('plan_locked');
  end if;
  if not v_plan.tickets_needed then
    perform app_private.fail('plan_tickets_off');
  end if;
  if v_plan.starts_at <= now() then
    perform app_private.fail('plan_already_started');
  end if;

  -- Sperrt die Zeile je Plan – zwei gleichzeitige Tipps fragen nicht doppelt.
  insert into public.plan_reminders (plan_id, last_sent_at) values (p_plan_id, '-infinity')
  on conflict (plan_id) do nothing;
  perform 1 from public.plan_reminders r where r.plan_id = p_plan_id for update;
  if exists (select 1 from public.plan_reminders r
             where r.plan_id = p_plan_id and r.ticket_sent_at > now() - interval '6 hours') then
    perform app_private.fail('reminder_too_soon');
  end if;

  for v_member in
    select pp.user_id from public.plan_participants pp
    join public.crew_members m on m.crew_id = v_plan.crew_id and m.user_id = pp.user_id
    where pp.plan_id = p_plan_id and pp.attendance_status = 'going' and not pp.has_ticket
      and pp.waitlisted_at is null and pp.user_id <> v_uid
    order by pp.user_id
  loop
    perform app_private.notify(v_member.user_id, 'plan_reminder', v_uid, v_plan.crew_id, 'plan', p_plan_id,
                               jsonb_build_object('title', v_plan.title, 'starts_at', v_plan.starts_at, 'ticket', true),
                               'plan_reminder_ticket:' || p_plan_id::text || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    update public.plan_reminders r set ticket_sent_at = now() where r.plan_id = p_plan_id;
  end if;
  return v_count;
end $$;

revoke all on function public.remind_plan_tickets(uuid) from public, anon, authenticated;
grant execute on function public.remind_plan_tickets(uuid) to authenticated, service_role;
comment on function public.remind_plan_tickets(uuid) is 'P53: Organisator:in, Owner und Admins fragen alle mit Zusage, aber ohne Ticket, ob sie schon eins haben (höchstens alle 6 Stunden je Plan).';
