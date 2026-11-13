-- P51 Etappe 2 · „Ich bring wen mit“ auch für Gäste über den Teilen-Link (W10)
-- Seit Etappe 1 sagen Mitglieder der Crew mit einem Tipp „+1“, „+2“ oder „+3“. Wer ohne Konto über /s/<token>
-- zugesagt hat, konnte das nicht – „bring Lisa mit“ landete wieder im Gruppenchat und wurde nirgends gezählt.
-- Jetzt bringen auch Gäste bis zu drei Personen mit, und die Begleitung zählt überall mit, wo Zusagen zählen.
--
-- Bewusst so gebaut (wie Etappe 1 und wie die übrigen Gast-Antworten):
--   * Nachweis ist das Geheimnis auf dem Gerät des Gasts; nur mit eigener Gast-Antwort „Bin dabei“, nur solange
--     Zusagen über den Link an sind, nur vor Beginn und solange der Plan weder abgeschlossen noch abgesagt ist.
--     Mitglieder der Crew nehmen die App. Rate Limit je Link.
--   * Begleitungen sind namenlos und gehören zur Antwort: Ändert sie sich (auch durch Nachrücken oder „Alle neu
--     fragen“), ist die Begleitung weg – derselbe Trigger wie bei `plan_participants`.
--   * Gezählt wird über `app_private.plan_going_count` (Mindest- und Höchstzahl, Nachrückliste, Messenger-Vorschau,
--     Frist-Stand) und auf der Zusagekarte. Passt die Begleitung nicht mehr in die Höchstzahl: `plan_full`.
--     Weniger Begleitung macht Plätze frei – die Nachrückliste rückt nach.
--   * Übernimmt der Gast die Antwort ins Konto (`claim_plan_guest`), kommt die Begleitung mit.
--   * Keine Benachrichtigung: Die Crew sieht „+1“ hinter „Dana (Gast)“.

alter table public.plan_guests
  add column plus_ones smallint not null default 0 check (plus_ones between 0 and 3);

comment on column public.plan_guests.plus_ones is
  'P51 Etappe 2: so viele Begleitungen bringt der Gast mit (0–3), nur bei „Bin dabei“.';

-- Die Crew sieht die Begleitung bei „Wer kommt mit?“.
grant select (plus_ones) on public.plan_guests to authenticated;

-- Begleitung gehört zur Antwort: jede andere Antwort setzt sie zurück (gleiche Funktion wie in 20261113110000).
create trigger plan_guests_plus_ones_reset
  before update of attendance_status on public.plan_guests
  for each row execute function app_private.plan_participant_plus_ones_reset();

-- Zusagen inklusive Begleitung von Mitgliedern und Gästen (ersetzt 20261113110000; gleiche Signatur und Rechte).
create or replace function app_private.plan_going_count(p_plan_id uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select (select coalesce(sum(1 + pp.plus_ones), 0) from public.plan_participants pp
          where pp.plan_id = p_plan_id and pp.attendance_status = 'going')::integer
       + (select coalesce(sum(1 + g.plus_ones), 0) from public.plan_guests g
          where g.plan_id = p_plan_id and g.attendance_status = 'going')::integer;
$$;
revoke all on function app_private.plan_going_count(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Begleitung als Gast setzen (0–3). Liefert die gespeicherte Zahl.
-- ---------------------------------------------------------------------------------------------
create function public.guest_plus_ones_shared_plan(p_token text, p_secret text, p_count integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.plans;
  v_max smallint;
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
  if v_plan.starts_at <= now() then
    perform app_private.fail('plan_plus_ones_started');
  end if;
  if auth.uid() is not null and app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.fail('plan_guest_member');
  end if;
  if p_secret is null or p_secret !~ '^[0-9a-f]{64}$' or p_count is null or p_count < 0 or p_count > 3 then
    perform app_private.fail('invalid_input');
  end if;

  perform app_private.rate_limit_key(p_token, 'plan_guest_plus_ones', 120, interval '10 minutes');

  -- Sperre wie bei jeder Zusage (plan_capacity_guard): zwei gleichzeitige Änderungen zählen nacheinander.
  select p.max_going into v_max from public.plans p where p.id = v_plan.id for update;
  select g.* into v_guest from public.plan_guests g
  where g.plan_id = v_plan.id and g.secret_hash = app_private.hash_token(p_secret)
  for update;
  if v_guest.id is null or v_guest.attendance_status <> 'going' then
    perform app_private.fail('plan_plus_ones_not_going');
  end if;
  if p_count = v_guest.plus_ones then
    return p_count;
  end if;

  if p_count > v_guest.plus_ones and v_max is not null
     and app_private.plan_going_count(v_plan.id) - v_guest.plus_ones + p_count > v_max then
    perform app_private.fail('plan_full');
  end if;

  update public.plan_guests g set plus_ones = p_count, updated_at = now() where g.id = v_guest.id;

  if p_count > v_guest.plus_ones then
    perform app_private.check_plan_min_going(v_plan.id);
  else
    perform app_private.promote_plan_waitlist(v_plan.id);
  end if;
  return p_count;
end $$;

revoke all on function public.guest_plus_ones_shared_plan(text, text, integer) from public, anon, authenticated;
grant execute on function public.guest_plus_ones_shared_plan(text, text, integer) to anon, authenticated;
comment on function public.guest_plus_ones_shared_plan(text, text, integer) is
  'P51 Etappe 2: „Ich bring wen mit“ für Gäste über den Teilen-Link – 0–3 Begleitungen zur eigenen Zusage.';

-- ---------------------------------------------------------------------------------------------
-- Zusagekarte: Begleitung der Gäste zählt bei „dabei“ mit, „me“ mit `plus_ones` (fehlt bei 0). Sonst unverändert
-- gegenüber 20261113110000.
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
      'stops', app_private.plan_stops_json(v_plan.id)),
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
      'waitlist', case when v_guest.waitlisted_at is not null then app_private.plan_waitlist_position(v_plan.id, null, v_guest.id) end,
      'promoted', case when v_guest.promoted_at is not null and v_guest.attendance_status = 'going' then true end)) end);
end $$;
revoke all on function public.shared_plan_rsvp(text, text) from public, anon, authenticated;
grant execute on function public.shared_plan_rsvp(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Gast-Antwort übernehmen: die Begleitung kommt mit (sonst unverändert gegenüber 20261105180000).
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
