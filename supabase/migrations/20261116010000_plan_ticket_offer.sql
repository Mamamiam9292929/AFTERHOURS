-- P54 · „Ticket übrig – wer will?“
-- Seit P53 steht, wer abgesagt hat und trotzdem ein Ticket hat, als „Ticket übrig“ im Ticket-Stand. Wer es loswerden
-- will, schreibt bisher doch in den Gruppenchat „wer will meins?“ – und dann melden sich drei, oder keiner merkt es.
-- Jetzt bietet die Person ihr Ticket mit einem Tipp an: alle aus der Crew, die zugesagt und noch kein Ticket haben,
-- bekommen Bescheid („Alice hat ein Ticket übrig“). Wer zuerst „Nehm ich“ tippt, bekommt es: Bei der neuen Person steht
-- danach „Hab mein Ticket“, bei der anbietenden nicht mehr, und sie erfährt, wer es nimmt.
--
-- Bewusst so gebaut:
--   * AFTERHOURS vermittelt nur die Absprache unter Freunden – kein Kauf, kein Preis, kein Link nach außen, keine
--     Zahlung. Das Geld klären die beiden selbst (so steht es auch in der Benachrichtigung).
--   * Anbieten nur mit eigener Absage und eigener Angabe „Hab mein Ticket“, nur bei eingeschaltetem Ticket-Check, nur vor
--     Beginn, nicht bei abgeschlossenen/abgesagten Plänen; ein laufendes Angebot nicht doppelt (`ticket_offered_at`),
--     höchstens 10 Angebote je Stunde und Person (Rate Limit). Sagt die Person wieder zu oder nimmt „Hab mein Ticket“
--     zurück, ist das Angebot weg (Trigger); ein neues Angebot gibt wieder Bescheid.
--   * Nehmen nur mit eigener Zusage (nicht auf der Nachrückliste) und ohne Ticket, nur Angebote von Personen, die noch in
--     der Crew sind. Beide Zeilen werden gesperrt – tippen zwei gleichzeitig, bekommt es genau eine Person, die andere
--     sieht „Das Ticket ist schon weg“.
--   * Kein neuer Benachrichtigungstyp: `plan_reminder` mit `ticket_offer` bzw. `ticket_taken` im Payload (eigener Text in
--     der App); wer „Nachfragen zu Plänen“ abgeschaltet hat, bekommt nichts.
--   * Gäste über den Teilen-Link (P53 Etappe 2c) haben kein Postfach und bleiben in dieser Etappe außen vor.
--   * Nach Beginn: Fehler `plan_plus_ones_started` („Der Abend hat schon angefangen.“) – gleicher Text, kein neuer Schlüssel
--     im Start-Bundle.

alter table public.plan_participants
  add column ticket_offered_at timestamptz;
comment on column public.plan_participants.ticket_offered_at is
  'P54: seit wann die Person ihr übriges Ticket der Crew anbietet (nur mit Absage und Ticket, sonst null).';

-- Das Angebot gehört zur Absage mit Ticket: Zusage oder „noch keins“ nimmt es zurück.
create function app_private.plan_participant_ticket_offer_reset() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.attendance_status is distinct from 'declined' or not new.has_ticket then
    new.ticket_offered_at := null;
  end if;
  return new;
end $$;
revoke all on function app_private.plan_participant_ticket_offer_reset() from public, anon, authenticated;

create trigger plan_participants_ticket_offer_reset
  before update of attendance_status, has_ticket on public.plan_participants
  for each row execute function app_private.plan_participant_ticket_offer_reset();

-- ---------------------------------------------------------------------------------------------
-- Übriges Ticket anbieten. Liefert die Zahl der Personen, die Bescheid bekommen haben (0 heißt: gerade braucht niemand
-- eins – das Angebot steht trotzdem, wer später zusagt, sieht es).
-- ---------------------------------------------------------------------------------------------
create function public.offer_plan_ticket(p_plan_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
  v_row public.plan_participants%rowtype;
  v_member record;
  v_count integer := 0;
begin
  perform app_private.rate_limit('offer_plan_ticket', 10, interval '1 hour');

  select * into v_plan from public.plans p where p.id = p_plan_id;
  if not found or not app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.forbid();
  end if;
  if v_plan.status in ('completed', 'cancelled') then
    perform app_private.fail('plan_locked');
  end if;
  if not v_plan.tickets_needed then
    perform app_private.fail('plan_tickets_off');
  end if;
  if v_plan.starts_at <= now() then
    perform app_private.fail('plan_plus_ones_started');
  end if;

  select pp.* into v_row from public.plan_participants pp
  where pp.plan_id = p_plan_id and pp.user_id = v_uid
  for update;
  if v_row.user_id is null or v_row.attendance_status <> 'declined' or not v_row.has_ticket then
    perform app_private.fail('plan_ticket_not_spare');
  end if;
  if v_row.ticket_offered_at is not null then
    perform app_private.fail('plan_ticket_already_offered');
  end if;

  update public.plan_participants pp set ticket_offered_at = now()
  where pp.plan_id = p_plan_id and pp.user_id = v_uid;

  for v_member in
    select pp.user_id from public.plan_participants pp
    join public.crew_members m on m.crew_id = v_plan.crew_id and m.user_id = pp.user_id
    where pp.plan_id = p_plan_id and pp.attendance_status = 'going' and not pp.has_ticket
      and pp.waitlisted_at is null and pp.user_id <> v_uid
    order by pp.user_id
  loop
    perform app_private.notify(v_member.user_id, 'plan_reminder', v_uid, v_plan.crew_id, 'plan', p_plan_id,
                               jsonb_build_object('title', v_plan.title, 'starts_at', v_plan.starts_at, 'ticket_offer', true),
                               'plan_ticket_offer:' || p_plan_id::text || ':' || v_uid::text || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'));
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke all on function public.offer_plan_ticket(uuid) from public, anon, authenticated;
grant execute on function public.offer_plan_ticket(uuid) to authenticated;
comment on function public.offer_plan_ticket(uuid) is
  'P54: Übriges Ticket (Absage, „Hab mein Ticket“) der Crew anbieten – alle mit Zusage ohne Ticket bekommen Bescheid.';

-- ---------------------------------------------------------------------------------------------
-- Angebotenes Ticket nehmen. Wer zuerst tippt, bekommt es; danach „Hab mein Ticket“ bei der neuen Person, bei der
-- anbietenden nicht mehr. Die anbietende Person bekommt Bescheid.
-- ---------------------------------------------------------------------------------------------
create function public.take_plan_ticket(p_plan_id uuid, p_from uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
  v_me public.plan_participants%rowtype;
  v_from public.plan_participants%rowtype;
begin
  perform app_private.rate_limit('take_plan_ticket', 20, interval '1 hour');

  select * into v_plan from public.plans p where p.id = p_plan_id;
  if not found or not app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.forbid();
  end if;
  if v_plan.status in ('completed', 'cancelled') then
    perform app_private.fail('plan_locked');
  end if;
  if not v_plan.tickets_needed then
    perform app_private.fail('plan_tickets_off');
  end if;
  if v_plan.starts_at <= now() then
    perform app_private.fail('plan_plus_ones_started');
  end if;
  if p_from is null or p_from = v_uid then
    perform app_private.fail('invalid_input');
  end if;

  -- Beide Zeilen in fester Reihenfolge sperren – zwei gleichzeitige „Nehm ich“ bekommen nicht beide das Ticket.
  perform 1 from public.plan_participants pp
  where pp.plan_id = p_plan_id and pp.user_id in (v_uid, p_from)
  order by pp.user_id
  for update;

  select pp.* into v_me from public.plan_participants pp where pp.plan_id = p_plan_id and pp.user_id = v_uid;
  if v_me.user_id is null or v_me.attendance_status <> 'going' or v_me.waitlisted_at is not null or v_me.has_ticket then
    perform app_private.fail('plan_ticket_not_needed');
  end if;

  select pp.* into v_from from public.plan_participants pp where pp.plan_id = p_plan_id and pp.user_id = p_from;
  if v_from.user_id is null or v_from.ticket_offered_at is null or v_from.attendance_status <> 'declined'
     or not v_from.has_ticket or not exists (select 1 from public.crew_members m where m.crew_id = v_plan.crew_id and m.user_id = p_from) then
    perform app_private.fail('plan_ticket_gone');
  end if;

  -- Der Trigger nimmt das Angebot mit „noch keins“ zurück.
  update public.plan_participants pp set has_ticket = false where pp.plan_id = p_plan_id and pp.user_id = p_from;
  update public.plan_participants pp set has_ticket = true where pp.plan_id = p_plan_id and pp.user_id = v_uid;

  perform app_private.notify(p_from, 'plan_reminder', v_uid, v_plan.crew_id, 'plan', p_plan_id,
                             jsonb_build_object('title', v_plan.title, 'starts_at', v_plan.starts_at, 'ticket_taken', true),
                             'plan_ticket_taken:' || p_plan_id::text || ':' || v_uid::text || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'));
  return true;
end $$;
revoke all on function public.take_plan_ticket(uuid, uuid) from public, anon, authenticated;
grant execute on function public.take_plan_ticket(uuid, uuid) to authenticated;
comment on function public.take_plan_ticket(uuid, uuid) is
  'P54: Angebotenes Ticket einer Person aus der Crew nehmen (eigene Zusage ohne Ticket) – wer zuerst tippt, bekommt es.';
