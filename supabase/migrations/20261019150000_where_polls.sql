-- =============================================================================================
-- AFTERHOURS – „Wann“ und „Wo“ als ein Ablauf (Roadmap P1, Etappe 3a)
--
-- Nach einer Termin-Abstimmung („Wann könnt ihr?“) startet die Crew mit „Und wo?“ eine Abstimmung
-- über Orte. Bisher war das eine lose neue Abstimmung mit dem Datum im Link. Jetzt ist sie verknüpft:
--   - polls.date_poll_id zeigt auf die Termin-Abstimmung (bzw. deren Stichwahl), aus der der Termin stammt
--   - create_where_poll legt sie an und setzt den Gewinner-Termin auf JEDEN Vorschlag – vom Server, nicht
--     aus dem Link. So bekommt der Plan aus der Orts-Abstimmung Termin und Ort aus beiden Abstimmungen.
--   - je Termin-Abstimmung höchstens eine laufende oder entschiedene Orts-Abstimmung: Tippen zwei
--     Mitglieder gleichzeitig „Ort abstimmen“, entsteht keine doppelte Abstimmung. Endet sie ohne
--     Ergebnis (niemand dabei, kein Gleichstand), darf die Crew einen neuen Versuch starten.
-- =============================================================================================

alter table public.polls
  add column date_poll_id uuid references public.polls (id) on delete set null;

create index polls_date_poll_idx on public.polls (date_poll_id) where date_poll_id is not null;

create function public.create_where_poll(
  p_date_poll_id uuid, p_title text, p_ends_at timestamptz, p_options jsonb,
  p_description text default null, p_meeting_point text default null,
  p_budget_cents integer default null, p_min_participants integer default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_date_poll public.polls%rowtype;
  v_winner public.poll_options%rowtype;
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_options jsonb := '[]';
  v_option jsonb;
  v_poll_id uuid;
begin
  perform app_private.require_user();
  -- Gesperrt, damit zwei gleichzeitige Tipps nicht zwei Orts-Abstimmungen anlegen.
  select p.* into v_date_poll from public.polls p where p.id = p_date_poll_id for update;
  -- Unbekannt und fremd sehen gleich aus.
  if not found or not app_private.is_crew_member(v_date_poll.crew_id) then
    perform app_private.forbid();
  end if;
  if v_date_poll.kind <> 'date' or v_date_poll.status <> 'closed' or v_date_poll.winning_option_id is null then
    perform app_private.fail('date_poll_undecided');
  end if;
  select o.* into v_winner from public.poll_options o where o.id = v_date_poll.winning_option_id;
  if v_winner.proposed_date is null or v_winner.proposed_date < v_today
     or (v_winner.proposed_time is not null
         and (v_winner.proposed_date + v_winner.proposed_time) at time zone 'Europe/Berlin' <= now()) then
    perform app_private.fail('slot_in_past');
  end if;
  if exists (
    select 1 from public.polls w
    where w.date_poll_id = v_date_poll.id
      and (w.status = 'open' or w.winning_option_id is not null or w.is_tie)
  ) then
    perform app_private.fail('where_poll_exists');
  end if;

  if p_options is null or jsonb_typeof(p_options) <> 'array' then
    perform app_private.fail('invalid_options');
  end if;
  for v_option in select e.value from jsonb_array_elements(p_options) e loop
    if jsonb_typeof(v_option) <> 'object' then
      perform app_private.fail('invalid_options');
    end if;
    -- Der Termin kommt immer aus der Termin-Abstimmung, egal was die App mitschickt.
    v_options := v_options || jsonb_build_array(v_option || jsonb_build_object(
      'proposed_date', v_winner.proposed_date,
      'proposed_time', to_char(v_winner.proposed_time, 'HH24:MI')));
  end loop;

  -- Alle übrigen Prüfungen (Titel, Frist, 1–10 Optionen, Orte, Rate Limit, offene Abstimmungen) und
  -- die Benachrichtigung der Crew wie bei jeder Abstimmung.
  v_poll_id := public.create_poll(v_date_poll.crew_id, p_title, p_ends_at, v_options, p_description,
                                  p_meeting_point, p_budget_cents, p_min_participants);
  update public.polls set date_poll_id = v_date_poll.id where id = v_poll_id;
  return v_poll_id;
end $$;

revoke all on function public.create_where_poll(uuid, text, timestamptz, jsonb, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.create_where_poll(uuid, text, timestamptz, jsonb, text, text, integer, integer) to authenticated, service_role;
