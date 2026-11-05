-- P24 Etappe 2 · Zusatz zur Antwort auch für Freunde ohne Konto (W10)
-- Wer über den Teilen-Link /s/<token> zugesagt hat, hängt wie die Crew einen kurzen Zusatz an
-- („komme später“, höchstens 60 Zeichen). Die Crew sieht ihn bei „Wer kommt mit?“ hinter „Dana (Gast)“.
--
-- Bewusst so gebaut (wie Etappe 1 und wie die Gast-Antworten selbst):
--   * Nachweis ist das Geheimnis auf dem Gerät des Gasts; nur mit eigener Gast-Antwort, nur solange Gäste
--     erlaubt sind und der Plan weder abgeschlossen noch abgesagt ist. Mitglieder der Crew nehmen die App.
--   * Der Zusatz gehört zur Antwort: Ändert sich die Antwort, ist er weg (derselbe Trigger wie bei
--     `plan_participants`). Übernimmt der Gast die Antwort ins Konto (`claim_plan_guest`), kommt der
--     Zusatz mit.
--   * Keine Benachrichtigung; Rate Limit je Link.

alter table public.plan_guests
  add column note text check (note is null or char_length(note) between 1 and 60);
comment on column public.plan_guests.note is
  'P24: kurzer Zusatz zur Gast-Antwort, verfällt mit jeder Änderung der Antwort.';
grant select (note) on public.plan_guests to authenticated;

create trigger plan_guests_note_reset
  before update of attendance_status on public.plan_guests
  for each row execute function app_private.plan_participant_note_reset();

-- Zusatz setzen (p_note) oder entfernen (null/leer). Liefert den gespeicherten Zusatz.
create function public.guest_note_shared_plan(p_token text, p_secret text, p_note text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.plans;
  v_note text := app_private.clean_line(p_note, 60);
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
  if auth.uid() is not null and app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.fail('plan_guest_member');
  end if;
  if p_secret is null or p_secret !~ '^[0-9a-f]{64}$' or (p_note is not null and char_length(p_note) > 200) then
    perform app_private.fail('invalid_input');
  end if;

  perform app_private.rate_limit_key(p_token, 'plan_guest_note', 120, interval '10 minutes');

  select g.* into v_guest from public.plan_guests g
  where g.plan_id = v_plan.id and g.secret_hash = app_private.hash_token(p_secret)
  for update;
  if v_guest.id is null then
    perform app_private.fail('plan_note_no_answer');
  end if;

  update public.plan_guests g set note = v_note, updated_at = now() where g.id = v_guest.id;
  return v_note;
end $$;

revoke all on function public.guest_note_shared_plan(text, text, text) from public, anon, authenticated;
grant execute on function public.guest_note_shared_plan(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Zusagekarte: „me“ enthält jetzt auch den eigenen Zusatz (sonst unverändert gegenüber 20261104130000).
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
    -- „note“ nur, wenn es einen Zusatz gibt (ältere Clients und Tests sehen dasselbe Objekt wie vorher).
    'me', case when v_guest.id is null then null else jsonb_strip_nulls(jsonb_build_object(
      'name', v_guest.display_name,
      'status', v_guest.attendance_status,
      'note', v_guest.note)) end);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Gast-Antwort übernehmen: der Zusatz kommt mit (sonst unverändert gegenüber 20261104160000).
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

  if p_keep and v_own is null then
    insert into public.plan_participants (plan_id, user_id, attendance_status, responded_at)
    values (v_plan.id, v_uid, v_guest.attendance_status, now())
    on conflict (plan_id, user_id) do update set attendance_status = excluded.attendance_status, responded_at = now();
    -- Erst nach dem Statuswechsel setzen – der Trigger leert den Zusatz bei jeder neuen Antwort.
    update public.plan_participants pp set note = v_guest.note where pp.plan_id = v_plan.id and pp.user_id = v_uid;
    v_own := v_guest.attendance_status;
    v_claimed := true;
  end if;

  delete from public.plan_guests g where g.id = v_guest.id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, crew_id, meta)
  values (v_uid, case when p_keep then 'plan_guest_claimed' else 'plan_guest_discarded' end, 'plan', v_plan.id, v_plan.crew_id,
          jsonb_build_object('claimed', v_claimed));

  return jsonb_build_object('claimed', v_claimed, 'status', v_own);
end $$;
