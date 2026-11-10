-- P36 · „Wer fährt?“ – Fahrgemeinschaften zu Ende gedacht
-- Fahrten gibt es seit dem Start (Angebot → Anfrage → die fahrende Person entscheidet). Drei Lücken bleiben, die im
-- Gruppenchat dann doch wieder Nachrichten kosten:
--   * Wer für den Abend absagt, blieb als Mitfahrer:in eingetragen und belegte einen Platz; wer selbst fahren wollte und
--     absagt, ließ ein offenes Angebot stehen, auf das andere sich verlassen.
--   * Wer eine bestätigte Mitfahrt zurückzieht, tat das still – die fahrende Person merkte es erst am Treffpunkt.
--   * Wer abgesagt hat, konnte trotzdem eine Fahrt anbieten oder anfragen.
--
-- Bewusst so gebaut:
--   * Nur „Kann nicht“ gibt frei. „Vielleicht“ ändert nichts, und „Alle neu fragen“ (P23, Status „eingeladen“) auch
--     nicht – die Fahrt soll nicht verschwinden, nur weil sich die Uhrzeit verschoben hat.
--   * Sagt die fahrende Person ab, wird ihr Angebot zurückgezogen wie mit `cancel_ride_offer`: Wer mitfahren wollte
--     oder bestätigt war, bekommt „kann dich nicht mitnehmen“.
--   * Sagt eine Mitfahrerin ab, wird ihre Anfrage storniert. War sie bestätigt, bekommt die fahrende Person Bescheid
--     („fährt doch nicht mit“ – gleiche Art `ride_request` mit `cancelled`, damit bestehende Einstellungen greifen);
--     eine nur angefragte Mitfahrt verschwindet still. Gleiches gilt fürs Zurückziehen von Hand.
--   * Austritt aus der Crew räumt Fahrten schon seit dem Start auf (`on_crew_member_removed`).
--   * Abgeschlossene und abgesagte Pläne bleiben, wie sie sind.
-- Keine neue Tabelle, keine neue öffentliche Funktion – ein Trigger und strengere Prüfungen in bestehenden RPCs.

-- ---------------------------------------------------------------------------------------------
-- Eine Mitfahrt stornieren; war sie bestätigt, erfährt es die fahrende Person.
-- ---------------------------------------------------------------------------------------------
create function app_private.drop_ride_request(p_request_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_request public.ride_requests%rowtype;
  v_offer public.ride_offers%rowtype;
  v_plan public.plans%rowtype;
begin
  select * into v_request from public.ride_requests r where r.id = p_request_id for update;
  if not found or v_request.status not in ('requested', 'accepted') then
    return false;
  end if;
  update public.ride_requests r set status = 'cancelled' where r.id = p_request_id;

  if v_request.status = 'accepted' then
    select * into v_offer from public.ride_offers o where o.id = v_request.ride_offer_id;
    select * into v_plan from public.plans p where p.id = v_offer.plan_id;
    if v_offer.status = 'open' then
      perform app_private.notify(v_offer.driver_user_id, 'ride_request', v_request.passenger_user_id, v_plan.crew_id, 'plan', v_plan.id,
                                 jsonb_build_object('title', v_plan.title, 'cancelled', true));
    end if;
  end if;
  return true;
end $$;
revoke all on function app_private.drop_ride_request(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Absage gibt Fahrten frei
-- ---------------------------------------------------------------------------------------------
create function app_private.release_rides_on_decline() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.plans%rowtype;
  v_offer record;
  v_request record;
begin
  if new.attendance_status <> 'declined' or (tg_op = 'UPDATE' and old.attendance_status = 'declined') then
    return new;
  end if;
  select * into v_plan from public.plans p where p.id = new.plan_id;
  if not found or v_plan.status in ('completed', 'cancelled') then
    return new;
  end if;

  -- Eigenes Angebot zurückziehen; alle, die mitfahren wollten, erfahren es.
  for v_offer in
    update public.ride_offers o set status = 'cancelled'
    where o.plan_id = new.plan_id and o.driver_user_id = new.user_id and o.status = 'open'
    returning o.id
  loop
    for v_request in
      update public.ride_requests r set status = 'declined'
      where r.ride_offer_id = v_offer.id and r.status in ('requested', 'accepted')
      returning r.passenger_user_id
    loop
      perform app_private.notify(v_request.passenger_user_id, 'ride_confirmed', new.user_id, v_plan.crew_id, 'plan', v_plan.id,
                                 jsonb_build_object('title', v_plan.title, 'accepted', false));
    end loop;
  end loop;

  -- Eigene Mitfahrten freigeben.
  for v_request in
    select r.id from public.ride_requests r
    join public.ride_offers o on o.id = r.ride_offer_id
    where o.plan_id = new.plan_id and r.passenger_user_id = new.user_id and r.status in ('requested', 'accepted')
    order by r.created_at
  loop
    perform app_private.drop_ride_request(v_request.id);
  end loop;
  return new;
end $$;
revoke all on function app_private.release_rides_on_decline() from public, anon, authenticated;

create trigger plan_participants_release_rides
  after insert or update of attendance_status on public.plan_participants
  for each row execute function app_private.release_rides_on_decline();

-- ---------------------------------------------------------------------------------------------
-- Wer abgesagt hat, bietet keine Fahrt an und fragt keine an.
-- ---------------------------------------------------------------------------------------------
create function app_private.has_declined_plan(p_plan_id uuid, p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.plan_participants pp
    where pp.plan_id = p_plan_id and pp.user_id = p_user_id and pp.attendance_status = 'declined'
  );
$$;
revoke all on function app_private.has_declined_plan(uuid, uuid) from public, anon, authenticated;

create or replace function public.create_ride_offer(
  p_plan_id uuid, p_departure_area text, p_departure_time timestamptz, p_available_seats integer,
  p_destination text default null, p_return_trip boolean default false, p_note text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
  v_area text := app_private.clean_line(p_departure_area, 120);
  v_id uuid;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id;
  if not found or not app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.forbid();
  end if;
  if v_plan.status in ('completed', 'cancelled') then
    perform app_private.fail('plan_locked');
  end if;
  if app_private.has_declined_plan(p_plan_id, v_uid) then
    perform app_private.fail('ride_after_decline');
  end if;
  if v_area is null or char_length(v_area) < 2 or p_departure_time is null or p_available_seats is null
     or p_available_seats not between 1 and 8 then
    perform app_private.fail('invalid_ride');
  end if;
  perform app_private.rate_limit('create_ride_offer', 20, interval '1 hour');

  insert into public.ride_offers (plan_id, driver_user_id, departure_area, departure_time, available_seats, destination, return_trip, note)
  values (p_plan_id, v_uid, v_area, p_departure_time, p_available_seats, app_private.clean_line(p_destination, 160),
          coalesce(p_return_trip, false), app_private.clean_text(p_note, 300))
  on conflict (plan_id, driver_user_id) do update
    set departure_area = excluded.departure_area, departure_time = excluded.departure_time,
        available_seats = excluded.available_seats, destination = excluded.destination,
        return_trip = excluded.return_trip, note = excluded.note, status = 'open'
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.request_ride(p_offer_id uuid, p_seats integer default 1) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_offer public.ride_offers%rowtype;
  v_plan public.plans%rowtype;
  v_id uuid;
begin
  select * into v_offer from public.ride_offers o where o.id = p_offer_id;
  if found then
    select * into v_plan from public.plans p where p.id = v_offer.plan_id;
  end if;
  if v_offer.id is null or not app_private.is_crew_member(v_plan.crew_id) or v_offer.driver_user_id = v_uid then
    perform app_private.forbid();
  end if;
  if v_offer.status <> 'open' or v_plan.status in ('completed', 'cancelled') then
    perform app_private.fail('ride_not_available');
  end if;
  if app_private.has_declined_plan(v_plan.id, v_uid) then
    perform app_private.fail('ride_after_decline');
  end if;
  if p_seats is null or p_seats not between 1 and 4 then
    perform app_private.fail('invalid_ride');
  end if;
  perform app_private.rate_limit('request_ride', 30, interval '1 hour');

  insert into public.ride_requests (ride_offer_id, passenger_user_id, seats_requested, status)
  values (p_offer_id, v_uid, p_seats, 'requested')
  on conflict (ride_offer_id, passenger_user_id) do update set seats_requested = excluded.seats_requested, status = 'requested'
  returning id into v_id;

  perform app_private.notify(v_offer.driver_user_id, 'ride_request', v_uid, v_plan.crew_id, 'plan', v_plan.id,
                             jsonb_build_object('title', v_plan.title, 'seats', p_seats));
  return v_id;
end $$;

-- Zurückziehen von Hand: wie bisher nur die eigene Anfrage; neu erfährt die fahrende Person, wenn ein bestätigter Platz frei wird.
create or replace function public.cancel_ride_request(p_request_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
begin
  if not exists (
    select 1 from public.ride_requests r
    where r.id = p_request_id and r.passenger_user_id = v_uid and r.status in ('requested', 'accepted')
  ) then
    perform app_private.forbid();
  end if;
  perform app_private.drop_ride_request(p_request_id);
end $$;

comment on function app_private.release_rides_on_decline() is
  'P36: „Kann nicht“ zieht das eigene Fahrtangebot zurück (Mitfahrende erfahren es) und gibt eigene Mitfahrten frei';
