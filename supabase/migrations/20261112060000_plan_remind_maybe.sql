-- P45 · „Vielleicht“ festmachen – die Unentschlossenen fragen
-- Für die Reservierung zählt, wer sicher kommt. Bisher fragte „Nachfragen“ (P19) nur alle ohne Antwort; wer
-- „vielleicht“ gesagt hatte, musste im Gruppenchat einzeln angeschrieben werden („Tom, Lisa – kommt ihr jetzt?“).
-- Jetzt fragt, wer organisiert (oder Owner/Admin ist), bei „Vielleicht“ mit einem Tipp genau diese Personen:
-- „Bob fragt: Bist du jetzt dabei?“ – Antippen öffnet den Plan mit der Antwortkarte.
--
-- Bewusst so gebaut:
--   * Gleiche Regeln wie P19: nur vor Beginn, nicht bei abgeschlossenen/abgesagten Plänen, nur wer noch Mitglied
--     der Crew ist, nicht die fragende Person selbst; Gruppe „Nachfragen zu Plänen“ (`plan_reminder`) schaltet es ab.
--   * Eigene Frist von 6 Stunden je Plan (`plan_reminders.maybe_sent_at`) – unabhängig von „Noch offen“, damit
--     beide Fragen am selben Abend möglich sind, aber niemand mit „vielleicht“ öfter als alle 6 Stunden gefragt wird.
--   * Wer auf der Nachrückliste steht (P26), will ja – wird nicht gefragt.
--   * Kein neuer Benachrichtigungstyp: `plan_reminder` mit `maybe: true` im Payload (eigener Text in der App).

alter table public.plan_reminders
  add column maybe_sent_at timestamptz not null default '-infinity';

comment on column public.plan_reminders.maybe_sent_at is 'P45: wann zuletzt alle mit „Vielleicht“ gefragt wurden.';

-- Fragt alle mit „Vielleicht“. Liefert die Zahl der gefragten Personen (0 zählt nicht als Nachfrage).
create function public.remind_plan_maybe(p_plan_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
  v_member record;
  v_count integer := 0;
begin
  perform app_private.rate_limit('remind_plan_maybe', 30, interval '1 hour');

  select * into v_plan from public.plans p where p.id = p_plan_id;
  if not found or not app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.forbid();
  end if;
  if not (v_plan.created_by is not distinct from v_uid
          or app_private.has_crew_role(v_plan.crew_id, array['owner', 'admin']::public.crew_role[])) then
    perform app_private.forbid();
  end if;
  if v_plan.status in ('completed', 'cancelled') then
    perform app_private.fail('plan_locked');
  end if;
  if v_plan.starts_at <= now() then
    perform app_private.fail('plan_already_started');
  end if;

  -- Sperrt die Zeile je Plan – zwei gleichzeitige Tipps fragen nicht doppelt.
  insert into public.plan_reminders (plan_id, last_sent_at, maybe_sent_at) values (p_plan_id, '-infinity', '-infinity')
  on conflict (plan_id) do nothing;
  perform 1 from public.plan_reminders r where r.plan_id = p_plan_id for update;
  if exists (select 1 from public.plan_reminders r
             where r.plan_id = p_plan_id and r.maybe_sent_at > now() - interval '6 hours') then
    perform app_private.fail('reminder_too_soon');
  end if;

  for v_member in
    select pp.user_id from public.plan_participants pp
    join public.crew_members m on m.crew_id = v_plan.crew_id and m.user_id = pp.user_id
    where pp.plan_id = p_plan_id and pp.attendance_status = 'maybe' and pp.waitlisted_at is null
      and pp.user_id <> v_uid
    order by pp.user_id
  loop
    perform app_private.notify(v_member.user_id, 'plan_reminder', v_uid, v_plan.crew_id, 'plan', p_plan_id,
                               jsonb_build_object('title', v_plan.title, 'starts_at', v_plan.starts_at, 'maybe', true),
                               'plan_reminder_maybe:' || p_plan_id::text || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    update public.plan_reminders r set maybe_sent_at = now() where r.plan_id = p_plan_id;
  end if;
  return v_count;
end $$;

revoke all on function public.remind_plan_maybe(uuid) from public, anon, authenticated;
grant execute on function public.remind_plan_maybe(uuid) to authenticated, service_role;
comment on function public.remind_plan_maybe(uuid) is 'P45: Organisator:in, Owner und Admins fragen alle mit „Vielleicht“, ob sie jetzt dabei sind (höchstens alle 6 Stunden je Plan).';
