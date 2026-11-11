-- P40 · „Und Sonntag?“ – Termin nachreichen.
-- Passt bei „Wann könnt ihr?“ keiner der Termine, fragt im Gruppenchat jemand „und Sonntag?“ – und alle müssen
-- zurück in den Chat. Jetzt schlägt jedes Mitglied der Crew in einer laufenden Termin-Abstimmung selbst einen
-- weiteren Termin vor.
--
-- Regeln:
--   * nur Mitglieder der Crew (sonst `forbidden`), nur solange die Abstimmung läuft (`poll_closed`)
--   * nur Termin-Abstimmungen (`poll_slot_unsupported`) und keine Stichwahl – dort geht es nur noch um die
--     Termine mit Gleichstand (`poll_slot_runoff`)
--   * gleiche Prüfung wie beim Anlegen (`create_date_poll`): Tag in der Zukunft (Berliner Zeit; mit Uhrzeit
--     zählt der Zeitpunkt), höchstens ein Jahr voraus, kein Termin doppelt (`poll_slot_invalid`, `poll_slot_past`,
--     `poll_slot_duplicate`), höchstens 10 Termine insgesamt (`poll_slot_full`)
--   * der Titel entsteht auf dem Server („Sonntag, 22. November“), wie bei allen Terminen
--   * gilt die Abstimmung für einen festen Ort (P5 Etappe 3), trägt der neue Termin denselben Ort
--   * der neue Termin kommt hinten an (`position` = bisher höchste + 1). Bestehende Positionen bleiben, weil
--     der Stimmzettel für Gäste (W3) Vorschläge über ihre Position anspricht
--   * wer vorschlägt, ist dort gleich „dabei“ (in der Regel ist es der Tag, an dem man selbst kann)
--   * wer aus der Crew schon abgestimmt hat, bekommt Bescheid (Typ `poll_reminder` mit `added`, Gruppe
--     „Erinnerungen“) – wer noch nicht abgestimmt hat, sieht den Termin ohnehin beim Abstimmen
--   * höchstens 10 neue Termine je Person und Stunde

create function public.add_poll_slot(p_poll_id uuid, p_date date, p_time time default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_poll public.polls%rowtype;
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_time time := date_trunc('minute', p_time::interval)::time;
  v_activity_id uuid;
  v_option_id uuid;
  v_member record;
begin
  select * into v_poll from public.polls p where p.id = p_poll_id for update;
  if not found or not app_private.is_crew_member(v_poll.crew_id) then
    perform app_private.forbid();
  end if;
  if v_poll.status <> 'open' or v_poll.ends_at <= now() then
    perform app_private.fail('poll_closed');
  end if;
  if v_poll.kind <> 'date' then
    perform app_private.fail('poll_slot_unsupported');
  end if;
  if v_poll.parent_poll_id is not null then
    perform app_private.fail('poll_slot_runoff');
  end if;
  if p_date is null or p_date > v_today + 365 then
    perform app_private.fail('poll_slot_invalid');
  end if;
  if p_date < v_today or (v_time is not null and (p_date + v_time) at time zone 'Europe/Berlin' <= now()) then
    perform app_private.fail('poll_slot_past');
  end if;
  if exists (select 1 from public.poll_options o
             where o.poll_id = v_poll.id and o.proposed_date = p_date and o.proposed_time is not distinct from v_time) then
    perform app_private.fail('poll_slot_duplicate');
  end if;
  if (select count(*) from public.poll_options o where o.poll_id = v_poll.id) >= 10 then
    perform app_private.fail('poll_slot_full');
  end if;
  perform app_private.rate_limit('poll_slot_add', 10, interval '1 hour');

  -- Fester Ort: alle bisherigen Termine tragen denselben (und keiner keinen).
  select min(o.activity_id::text)::uuid into v_activity_id from public.poll_options o
  where o.poll_id = v_poll.id
  having count(distinct o.activity_id) = 1 and count(*) = count(o.activity_id);
  if v_activity_id is not null
     and not exists (select 1 from public.activities a where a.id = v_activity_id and a.is_active) then
    v_activity_id := null;
  end if;

  insert into public.poll_options (poll_id, activity_id, title, proposed_date, proposed_time, position)
  values (v_poll.id, v_activity_id, app_private.german_date_label(p_date), p_date, v_time,
          coalesce((select max(o.position) + 1 from public.poll_options o where o.poll_id = v_poll.id), 0))
  returning id into v_option_id;

  insert into public.poll_votes (poll_id, poll_option_id, user_id, response)
  values (v_poll.id, v_option_id, v_uid, 'yes');

  for v_member in
    select m.user_id from public.crew_members m
    where m.crew_id = v_poll.crew_id and m.user_id <> v_uid
      and exists (select 1 from public.poll_votes v where v.poll_id = v_poll.id and v.user_id = m.user_id)
  loop
    perform app_private.notify(v_member.user_id, 'poll_reminder', v_uid, v_poll.crew_id, 'poll', v_poll.id,
                               jsonb_build_object('title', v_poll.title, 'added', true,
                                                  'date', p_date, 'time', to_char(v_time, 'HH24:MI')),
                               'poll_slot_added:' || v_option_id::text);
  end loop;
  return v_option_id;
end $$;

revoke all on function public.add_poll_slot(uuid, date, time) from public, anon, authenticated;
grant execute on function public.add_poll_slot(uuid, date, time) to authenticated, service_role;

comment on function public.add_poll_slot(uuid, date, time) is
  'P40: weiteren Termin in einer laufenden Termin-Abstimmung vorschlagen (jedes Mitglied); liefert die neue Option.';
