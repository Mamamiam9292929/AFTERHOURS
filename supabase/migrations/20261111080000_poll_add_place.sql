-- P40 Etappe 2 · „Und das Kino?“ – Ort nachreichen.
-- Wie `add_poll_slot` (Etappe 1), nur für Orts-Abstimmungen („Was machen wir?“, auch „Und wo?“): Fällt im
-- Gruppenchat noch jemandem ein Ort ein, schlägt jedes Mitglied ihn selbst in der laufenden Abstimmung vor –
-- alle bisherigen Stimmen bleiben.
--
-- Regeln:
--   * nur Mitglieder der Crew (sonst `forbidden`), nur solange die Abstimmung läuft (`poll_closed`)
--   * nur Orts-Abstimmungen (`poll_place_unsupported`) und keine Stichwahl – dort geht es nur noch um die
--     Vorschläge mit Gleichstand (`poll_place_runoff`)
--   * Ort aus Discover (`p_activity_id`, muss aktiv sein, sonst `unknown_activity`) oder eigener Vorschlag
--     (`p_title`, 1–120 Zeichen, sonst `poll_place_invalid`). Mit Ort ist der Titel der Name des Orts, außer
--     es wird ausdrücklich ein Titel mitgeschickt (wie bei `create_poll`)
--   * kein Ort doppelt: gleicher Ort aus Discover oder gleicher Titel ohne Rücksicht auf Groß-/Kleinschreibung
--     (`poll_place_duplicate`); höchstens 10 Vorschläge (`poll_place_full`)
--   * Preis wird nicht geraten: der neue Vorschlag hat keinen geschätzten Preis
--   * Tragen alle bisherigen Vorschläge denselben Termin (S1 „bowling oder kino fr 20 uhr“, „Und wo?“ nach der
--     Termin-Abstimmung), bekommt der neue Ort denselben – so entsteht auch aus ihm ein Plan, wenn er gewinnt
--     und die Abstimmung sich selbst entscheidet (S5). Haben die Vorschläge verschiedene Termine, bleibt er leer
--   * der neue Vorschlag kommt hinten an (Stimmzettel für Gäste, W3, adressiert über die Position)
--   * wer vorschlägt, ist dort gleich „dabei“. Rücksicht auf „Entscheidet sich selbst“ (S5): Diese Stimme läuft
--     über denselben Trigger wie jede andere. Eine klare Mehrheit zählt erst, wenn kein anderer Vorschlag mehr
--     aufholen kann – ein neuer Ort, zu dem die Crew noch nichts gesagt hat, kann das fast immer. Der neue Ort
--     verhindert also kein Ergebnis, er schiebt es nur auf, bis die anderen zu ihm geantwortet haben
--   * wer aus der Crew schon abgestimmt hat, bekommt Bescheid (Typ `poll_reminder` mit `added` und `place`)
--   * höchstens 10 neue Orte je Person und Stunde
--   * gehört die Abstimmung zu „Jede Woche neu“ (S7), ist der Ort ab der nächsten Runde mit dabei – wie alle
--     anderen Vorschläge

create function public.add_poll_place(p_poll_id uuid, p_activity_id uuid default null, p_title text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_poll public.polls%rowtype;
  v_activity public.activities%rowtype;
  v_title text;
  v_date date;
  v_time time;
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
  if v_poll.kind <> 'place' then
    perform app_private.fail('poll_place_unsupported');
  end if;
  if v_poll.parent_poll_id is not null then
    perform app_private.fail('poll_place_runoff');
  end if;

  if p_activity_id is not null then
    select * into v_activity from public.activities a where a.id = p_activity_id and a.is_active;
    if not found then
      perform app_private.fail('unknown_activity');
    end if;
  end if;
  v_title := coalesce(app_private.clean_line(p_title, 120), v_activity.name);
  if v_title is null then
    perform app_private.fail('poll_place_invalid');
  end if;

  if exists (select 1 from public.poll_options o
             where o.poll_id = v_poll.id
               and ((v_activity.id is not null and o.activity_id = v_activity.id)
                    or lower(o.title) = lower(v_title))) then
    perform app_private.fail('poll_place_duplicate');
  end if;
  if (select count(*) from public.poll_options o where o.poll_id = v_poll.id) >= 10 then
    perform app_private.fail('poll_place_full');
  end if;
  perform app_private.rate_limit('poll_place_add', 10, interval '1 hour');

  -- Gemeinsamer Termin: alle bisherigen Vorschläge haben denselben Tag und dieselbe (oder keine) Uhrzeit.
  select min(o.proposed_date), min(o.proposed_time) into v_date, v_time
  from public.poll_options o
  where o.poll_id = v_poll.id
  having count(*) = count(o.proposed_date) and count(distinct o.proposed_date) = 1
     and (count(o.proposed_time) = 0 or (count(o.proposed_time) = count(*) and count(distinct o.proposed_time) = 1));

  insert into public.poll_options (poll_id, activity_id, title, proposed_date, proposed_time, position)
  values (v_poll.id, v_activity.id, v_title, v_date, v_time,
          coalesce((select max(o.position) + 1 from public.poll_options o where o.poll_id = v_poll.id), 1))
  returning id into v_option_id;

  insert into public.poll_votes (poll_id, poll_option_id, user_id, response)
  values (v_poll.id, v_option_id, v_uid, 'yes');

  for v_member in
    select m.user_id from public.crew_members m
    where m.crew_id = v_poll.crew_id and m.user_id <> v_uid
      and exists (select 1 from public.poll_votes v where v.poll_id = v_poll.id and v.user_id = m.user_id)
  loop
    perform app_private.notify(v_member.user_id, 'poll_reminder', v_uid, v_poll.crew_id, 'poll', v_poll.id,
                               jsonb_build_object('title', v_poll.title, 'added', true, 'place', v_title),
                               'poll_place_added:' || v_option_id::text);
  end loop;
  return v_option_id;
end $$;

revoke all on function public.add_poll_place(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.add_poll_place(uuid, uuid, text) to authenticated, service_role;

comment on function public.add_poll_place(uuid, uuid, text) is
  'P40 Etappe 2: weiteren Ort (aus Discover oder eigener Vorschlag) in einer laufenden Orts-Abstimmung vorschlagen (jedes Mitglied); liefert die neue Option.';
