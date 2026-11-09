-- P29 Etappe 3 · „Wie war’s?“ am Morgen danach – zusammen mit „Fotos von gestern?“ (P16)
-- Bisher kam am Morgen nach einem Plan nur „Fotos von gestern?“ – und nur, solange kaum Fotos geteilt sind.
-- Das Urteil „Wie war’s?“ (P29) fand nur, wer die Planseite von selbst öffnete. Jetzt bleibt es bei genau einer
-- Benachrichtigung je Person und Plan (gleiche Liste `plan_photo_nudges`, gleicher Typ, gleiche abschaltbare
-- Gruppe), aber sie sagt, was gerade fehlt:
--   * `feedback`: Der Plan ist abgeschlossen, die Frist von 30 Tagen läuft und das eigene Urteil fehlt – dann
--     fragt sie „Wie war’s?“ und führt zur Karte `#wie-wars`.
--   * `photos`: Wie bisher – höchstens ein Foto geteilt, selbst noch keins.
--   * `close`: Der Plan ist noch nicht abgeschlossen und die Person darf ihn abschließen (organisiert, Owner,
--     Admin). Ohne Abschluss gibt es kein „Wie war’s?“ – deshalb der Hinweis. Allein löst er nichts aus.
-- Gesendet wird, wenn `feedback` oder `photos` zutrifft. Zeitfenster, Empfänger:innen (Mitglieder mit „Bin dabei“)
-- und „genau einmal“ bleiben wie in 20261102160000_plan_photo_nudges.sql. Ältere Benachrichtigungen ohne die
-- neuen Felder zeigt die App wie bisher als „Fotos von gestern?“.
--
-- Keine neue Funktion und keine neuen Rechte: Ersetzt wird nur der interne Teil; `public.send_plan_photo_nudges()`
-- und `app_private.send_due_plan_photo_nudges()` rufen ihn unverändert auf.

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
    select c.*
    from (
      select p.id as plan_id, p.crew_id, p.title, p.starts_at, m.user_id,
             (p.starts_at at time zone 'Europe/Berlin')::date = v_today - 1 as yesterday,
             -- Fotos: höchstens eins geteilt, selbst keins (wie P16).
             (select count(*) from public.plan_photos ph where ph.plan_id = p.id and ph.uploaded_at is not null) <= 1
               and not exists (select 1 from public.plan_photos ph
                               where ph.plan_id = p.id and ph.uploaded_by = m.user_id and ph.uploaded_at is not null) as photos,
             -- Wie war’s: abgeschlossen, Frist offen (wie app_private.plan_feedback_open, zum Zeitpunkt p_now), Urteil fehlt.
             p.status = 'completed'
               and coalesce(p.completed_at, p.starts_at) > p_now - interval '30 days'
               and not exists (select 1 from public.plan_feedback f where f.plan_id = p.id and f.user_id = m.user_id) as feedback,
             -- Abschließen: nur, wer den Plan verwalten darf (wie app_private.can_manage_plan), und nur, wenn es geht.
             p.status in ('confirmed', 'booking_pending', 'booked')
               and (p.created_by = m.user_id or m.role in ('owner', 'admin')) as can_close
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
    ) c
    where c.photos or c.feedback
    order by c.starts_at, c.plan_id, c.user_id
    limit 500
  loop
    insert into public.plan_photo_nudges (plan_id, user_id) values (v_row.plan_id, v_row.user_id)
    on conflict do nothing;
    if found then
      -- Wer die Gruppe abgeschaltet hat, bekommt nichts – der Plan gilt trotzdem als erinnert.
      perform app_private.notify(v_row.user_id, 'plan_photo_nudge', null, v_row.crew_id, 'plan', v_row.plan_id,
        jsonb_build_object('title', v_row.title, 'starts_at', v_row.starts_at, 'yesterday', v_row.yesterday,
                           'photos', v_row.photos, 'feedback', v_row.feedback, 'close', v_row.can_close),
        'plan_photo_nudge:' || v_row.plan_id::text);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end $$;

revoke all on function app_private.send_plan_photo_nudges(uuid, timestamptz) from public, anon, authenticated;

comment on function app_private.send_plan_photo_nudges(uuid, timestamptz) is
  'P16 + P29 Etappe 3: am Morgen danach genau eine Benachrichtigung je Zusage – „Wie war’s?“ (abgeschlossen, Urteil fehlt) und/oder „Fotos von gestern?“ (kaum Fotos), Hinweis zum Abschließen für alle, die es dürfen.';
