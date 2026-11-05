-- P26 Etappe 3b · Nachrücken auch als Gast
-- Bisher bekamen Freunde ohne Konto (W10) bei voller Runde nur „Vielleicht“ oder „Kann nicht“. Jetzt stellen sie
-- sich über den Teilen-Link /s/<token> genauso in die Reihe wie die Crew: eine gemeinsame Nachrückliste, in der
-- Reihenfolge der Einträge. Wird ein Platz frei, rückt die erste Person nach – Mitglied oder Gast.
--
-- Bewusst so gebaut:
--   * Eine Liste für alle: `plan_guests.waitlisted_at` neben `plan_participants.waitlisted_at`; Reihenfolge nach
--     Zeitpunkt (bei Gleichstand erst Mitglieder, dann nach Kennung). Die Position rechnet überall dieselbe
--     Funktion `app_private.plan_waitlist_position` aus.
--   * Gäste haben kein Konto und bekommen keine Benachrichtigung. Rücken sie nach, merkt sich die Antwort das
--     (`promoted_at`) – öffnen sie den Link wieder, steht dort „Du bist nachgerückt“. Ändert der Gast die Antwort
--     selbst, ist der Hinweis weg. Wer organisiert, erfährt es wie bei jeder Gast-Zusage (eine Nachricht je Gast
--     und Antwort).
--   * Gäste rücken nur nach, solange Zusagen über den Link an sind – sonst sähen sie ihre Zusage nirgends.
--     Ausgeschaltet bleiben sie auf der Liste stehen; Mitglieder hinter ihnen rücken vor.
--   * Übernimmt ein Gast die Antwort ins eigene Konto (claim_plan_guest), behält er seinen Platz auf der Liste.
--   * Wie bei der Gast-Antwort: Nachweis ist das Geheimnis auf dem Gerät, nur vor Beginn, nicht bei abgesagten
--     oder abgeschlossenen Plänen, Mitglieder nehmen die App; Rate Limit je Link.

alter table public.plan_guests
  add column waitlisted_at timestamptz,
  add column promoted_at timestamptz;

comment on column public.plan_guests.waitlisted_at is 'P26 Etappe 3b: seit wann auf der Nachrückliste (Reihenfolge), sonst null.';
comment on column public.plan_guests.promoted_at is 'P26 Etappe 3b: von der Nachrückliste nachgerückt (Hinweis auf der Karte), sonst null.';

create index plan_guests_waitlist_idx on public.plan_guests (plan_id, waitlisted_at) where waitlisted_at is not null;

-- Die Crew sieht Gäste auf der Liste in ihrer Reihenfolge.
grant select (waitlisted_at) on public.plan_guests to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Gemeinsame Liste: Position (1 = als Nächstes) von Mitglied (p_user_id) oder Gast (p_guest_id).
-- Gezählt wird nur, wer tatsächlich nachrücken kann: Mitglieder der Crew; Gäste, solange Zusagen an sind.
-- ---------------------------------------------------------------------------------------------
create function app_private.plan_waitlist_queue(p_plan_id uuid)
returns table (kind smallint, user_id uuid, guest_id uuid, waitlisted_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select 1::smallint, pp.user_id, null::uuid, pp.waitlisted_at
  from public.plan_participants pp
  join public.plans p on p.id = pp.plan_id
  join public.crew_members m on m.crew_id = p.crew_id and m.user_id = pp.user_id
  where pp.plan_id = p_plan_id and pp.waitlisted_at is not null
  union all
  select 2::smallint, null::uuid, g.id, g.waitlisted_at
  from public.plan_guests g
  join public.plans p on p.id = g.plan_id
  where g.plan_id = p_plan_id and g.waitlisted_at is not null and p.guests_allowed;
$$;
revoke all on function app_private.plan_waitlist_queue(uuid) from public, anon, authenticated;

create function app_private.plan_waitlist_position(p_plan_id uuid, p_user_id uuid, p_guest_id uuid) returns integer
language sql stable security definer set search_path = '' as $$
  with q as (
    select x.*, row_number() over (order by x.waitlisted_at, x.kind, coalesce(x.user_id, x.guest_id)) as pos
    from app_private.plan_waitlist_queue(p_plan_id) x
  )
  select q.pos::integer from q
  where (p_user_id is not null and q.user_id = p_user_id) or (p_guest_id is not null and q.guest_id = p_guest_id);
$$;
revoke all on function app_private.plan_waitlist_position(uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Vor jeder neuen Antwort: wie bisher (20261105100000), dazu für Gäste – wer zusagt oder absagt, wartet nicht
-- mehr; ändert der Gast die Antwort selbst, ist der Hinweis „nachgerückt“ weg.
-- ---------------------------------------------------------------------------------------------
create or replace function app_private.plan_capacity_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_max smallint;
begin
  if new.attendance_status in ('going', 'declined', 'invited') then
    new.waitlisted_at := null;
  end if;
  -- (Verschachtelt: nur plan_guests hat promoted_at, nur plan_participants user_id – PL/pgSQL plant jeden
  -- Ausdruck als Ganzes.)
  if tg_table_name = 'plan_guests' then
    if tg_op = 'UPDATE' then
      if new.attendance_status is distinct from old.attendance_status then
        new.promoted_at := null;
      end if;
    end if;
  end if;
  -- INSERT … ON CONFLICT (set_attendance): Gibt es die Zeile schon, prüft der UPDATE-Trigger danach mit der alten Antwort.
  if tg_op = 'INSERT' and tg_table_name = 'plan_participants' then
    if exists (select 1 from public.plan_participants pp where pp.plan_id = new.plan_id and pp.user_id = new.user_id) then
      return new;
    end if;
  end if;
  if new.attendance_status = 'going' and (tg_op = 'INSERT' or old.attendance_status is distinct from 'going')
     and not app_private.plan_capacity_hold(new.plan_id) then
    -- Sperre: gleichzeitige Zusagen warten aufeinander und zählen danach richtig.
    select p.max_going into v_max from public.plans p where p.id = new.plan_id for update;
    if v_max is not null and app_private.plan_going_count(new.plan_id) >= v_max then
      perform app_private.fail('plan_full');
    end if;
  end if;
  return new;
end $$;
revoke all on function app_private.plan_capacity_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Nachrücken aus der gemeinsamen Liste. Mitglieder bekommen wie bisher genau einmal „Du bist nachgerückt“;
-- bei Gästen erfährt es, wer organisiert (wie bei jeder Gast-Zusage), und die Karte zeigt den Hinweis.
-- ---------------------------------------------------------------------------------------------
create or replace function app_private.promote_plan_waitlist(p_plan_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.plans%rowtype;
  v_next record;
  v_rows integer;
  v_count integer := 0;
  v_guest public.plan_guests%rowtype;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id for update;
  if not found or v_plan.status in ('completed', 'cancelled') or v_plan.starts_at <= now() then
    return 0;
  end if;

  loop
    if v_plan.max_going is not null and app_private.plan_going_count(p_plan_id) >= v_plan.max_going then
      exit;
    end if;
    select x.kind, x.user_id, x.guest_id into v_next
    from app_private.plan_waitlist_queue(p_plan_id) x
    order by x.waitlisted_at, x.kind, coalesce(x.user_id, x.guest_id)
    limit 1;
    exit when not found;

    if v_next.kind = 1 then
      update public.plan_participants pp
      set attendance_status = 'going', responded_at = now(), waitlisted_at = null
      where pp.plan_id = p_plan_id and pp.user_id = v_next.user_id and pp.waitlisted_at is not null;
      get diagnostics v_rows = row_count;
      continue when v_rows = 0;  -- inzwischen selbst von der Liste gegangen
      perform app_private.notify(v_next.user_id, 'plan_waitlist_promoted', null, v_plan.crew_id, 'plan', p_plan_id,
                                 jsonb_build_object('title', v_plan.title, 'starts_at', v_plan.starts_at),
                                 'plan_waitlist_promoted:' || p_plan_id::text || ':' || v_next.user_id::text);
    else
      update public.plan_guests g
      set attendance_status = 'going', waitlisted_at = null, updated_at = now()
      where g.id = v_next.guest_id and g.waitlisted_at is not null
      returning * into v_guest;
      continue when v_guest.id is null;
      -- Getrennt, damit der Trigger (neue Antwort → Hinweis weg) den Hinweis nicht gleich wieder löscht.
      update public.plan_guests g set promoted_at = now() where g.id = v_guest.id;
      perform app_private.notify(v_plan.created_by, 'plan_attendance', null, v_plan.crew_id, 'plan', p_plan_id,
                                 jsonb_build_object('title', v_plan.title, 'status', 'going', 'guest', v_guest.display_name),
                                 'plan_attendance:' || p_plan_id::text || ':guest:' || v_guest.id::text || ':going');
      v_guest := null;
    end if;
    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, crew_id, meta)
    values (null, 'plan_waitlist_promoted', 'plan', p_plan_id, v_plan.crew_id, jsonb_build_object('count', v_count));
  end if;
  return v_count;
end $$;
revoke all on function app_private.promote_plan_waitlist(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Mitglieder auf die Liste: wie bisher (20261105100000), die Position zählt jetzt Gäste davor mit.
-- ---------------------------------------------------------------------------------------------
create or replace function public.join_plan_waitlist(p_plan_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
  v_row public.plan_participants%rowtype;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id for update;
  if not found or not app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.forbid();
  end if;
  if v_plan.status in ('completed', 'cancelled') then
    perform app_private.fail('plan_locked');
  end if;
  if v_plan.starts_at <= now() then
    perform app_private.fail('plan_waitlist_started');
  end if;
  select * into v_row from public.plan_participants pp where pp.plan_id = p_plan_id and pp.user_id = v_uid for update;
  if v_row.attendance_status = 'going' then
    perform app_private.fail('plan_waitlist_going');
  end if;
  if v_plan.max_going is null or app_private.plan_going_count(p_plan_id) < v_plan.max_going then
    perform app_private.fail('plan_not_full');
  end if;
  perform app_private.rate_limit('plan_waitlist', 30, interval '1 hour');

  if v_row.plan_id is null then
    insert into public.plan_participants (plan_id, user_id, attendance_status, responded_at)
    values (p_plan_id, v_uid, 'maybe', now());
  elsif v_row.attendance_status <> 'maybe' then
    update public.plan_participants pp set attendance_status = 'maybe', responded_at = now()
    where pp.plan_id = p_plan_id and pp.user_id = v_uid;
  end if;
  -- Erst nach dem Statuswechsel – der Trigger räumt die Liste bei „eingeladen“/„abgesagt“ auf.
  update public.plan_participants pp set waitlisted_at = coalesce(v_row.waitlisted_at, clock_timestamp())
  where pp.plan_id = p_plan_id and pp.user_id = v_uid;

  if v_row.waitlisted_at is null then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, crew_id, meta)
    values (v_uid, 'plan_waitlist_joined', 'plan', p_plan_id, v_plan.crew_id, '{}'::jsonb);
  end if;

  return app_private.plan_waitlist_position(p_plan_id, v_uid, null);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Gäste auf die Liste (p_join = true) oder herunter (false). Liefert die Position (1 = als Nächstes) bzw. null.
-- Wer noch nicht geantwortet hat, braucht einen Namen und steht danach mit „Vielleicht“ auf der Liste.
-- ---------------------------------------------------------------------------------------------
create function public.guest_waitlist_shared_plan(p_token text, p_secret text, p_name text, p_join boolean) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.plans;
  v_name text := app_private.clean_line(p_name, 40);
  v_guest public.plan_guests;
  v_max smallint;
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
  if v_plan.starts_at <= now() then
    perform app_private.fail('plan_waitlist_started');
  end if;
  if auth.uid() is not null and app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.fail('plan_guest_member');
  end if;
  if p_secret is null or p_secret !~ '^[0-9a-f]{64}$' or p_join is null then
    perform app_private.fail('invalid_input');
  end if;

  perform app_private.rate_limit_key(p_token, 'plan_guest_rsvp', 300, interval '10 minutes');

  -- Sperre der Planzeile: Liste und Zahl der Zusagen ändern sich nicht zwischen Prüfen und Eintragen.
  select p.max_going into v_max from public.plans p where p.id = v_plan.id for update;
  select g.* into v_guest from public.plan_guests g
  where g.plan_id = v_plan.id and g.secret_hash = app_private.hash_token(p_secret)
  for update;

  if not p_join then
    if v_guest.id is not null and v_guest.waitlisted_at is not null then
      update public.plan_guests g set waitlisted_at = null where g.id = v_guest.id;
    end if;
    return null;
  end if;

  if v_guest.attendance_status = 'going' then
    perform app_private.fail('plan_waitlist_going');
  end if;
  if v_max is null or app_private.plan_going_count(v_plan.id) < v_max then
    perform app_private.fail('plan_not_full');
  end if;

  if v_guest.id is null then
    if v_name is null or char_length(v_name) < 2 then
      perform app_private.fail('invalid_name');
    end if;
    if (select count(*) from public.plan_guests g where g.plan_id = v_plan.id) >= 30 then
      perform app_private.fail('plan_guest_limit');
    end if;
    perform app_private.rate_limit_key(p_token, 'plan_guest_join', 30, interval '1 hour');
    insert into public.plan_guests (plan_id, secret_hash, display_name, attendance_status, waitlisted_at)
    values (v_plan.id, app_private.hash_token(p_secret), v_name, 'maybe', clock_timestamp())
    returning * into v_guest;
  else
    if v_guest.attendance_status <> 'maybe' then
      update public.plan_guests g set attendance_status = 'maybe', updated_at = now() where g.id = v_guest.id;
    end if;
    -- Erst nach dem Statuswechsel; ein neuer Name (wenn angegeben) gilt wie bei der Antwort.
    update public.plan_guests g
    set waitlisted_at = coalesce(v_guest.waitlisted_at, clock_timestamp()),
        display_name = case when v_name is not null and char_length(v_name) >= 2 then v_name else g.display_name end
    where g.id = v_guest.id;
  end if;

  return app_private.plan_waitlist_position(v_plan.id, null, v_guest.id);
end $$;

revoke all on function public.guest_waitlist_shared_plan(text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.guest_waitlist_shared_plan(text, text, text, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Zusagekarte: wie in 20261105040000, „me“ zusätzlich mit `waitlist` (eigene Position) und `promoted` (true,
-- solange die Zusage aus dem Nachrücken stammt). Beides fehlt sonst – das Objekt bleibt für alle anderen gleich.
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
      'meeting_point', v_plan.meeting_point),
    'counts', (
      select jsonb_build_object(
               'going', count(*) filter (where x.s = 'going'),
               'maybe', count(*) filter (where x.s = 'maybe'))
      from (select pp.attendance_status as s from public.plan_participants pp where pp.plan_id = v_plan.id
            union all
            select g.attendance_status from public.plan_guests g where g.plan_id = v_plan.id) x),
    'me', case when v_guest.id is null then null else jsonb_strip_nulls(jsonb_build_object(
      'name', v_guest.display_name,
      'status', v_guest.attendance_status,
      'note', v_guest.note,
      'waitlist', case when v_guest.waitlisted_at is not null then app_private.plan_waitlist_position(v_plan.id, null, v_guest.id) end,
      'promoted', case when v_guest.promoted_at is not null and v_guest.attendance_status = 'going' then true end)) end);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Gast-Antwort übernehmen: wie in 20261105100000, dazu bleibt der Platz auf der Nachrückliste erhalten.
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
    -- Erst nach dem Statuswechsel setzen – die Trigger leeren Zusatz und Liste bei jeder neuen Antwort.
    update public.plan_participants pp
    set note = v_guest.note,
        waitlisted_at = case when v_guest.attendance_status = 'maybe' then v_guest.waitlisted_at end
    where pp.plan_id = v_plan.id and pp.user_id = v_uid;
    v_own := v_guest.attendance_status;
    v_claimed := true;
  end if;

  delete from public.plan_guests g where g.id = v_guest.id;
  perform set_config('app.plan_capacity_hold', '', true);
  perform app_private.promote_plan_waitlist(v_plan.id);

  insert into public.audit_log (actor_id, action, entity_type, entity_id, crew_id, meta)
  values (v_uid, case when p_keep then 'plan_guest_claimed' else 'plan_guest_discarded' end, 'plan', v_plan.id, v_plan.crew_id,
          jsonb_build_object('claimed', v_claimed));

  return jsonb_build_object('claimed', v_claimed, 'status', v_own);
end $$;

-- Rechte ausdrücklich (create or replace behält sie, trotzdem festhalten).
revoke all on function public.join_plan_waitlist(uuid), public.claim_plan_guest(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.join_plan_waitlist(uuid), public.claim_plan_guest(uuid, text, boolean) to authenticated;
revoke all on function public.shared_plan_rsvp(text, text) from public, anon, authenticated;
grant execute on function public.shared_plan_rsvp(text, text) to anon, authenticated;
