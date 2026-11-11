-- P39 · „Noch einen Tag?“ – Frist einer laufenden Abstimmung verlängern.
-- Abstimmungen scheitern oft an zwei Leuten, die noch nicht reingeschaut haben. Statt zu beenden und neu
-- anzufangen, verlängert, wer die Abstimmung gestartet hat (oder Owner/Admin der Crew ist), die Frist –
-- alle Stimmen (auch die von Gästen) bleiben.
--
-- Regeln:
--   * nur solange die Abstimmung läuft (offen und Frist nicht abgelaufen), sonst `poll_closed`
--   * die neue Frist liegt nach der bisherigen (`poll_extend_not_later`) und höchstens 14 Tage in der
--     Zukunft (`poll_extend_too_far`)
--   * spätestens 30 Minuten vor dem frühesten Termin eines Vorschlags, der noch bevorsteht (Tag ohne Uhrzeit
--     = Mitternacht Berliner Zeit) – sonst wäre über einen Termin abgestimmt, der schon war (`poll_extend_too_late`)
--   * nicht bei Abstimmungen einer laufenden Serie „Jede Woche neu“ (S7): die nächste Runde rechnet von der
--     Frist aus – verlängern würde die Serie dauerhaft verschieben (`poll_extend_series`)
-- Danach ist die Endspurt-Erinnerung (P15) zur neuen Frist wieder fällig, und wer aus der Crew noch nicht
-- abgestimmt hat, bekommt Bescheid (Typ `poll_reminder` mit `extended: true`, Gruppe „Erinnerungen“) –
-- einmal je neuer Frist. Höchstens 10 Verlängerungen je Person und Stunde.

create function public.extend_poll(p_poll_id uuid, p_ends_at timestamptz) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_poll public.polls%rowtype;
  v_ends timestamptz := date_trunc('minute', p_ends_at);
  v_first timestamptz;
  v_member record;
begin
  select * into v_poll from public.polls p where p.id = p_poll_id for update;
  if not found or not app_private.is_crew_member(v_poll.crew_id) then
    perform app_private.forbid();
  end if;
  if not (v_poll.created_by is not distinct from v_uid
          or app_private.has_crew_role(v_poll.crew_id, array['owner', 'admin']::public.crew_role[])) then
    perform app_private.forbid();
  end if;
  if v_poll.status <> 'open' or v_poll.ends_at <= now() then
    perform app_private.fail('poll_closed');
  end if;
  if v_ends is null or v_ends <= v_poll.ends_at then
    perform app_private.fail('poll_extend_not_later');
  end if;
  if v_ends > now() + interval '14 days' then
    perform app_private.fail('poll_extend_too_far');
  end if;
  if v_poll.series_id is not null
     and exists (select 1 from public.poll_series s where s.id = v_poll.series_id and s.active) then
    perform app_private.fail('poll_extend_series');
  end if;
  select min((o.proposed_date + coalesce(o.proposed_time, time '00:00')) at time zone 'Europe/Berlin') into v_first
  from public.poll_options o
  where o.poll_id = v_poll.id
    and o.proposed_date is not null
    and (o.proposed_date + coalesce(o.proposed_time, time '00:00')) at time zone 'Europe/Berlin' > now();
  if v_first is not null and v_ends > v_first - interval '30 minutes' then
    perform app_private.fail('poll_extend_too_late');
  end if;
  perform app_private.rate_limit('poll_extend', 10, interval '1 hour');

  update public.polls set ends_at = v_ends where id = v_poll.id;
  -- P15: Endspurt-Erinnerung zur neuen Frist wieder fällig.
  delete from public.poll_closing_reminders r where r.poll_id = v_poll.id;

  for v_member in
    select m.user_id from public.crew_members m
    where m.crew_id = v_poll.crew_id and m.user_id <> v_uid
      and not exists (select 1 from public.poll_votes v where v.poll_id = v_poll.id and v.user_id = m.user_id)
  loop
    perform app_private.notify(v_member.user_id, 'poll_reminder', v_uid, v_poll.crew_id, 'poll', v_poll.id,
                               jsonb_build_object('title', v_poll.title, 'ends_at', v_ends, 'extended', true),
                               'poll_extended:' || v_poll.id::text || ':' || extract(epoch from v_ends)::bigint::text);
  end loop;
  return v_ends;
end $$;

revoke all on function public.extend_poll(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.extend_poll(uuid, timestamptz) to authenticated, service_role;

comment on function public.extend_poll(uuid, timestamptz) is
  'P39: Frist einer laufenden Abstimmung verlängern (Erstellerin, Owner, Admin); liefert die neue Frist.';
