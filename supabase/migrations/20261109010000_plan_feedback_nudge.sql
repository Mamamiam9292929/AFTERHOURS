-- P29 Etappe 3 · „Wie war’s?“ am Morgen danach
-- Die Erinnerung „Fotos von gestern?“ (P16) fragt jetzt auch, wie der Abend war – in derselben einen
-- Benachrichtigung, keine zweite. Antippen führt dann zu „Wie war’s?“ (`/plans/<id>#wie-wars`), die Fotos
-- liegen auf derselben Seite darunter.
--
-- Wann „Wie war’s?“ dazukommt: Der Plan ist abgeschlossen (nur dann nimmt `set_plan_feedback` Antworten an),
-- höchstens 30 Tage nach dem Abschluss, die Person stand bei „Bin dabei“ und hat noch nicht geantwortet.
-- Abgeschlossen wird von Hand (Organisator:in, Owner, Admins); wird der Plan erst am zweiten Tag
-- abgeschlossen, kommt die Erinnerung eben dann – solange noch keine verschickt wurde und das Fenster von
-- 3 Tagen offen ist. Genau eine Erinnerung je Person und Plan bleibt die Regel (`plan_photo_nudges`).
--
-- Neu ist, dass eine Erinnerung auch kommt, wenn Fotos schon reichen (mehr als eins oder ein eigenes) –
-- dann nur mit „Wie war’s?“. Umgekehrt bleibt alles wie in P16. Im Payload stehen `photos` und `feedback`,
-- damit Text und Ziel passen. Gleiche Gruppe in den Einstellungen („Am Morgen danach“, `plan_photo_nudge`).

create or replace function app_private.send_plan_photo_nudges(p_user_id uuid, p_now timestamptz) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (p_now at time zone 'Europe/Berlin')::date;
  v_row record;
  v_count integer := 0;
begin
  if p_now is null then
    return 0;
  end if;
  for v_row in
    select x.* from (
      select p.id as plan_id, p.crew_id, p.title, p.starts_at, m.user_id,
             (p.starts_at at time zone 'Europe/Berlin')::date = v_today - 1 as yesterday,
             (select count(*) from public.plan_photos ph where ph.plan_id = p.id and ph.uploaded_at is not null) <= 1
               and not exists (select 1 from public.plan_photos ph
                               where ph.plan_id = p.id and ph.uploaded_by = m.user_id and ph.uploaded_at is not null) as photos,
             p.status = 'completed'
               and coalesce(p.completed_at, p.starts_at) > p_now - interval '30 days'
               and not exists (select 1 from public.plan_feedback f where f.plan_id = p.id and f.user_id = m.user_id) as feedback
      from public.plans p
      join public.crew_members m on m.crew_id = p.crew_id
      join public.plan_participants pp on pp.plan_id = p.id and pp.user_id = m.user_id and pp.attendance_status = 'going'
      where p.starts_at > p_now - interval '30 days'
        and p.starts_at < p_now
        and p.status <> 'cancelled'
        and p_now >= ((p.starts_at at time zone 'Europe/Berlin')::date + 1 + time '10:00') at time zone 'Europe/Berlin'
        and p_now >= coalesce(p.ends_at, p.starts_at)
        and p_now < coalesce(p.ends_at, p.starts_at) + interval '3 days'
        and (p_user_id is null or exists (
          select 1 from public.crew_members me where me.crew_id = p.crew_id and me.user_id = p_user_id
        ))
        and not exists (select 1 from public.plan_photo_nudges r where r.plan_id = p.id and r.user_id = m.user_id)
    ) x
    where x.photos or x.feedback
    order by x.starts_at, x.plan_id, x.user_id
    limit 500
  loop
    insert into public.plan_photo_nudges (plan_id, user_id) values (v_row.plan_id, v_row.user_id)
    on conflict do nothing;
    if found then
      -- Wer die Gruppe abgeschaltet hat, bekommt nichts – der Plan gilt trotzdem als erinnert.
      perform app_private.notify(v_row.user_id, 'plan_photo_nudge', null, v_row.crew_id, 'plan', v_row.plan_id,
        jsonb_build_object('title', v_row.title, 'starts_at', v_row.starts_at, 'yesterday', v_row.yesterday,
                           'photos', v_row.photos, 'feedback', v_row.feedback),
        'plan_photo_nudge:' || v_row.plan_id::text);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end $$;

revoke all on function app_private.send_plan_photo_nudges(uuid, timestamptz) from public, anon, authenticated;

comment on function app_private.send_plan_photo_nudges(uuid, timestamptz) is
  'P16 + P29 Etappe 3: eine Erinnerung am Morgen danach – „Fotos von gestern?“ und/oder „Wie war’s?“ (payload photos/feedback).';
