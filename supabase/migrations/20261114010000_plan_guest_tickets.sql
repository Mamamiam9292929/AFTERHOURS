-- P53 Etappe 2c · „Hab mein Ticket“ auch für Gäste über den Teilen-Link (W10)
-- Seit Etappe 1 sagen Mitglieder der Crew beim Ticket-Check mit einem Tipp „Hab mein Ticket“. Wer ohne Konto über
-- /s/<token> zugesagt hat, konnte das nicht – im Ticket-Stand fehlte der Gast ganz, und „hast du schon eins?“ lief
-- für ihn weiter über den Gruppenchat. Jetzt sagen auch Gäste, ob sie ihr Ticket haben, und die Crew sieht
-- „Dana (Gast)“ bei „Noch ohne Ticket“ bzw. zählt sie bei „3 von 5 mit Ticket“ mit.
--
-- Bewusst so gebaut (wie Etappe 1 und wie die übrigen Gast-Antworten):
--   * Nachweis ist das Geheimnis auf dem Gerät des Gasts; nur mit eigener Gast-Antwort, nur mit Gäste-Freigabe und
--     eingeschaltetem Ticket-Check, solange der Plan weder abgeschlossen noch abgesagt ist (wie bei Mitgliedern –
--     „hab meins doch“ an der Tür zählt auch nach Beginn). Mitglieder der Crew nehmen die App. Rate Limit je Link.
--   * Die Angabe hängt nicht an der Antwort: Wer als Gast absagt und ein Ticket hat, steht als „Ticket übrig“ da.
--   * Nur eigene Angaben, kein Kauf, kein Link nach außen.
--   * Übernimmt der Gast die Antwort ins Konto (`claim_plan_guest`, p_keep), kommt „hab eins“ mit.
--   * Keine Benachrichtigung; „Nachfragen“ (Etappe 2a) bleibt bei Mitgliedern – Gäste haben kein Postfach.

alter table public.plan_guests
  add column has_ticket boolean not null default false;
comment on column public.plan_guests.has_ticket is
  'P53 Etappe 2c: Gast sagt, er hat sein Ticket (nur eigene Angabe, über guest_ticket_shared_plan).';

-- Die Crew sieht die Angabe im Ticket-Stand.
grant select (has_ticket) on public.plan_guests to authenticated;

-- ---------------------------------------------------------------------------------------------
-- „Hab mein Ticket“ als Gast setzen oder zurücknehmen. Liefert den gespeicherten Stand.
-- ---------------------------------------------------------------------------------------------
create function public.guest_ticket_shared_plan(p_token text, p_secret text, p_has boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.plans;
  v_guest public.plan_guests;
begin
  v_plan := app_private.plan_by_share_token(p_token);
  if v_plan.id is null then
    perform app_private.fail('share_not_found');
  end if;
  if not v_plan.guests_allowed then
    perform app_private.fail('plan_guests_off');
  end if;
  if v_plan.status in ('completed', 'cancelled') then
    perform app_private.fail('plan_locked');
  end if;
  if not v_plan.tickets_needed then
    perform app_private.fail('plan_tickets_off');
  end if;
  if auth.uid() is not null and app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.fail('plan_guest_member');
  end if;
  if p_secret is null or p_secret !~ '^[0-9a-f]{64}$' or p_has is null then
    perform app_private.fail('invalid_input');
  end if;

  perform app_private.rate_limit_key(p_token, 'plan_guest_ticket', 120, interval '10 minutes');

  select g.* into v_guest from public.plan_guests g
  where g.plan_id = v_plan.id and g.secret_hash = app_private.hash_token(p_secret)
  for update;
  if v_guest.id is null then
    perform app_private.fail('plan_guest_not_found');
  end if;
  if v_guest.has_ticket = p_has then
    return p_has;
  end if;

  update public.plan_guests g set has_ticket = p_has, updated_at = now() where g.id = v_guest.id;
  return p_has;
end $$;

revoke all on function public.guest_ticket_shared_plan(text, text, boolean) from public, anon, authenticated;
grant execute on function public.guest_ticket_shared_plan(text, text, boolean) to anon, authenticated;
comment on function public.guest_ticket_shared_plan(text, text, boolean) is
  'P53 Etappe 2c: „Hab mein Ticket“ für Gäste über den Teilen-Link – eigene Angabe beim Ticket-Check.';

-- ---------------------------------------------------------------------------------------------
-- Zusagekarte: `plan.tickets_needed` (Ticket-Check an) und `me.has_ticket` (fehlt ohne Ticket). Sonst unverändert
-- gegenüber 20261113140000.
-- ---------------------------------------------------------------------------------------------
create or replace function public.shared_plan_rsvp(p_token text, p_secret text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.plans;
  v_guest public.plan_guests;
  v_place text;
begin
  v_plan := app_private.plan_by_share_token(p_token);
  if v_plan.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if coalesce(v_plan.ends_at, v_plan.starts_at) < now() - interval '3 days' then
    return jsonb_build_object('status', 'expired');
  end if;

  perform app_private.rate_limit_key(p_token, 'plan_guest_rsvp_read', 240, interval '10 minutes');
  if not v_plan.guests_allowed then
    return jsonb_build_object('status', 'guests_off');
  end if;

  if p_secret ~ '^[0-9a-f]{64}$' then
    select g.* into v_guest from public.plan_guests g
    where g.plan_id = v_plan.id and g.secret_hash = app_private.hash_token(p_secret);
  end if;
  select a.name into v_place from public.activities a where a.id = v_plan.activity_id;

  return jsonb_build_object(
    'status', 'valid',
    'plan', jsonb_build_object(
      'title', v_plan.title,
      'starts_at', v_plan.starts_at,
      'ends_at', v_plan.ends_at,
      'status', v_plan.status,
      'open', app_private.plan_guests_open(v_plan),
      'place', v_place,
      'address', v_plan.address,
      'meeting_point', v_plan.meeting_point,
      'can_join', app_private.plan_guest_join_open(v_plan),
      'stops', app_private.plan_stops_json(v_plan.id),
      'tickets_needed', v_plan.tickets_needed),
    'counts', (
      select jsonb_build_object(
               'going', coalesce(sum(x.n) filter (where x.s = 'going'), 0),
               'maybe', count(*) filter (where x.s = 'maybe'))
      from (select pp.attendance_status as s, 1 + pp.plus_ones as n from public.plan_participants pp where pp.plan_id = v_plan.id
            union all
            select g.attendance_status, 1 + g.plus_ones from public.plan_guests g where g.plan_id = v_plan.id) x),
    'me', case when v_guest.id is null then null else jsonb_strip_nulls(jsonb_build_object(
      'name', v_guest.display_name,
      'status', v_guest.attendance_status,
      'note', v_guest.note,
      'plus_ones', case when v_guest.plus_ones > 0 then v_guest.plus_ones end,
      'has_ticket', case when v_guest.has_ticket then true end,
      'waitlist', case when v_guest.waitlisted_at is not null then app_private.plan_waitlist_position(v_plan.id, null, v_guest.id) end,
      'promoted', case when v_guest.promoted_at is not null and v_guest.attendance_status = 'going' then true end)) end);
end $$;
revoke all on function public.shared_plan_rsvp(text, text) from public, anon, authenticated;
grant execute on function public.shared_plan_rsvp(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Gast-Antwort übernehmen: „hab eins“ kommt mit ins Konto (sonst unverändert gegenüber 20261113170000). Wer schon
-- eine eigene Antwort hat, behält sie – das Ticket gilt trotzdem (es ist dieselbe Person).
-- ---------------------------------------------------------------------------------------------
create or replace function public.claim_plan_guest(p_plan_id uuid, p_secret text, p_keep boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
  v_guest public.plan_guests%rowtype;
  v_own public.attendance_status;
  v_claimed boolean := false;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id;
  if not found or not app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.forbid();
  end if;
  if v_plan.status in ('completed', 'cancelled') then
    perform app_private.fail('plan_locked');
  end if;
  if p_secret is null or p_secret !~ '^[0-9a-f]{64}$' or p_keep is null then
    perform app_private.fail('invalid_input');
  end if;
  perform app_private.rate_limit('plan_guest_claim', 20, interval '1 hour');

  select g.* into v_guest from public.plan_guests g
  where g.plan_id = v_plan.id and g.secret_hash = app_private.hash_token(p_secret)
  for update;
  if v_guest.id is null then
    perform app_private.fail('plan_guest_not_found');
  end if;

  select pp.attendance_status into v_own from public.plan_participants pp
  where pp.plan_id = v_plan.id and pp.user_id = v_uid and pp.attendance_status <> 'invited'
  for update;

  perform set_config('app.plan_capacity_hold', v_plan.id::text, true);
  if p_keep and v_own is null then
    insert into public.plan_participants (plan_id, user_id, attendance_status, responded_at)
    values (v_plan.id, v_uid, v_guest.attendance_status, now())
    on conflict (plan_id, user_id) do update set attendance_status = excluded.attendance_status, responded_at = now();
    -- Erst nach dem Statuswechsel setzen – die Trigger leeren Zusatz, Liste und Begleitung bei jeder neuen Antwort.
    update public.plan_participants pp
    set note = v_guest.note,
        waitlisted_at = case when v_guest.attendance_status = 'maybe' then v_guest.waitlisted_at end,
        plus_ones = case when v_guest.attendance_status = 'going' then v_guest.plus_ones else 0 end
    where pp.plan_id = v_plan.id and pp.user_id = v_uid;
    v_own := v_guest.attendance_status;
    v_claimed := true;
  end if;

  -- P52: Sachen von der Mitbring-Liste gehen mit ins Konto.
  if p_keep then
    update public.plan_items i
    set claimed_by = v_uid, claimed_by_guest = null
    where i.claimed_by_guest = v_guest.id;
  end if;

  -- P53 Etappe 2c: „Hab mein Ticket“ geht mit ins Konto (nur dazu, nie weg).
  if p_keep and v_guest.has_ticket then
    update public.plan_participants pp set has_ticket = true
    where pp.plan_id = v_plan.id and pp.user_id = v_uid;
  end if;

  delete from public.plan_guests g where g.id = v_guest.id;
  perform set_config('app.plan_capacity_hold', '', true);
  perform app_private.promote_plan_waitlist(v_plan.id);

  insert into public.audit_log (actor_id, action, entity_type, entity_id, crew_id, meta)
  values (v_uid, case when p_keep then 'plan_guest_claimed' else 'plan_guest_discarded' end, 'plan', v_plan.id, v_plan.crew_id,
          jsonb_build_object('claimed', v_claimed));

  return jsonb_build_object('claimed', v_claimed, 'status', v_own);
end $$;
revoke all on function public.claim_plan_guest(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.claim_plan_guest(uuid, text, boolean) to authenticated;
