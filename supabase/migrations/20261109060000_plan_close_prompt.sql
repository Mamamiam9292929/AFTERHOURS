-- P30 · „Fand’s statt?“ – Abend abschließen mit einem Tipp
-- Rückblick, Lieblingsabende, „Wie war’s?“ und Punkte hängen am Abschluss eines Plans. Den macht bisher nur,
-- wer daran denkt. Jetzt:
--
-- 1. Am Morgen danach fragt die eine Erinnerung (P16/P29, `plan_photo_nudge`) die organisierende Person
--    (`plans.created_by`) bei einem noch offenen Plan zusätzlich „Fand der Abend statt?“ (payload `close`).
--    Das gilt auch, wenn sie nicht zugesagt hatte oder Fotos schon reichen.
-- 2. `close_plan(plan, happened)`: „Abschließen“ (auch aus „Vorschlag“, der Abend hat ja stattgefunden) oder
--    „Hat nicht stattgefunden“ (= absagen, ohne Benachrichtigung an alle – der Abend ist vorbei, eine
--    Absage-Nachricht wäre nur Lärm). Nur Organisator:in, Owner und Admins, erst ab Beginn.
-- 3. Nach dem Abschluss bekommen alle mit Zusage, die noch nicht nach „Wie war’s?“ gefragt wurden, genau
--    einmal diese Frage. Dafür merkt sich die Erinnerungstabelle Fotos (Zeile da) und Urteil
--    (`feedback_asked_at`) getrennt. Die Frage geht sofort raus (`close_plan` stößt an), beim Abschluss
--    über „Organisieren“ ebenso – auch dort ruft die App jetzt `close_plan`. Vor 10 Uhr am Morgen danach
--    wartet sie und kommt mit „Fotos von gestern?“ zusammen.
--
-- Kein automatischer Abschluss: Punkte gibt es nur für Abende, die jemand bestätigt.

alter table public.plan_photo_nudges add column feedback_asked_at timestamptz;

comment on column public.plan_photo_nudges.feedback_asked_at is
  'P30: wann „Wie war’s?“ gefragt wurde (null = noch nicht). Die Zeile selbst steht für die Erinnerung am Morgen danach.';

-- Bestehende Erinnerungen zu schon abgeschlossenen Plänen haben „Wie war’s?“ (P29 Etappe 3) bereits gefragt,
-- soweit es fällig war – nicht noch einmal fragen. Offene Pläne bleiben offen und fragen beim Abschluss.
update public.plan_photo_nudges r set feedback_asked_at = r.sent_at
from public.plans p
where p.id = r.plan_id and p.status = 'completed' and r.feedback_asked_at is null;

-- Fällige Erinnerungen zum Zeitpunkt p_now (Pläne der Crews von p_user_id oder alle bei null).
--   photos   – wie P16: erste Erinnerung, Zusage, höchstens ein Foto, kein eigenes, bis 3 Tage nach dem Ende
--   feedback – wie P29 Etappe 3, zusätzlich ein zweites Mal möglich, wenn die erste Erinnerung ohne die Frage
--              kam (Plan war da noch offen): dann bis 3 Tage nach dem Abschluss
--   close    – neu: erste Erinnerung an die organisierende Person, Plan noch offen, bis 3 Tage nach dem Ende
-- Erste Erinnerung und nachgereichte Frage haben eigene dedupe-Schlüssel; je Person und Plan höchstens zwei
-- Benachrichtigungen, die zweite nur mit „Wie war’s?“.
create or replace function app_private.send_plan_photo_nudges(p_user_id uuid, p_now timestamptz) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (p_now at time zone 'Europe/Berlin')::date;
  v_row record;
  v_count integer := 0;
  v_done boolean;
begin
  if p_now is null then
    return 0;
  end if;
  for v_row in
    select x.* from (
      select p.id as plan_id, p.crew_id, p.title, p.starts_at, m.user_id,
             r.plan_id is not null as reminded,
             p.status = 'completed' as completed,
             (p.starts_at at time zone 'Europe/Berlin')::date = v_today - 1 as yesterday,
             r.plan_id is null
               and pp.attendance_status is not distinct from 'going'
               and p_now < coalesce(p.ends_at, p.starts_at) + interval '3 days'
               and (select count(*) from public.plan_photos ph where ph.plan_id = p.id and ph.uploaded_at is not null) <= 1
               and not exists (select 1 from public.plan_photos ph
                               where ph.plan_id = p.id and ph.uploaded_by = m.user_id and ph.uploaded_at is not null) as photos,
             r.feedback_asked_at is null
               and pp.attendance_status is not distinct from 'going'
               and p.status = 'completed'
               and coalesce(p.completed_at, p.starts_at) > p_now - interval '30 days'
               and (p_now < coalesce(p.ends_at, p.starts_at) + interval '3 days'
                    or (r.plan_id is not null and p.completed_at > p_now - interval '3 days'))
               and not exists (select 1 from public.plan_feedback f where f.plan_id = p.id and f.user_id = m.user_id) as feedback,
             r.plan_id is null
               and m.user_id = p.created_by
               and p.status in ('proposed', 'confirmed', 'booking_pending', 'booked')
               and p_now < coalesce(p.ends_at, p.starts_at) + interval '3 days' as close
      from public.plans p
      join public.crew_members m on m.crew_id = p.crew_id
      left join public.plan_participants pp on pp.plan_id = p.id and pp.user_id = m.user_id
      left join public.plan_photo_nudges r on r.plan_id = p.id and r.user_id = m.user_id
      where p.starts_at > p_now - interval '30 days'
        and p.starts_at < p_now
        and p.status <> 'cancelled'
        and p_now >= ((p.starts_at at time zone 'Europe/Berlin')::date + 1 + time '10:00') at time zone 'Europe/Berlin'
        and p_now >= coalesce(p.ends_at, p.starts_at)
        and (pp.attendance_status = 'going' or m.user_id = p.created_by)
        and (p_user_id is null or exists (
          select 1 from public.crew_members me where me.crew_id = p.crew_id and me.user_id = p_user_id
        ))
        and (r.plan_id is null or r.feedback_asked_at is null)
    ) x
    where x.photos or x.feedback or x.close
    order by x.starts_at, x.plan_id, x.user_id
    limit 500
  loop
    if v_row.reminded then
      -- Erinnerung kam schon, damals ohne „Wie war’s?“: nur noch diese Frage, genau einmal.
      update public.plan_photo_nudges r set feedback_asked_at = p_now
      where r.plan_id = v_row.plan_id and r.user_id = v_row.user_id and r.feedback_asked_at is null;
      v_done := found;
    else
      -- Ist der Plan schon abgeschlossen, ist „Wie war’s?“ damit erledigt – gefragt oder schon beantwortet.
      insert into public.plan_photo_nudges (plan_id, user_id, feedback_asked_at)
      values (v_row.plan_id, v_row.user_id, case when v_row.completed then p_now end)
      on conflict do nothing;
      v_done := found;
    end if;
    if v_done then
      -- Wer die Gruppe abgeschaltet hat, bekommt nichts – der Plan gilt trotzdem als erinnert.
      perform app_private.notify(v_row.user_id, 'plan_photo_nudge', null, v_row.crew_id, 'plan', v_row.plan_id,
        jsonb_build_object('title', v_row.title, 'starts_at', v_row.starts_at, 'yesterday', v_row.yesterday,
                           'photos', v_row.photos, 'feedback', v_row.feedback, 'close', v_row.close),
        case when v_row.reminded then 'plan_feedback_ask:' else 'plan_photo_nudge:' end || v_row.plan_id::text);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end $$;

revoke all on function app_private.send_plan_photo_nudges(uuid, timestamptz) from public, anon, authenticated;

comment on function app_private.send_plan_photo_nudges(uuid, timestamptz) is
  'P16 + P29 Etappe 3 + P30: Erinnerung am Morgen danach – Fotos, „Wie war’s?“ und „Fand der Abend statt?“ (payload photos/feedback/close); „Wie war’s?“ nach spätem Abschluss genau einmal nachgereicht.';

-- „Fand der Abend statt?“ – p_happened = true schließt ab, false sagt still ab. Liefert den neuen Status.
-- Wiederholter Aufruf mit demselben Ergebnis ist harmlos (liefert den Status, ändert nichts).
create function public.close_plan(p_plan_id uuid, p_happened boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id for update;
  if not found or not app_private.can_manage_plan(v_plan) then
    perform app_private.forbid();
  end if;
  if p_happened is null then
    perform app_private.fail('invalid_input');
  end if;
  if (p_happened and v_plan.status = 'completed') or (not p_happened and v_plan.status = 'cancelled') then
    return v_plan.status::text;
  end if;
  if v_plan.status not in ('proposed', 'confirmed', 'booking_pending', 'booked') then
    perform app_private.fail('plan_locked');
  end if;
  if v_plan.starts_at > now() then
    perform app_private.fail('plan_not_started');
  end if;
  perform app_private.rate_limit('close_plan', 30, interval '1 hour');

  if p_happened then
    update public.plans p set status = 'completed', completed_at = now() where p.id = p_plan_id;
    perform app_private.award_plan_rewards(p_plan_id);
    -- Wer abschließt, steht gerade vor „Wie war’s?“ – nicht noch extra fragen. Vor 10 Uhr am Morgen danach
    -- bleibt die eigene Erinnerung (Fotos, und „Wie war’s?“, falls dann noch offen) wie für alle anderen.
    if now() >= ((v_plan.starts_at at time zone 'Europe/Berlin')::date + 1 + time '10:00') at time zone 'Europe/Berlin'
       and now() >= coalesce(v_plan.ends_at, v_plan.starts_at) then
      insert into public.plan_photo_nudges (plan_id, user_id, feedback_asked_at) values (p_plan_id, v_uid, now())
      on conflict (plan_id, user_id) do update set feedback_asked_at = coalesce(public.plan_photo_nudges.feedback_asked_at, excluded.feedback_asked_at);
    end if;
  else
    update public.booking_requests b set status = 'cancelled_by_user'
    where b.plan_id = p_plan_id and b.status in ('not_started', 'in_progress', 'awaiting_response');
    update public.plans p
    set status = 'cancelled', cancelled_at = now(),
        booking_status = case when p.booking_status in ('in_progress', 'awaiting_response') then 'cancelled_by_user'::public.booking_status else p.booking_status end
    where p.id = p_plan_id;
  end if;

  perform app_private.audit('plan_status_changed', 'plan', p_plan_id, v_plan.crew_id,
                            jsonb_build_object('from', v_plan.status::text,
                                               'to', case when p_happened then 'completed' else 'cancelled' end,
                                               'via', 'close_plan'));

  -- „Wie war’s?“ an alle mit Zusage, sobald es fällig ist (vor 10 Uhr am Morgen danach wartet es).
  if p_happened then
    perform app_private.send_plan_photo_nudges(v_uid, now());
  end if;
  return case when p_happened then 'completed' else 'cancelled' end;
end $$;

revoke all on function public.close_plan(uuid, boolean) from public, anon, authenticated;
grant execute on function public.close_plan(uuid, boolean) to authenticated;

comment on function public.close_plan(uuid, boolean) is
  'P30: „Fand der Abend statt?“ – abschließen (auch aus Vorschlag) oder still absagen, nur ab Beginn, nur wer den Plan verwalten darf.';
