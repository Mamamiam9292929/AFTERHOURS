-- P52 · Gäste bringen was mit: Mitbring-Liste (P14) auf dem geteilten Plan (W10)
-- Beim Grillen oder Spieleabend sagen oft Freunde ohne Konto über den Teilen-Link zu (W10). Die Mitbring-Liste sahen
-- sie bisher nicht – „Wer bringt die Kohle?“ lief für sie weiter über den Gruppenchat, und die Crew wusste nicht,
-- was der Gast schon zugesagt hatte. Jetzt sehen Gäste mit Zusage oder „Vielleicht“ die Liste auf der Zusagekarte
-- und tippen „Bring ich“ / „Doch nicht“.
--
-- Bewusst so gebaut (wie die übrigen Gast-Antworten):
--   * Nachweis ist das Geheimnis auf dem Gerät des Gasts; nur mit eigener Gast-Antwort „Bin dabei“ oder „Vielleicht“,
--     nur solange Zusagen über den Link offen sind (Schalter an, vor Beginn, weder abgeschlossen noch abgesagt).
--     Mitglieder der Crew nehmen die App. Rate Limit je Link.
--   * Gäste tragen nichts Neues ein und löschen nichts – sie übernehmen nur offene Sachen. Die Liste bleibt in der
--     Hand der Crew.
--   * Gäste sehen nur die Sachen und ob sie offen, eigene oder vergeben sind – keine Namen der Crew.
--   * Die Crew sieht „Dana (Gast) bringt es“. Eine Sache bringt weiterhin genau eine Person mit: Mitglied oder Gast.
--   * „Kann nicht“, Zurückziehen der Antwort und Entfernen des Gasts geben die Sachen frei. Übernimmt der Gast die
--     Antwort ins Konto (`claim_plan_guest`, p_keep), bringt er sie danach als Mitglied mit.

alter table public.plan_items
  add column claimed_by_guest uuid references public.plan_guests (id) on delete set null,
  add constraint plan_items_one_bringer check (claimed_by is null or claimed_by_guest is null);
create index plan_items_claimed_by_guest_idx on public.plan_items (claimed_by_guest);

comment on column public.plan_items.claimed_by_guest is
  'P52: Gast (W10), der die Sache mitbringt; schließt claimed_by aus.';

-- Gibt ein Gast „Kann nicht“ an, ist er für die Liste nicht mehr da (wie ein Mitglied, das die Crew verlässt).
create function app_private.release_plan_items_on_guest_decline() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.attendance_status = 'declined' and old.attendance_status is distinct from 'declined' then
    update public.plan_items i set claimed_by_guest = null, claimed_at = null where i.claimed_by_guest = new.id;
  end if;
  return new;
end $$;
create trigger plan_guests_release_items after update of attendance_status on public.plan_guests
  for each row execute function app_private.release_plan_items_on_guest_decline();

-- Fällt der Gast weg (zurückgezogen, entfernt), wird nur claimed_by_guest leer (FK) – claimed_at mit aufräumen.
create function app_private.plan_items_clear_claimed_at() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.claimed_by is null and new.claimed_by_guest is null then
    new.claimed_at := null;
  end if;
  return new;
end $$;
create trigger plan_items_clear_claimed_at before update on public.plan_items
  for each row execute function app_private.plan_items_clear_claimed_at();

-- Gast zum Link prüfen: Link gültig, Zusagen offen, kein Mitglied, Geheimnis passt, Antwort „Bin dabei“/„Vielleicht“.
-- p_write: für „Bring ich“/„Doch nicht“ (dann muss der Link noch offen sein und der Gast wird gesperrt).
create function app_private.plan_guest_for_items(p_token text, p_secret text, p_write boolean) returns public.plan_guests
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
  if p_write then
    if v_plan.status in ('completed', 'cancelled') then
      perform app_private.fail('plan_locked');
    end if;
    if v_plan.starts_at <= now() then
      perform app_private.fail('plan_guests_started');
    end if;
  end if;
  if auth.uid() is not null and app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.fail('plan_guest_member');
  end if;
  if p_secret is null or p_secret !~ '^[0-9a-f]{64}$' then
    perform app_private.fail('invalid_input');
  end if;

  if p_write then
    select g.* into v_guest from public.plan_guests g
    where g.plan_id = v_plan.id and g.secret_hash = app_private.hash_token(p_secret)
    for update;
  else
    select g.* into v_guest from public.plan_guests g
    where g.plan_id = v_plan.id and g.secret_hash = app_private.hash_token(p_secret);
  end if;
  if v_guest.id is null or v_guest.attendance_status not in ('going', 'maybe') then
    perform app_private.fail('plan_items_guest_no_answer');
  end if;
  return v_guest;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Liste für den Gast: Sachen in der Reihenfolge der Crew, je Sache offen / eigene / vergeben (ohne Namen).
-- ---------------------------------------------------------------------------------------------
create function public.shared_plan_items(p_token text, p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_guest public.plan_guests;
  v_plan public.plans;
begin
  v_guest := app_private.plan_guest_for_items(p_token, p_secret, false);
  perform app_private.rate_limit_key(p_token, 'plan_guest_items_read', 240, interval '10 minutes');
  select p.* into v_plan from public.plans p where p.id = v_guest.plan_id;
  return jsonb_build_object(
    'open', app_private.plan_guests_open(v_plan),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id,
               'label', i.label,
               'state', case when i.claimed_by_guest = v_guest.id then 'mine'
                             when i.claimed_by is null and i.claimed_by_guest is null then 'open'
                             else 'taken' end)
             order by i.created_at, i.id)
      from public.plan_items i where i.plan_id = v_guest.plan_id), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------------------------
-- „Bring ich“ (p_claim = true) oder „Doch nicht“ (false) als Gast. Vergeben wird nur, was noch frei ist; freigeben
-- kann der Gast nur, was er selbst mitbringen wollte.
-- ---------------------------------------------------------------------------------------------
create function public.guest_claim_plan_item(p_token text, p_secret text, p_item_id uuid, p_claim boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_guest public.plan_guests;
  v_item public.plan_items%rowtype;
begin
  v_guest := app_private.plan_guest_for_items(p_token, p_secret, true);
  if p_item_id is null or p_claim is null then
    perform app_private.fail('invalid_input');
  end if;
  perform app_private.rate_limit_key(p_token, 'plan_guest_item_claim', 120, interval '10 minutes');

  select * into v_item from public.plan_items i where i.id = p_item_id and i.plan_id = v_guest.plan_id for update;
  if not found then
    perform app_private.forbid();
  end if;

  if p_claim then
    if v_item.claimed_by_guest = v_guest.id then
      return;
    end if;
    if v_item.claimed_by is not null or v_item.claimed_by_guest is not null then
      perform app_private.fail('plan_item_taken');
    end if;
    update public.plan_items i set claimed_by_guest = v_guest.id, claimed_at = now() where i.id = v_item.id;
  else
    if v_item.claimed_by is null and v_item.claimed_by_guest is null then
      return;
    end if;
    if v_item.claimed_by_guest is distinct from v_guest.id then
      perform app_private.fail('plan_item_taken');
    end if;
    update public.plan_items i set claimed_by_guest = null, claimed_at = null where i.id = v_item.id;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Mitglieder: „Bring ich“ nur, wenn auch kein Gast die Sache mitbringt (ersetzt 20261029050000; gleiche Signatur).
-- ---------------------------------------------------------------------------------------------
create or replace function public.claim_plan_item(p_item_id uuid, p_claim boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_item public.plan_items%rowtype;
begin
  select * into v_item from public.plan_items i where i.id = p_item_id for update;
  if not found then
    perform app_private.forbid();
  end if;
  perform app_private.plan_for_items(v_item.plan_id);
  if p_claim is null then
    perform app_private.fail('invalid_plan_item');
  end if;
  perform app_private.rate_limit('plan_item_claim', 120, interval '1 hour');

  if p_claim then
    if v_item.claimed_by = v_uid then
      return;
    end if;
    if v_item.claimed_by is not null or v_item.claimed_by_guest is not null then
      perform app_private.fail('plan_item_taken');
    end if;
    update public.plan_items i set claimed_by = v_uid, claimed_at = now() where i.id = p_item_id;
  else
    if v_item.claimed_by is null then
      if v_item.claimed_by_guest is not null then
        perform app_private.fail('plan_item_taken');
      end if;
      return;
    end if;
    if v_item.claimed_by <> v_uid then
      perform app_private.fail('plan_item_taken');
    end if;
    update public.plan_items i set claimed_by = null, claimed_at = null where i.id = p_item_id;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Gast-Antwort übernehmen: wer die Antwort behält, bringt die Sachen als Mitglied mit (sonst unverändert gegenüber
-- 20261113140000). Wer sie löscht, gibt sie frei (FK). Hat das Mitglied schon eine eigene Antwort „Kann nicht“,
-- bleiben die Sachen trotzdem bei ihm – „Doch nicht“ ist ein Tipp.
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

  delete from public.plan_guests g where g.id = v_guest.id;
  perform set_config('app.plan_capacity_hold', '', true);
  perform app_private.promote_plan_waitlist(v_plan.id);

  insert into public.audit_log (actor_id, action, entity_type, entity_id, crew_id, meta)
  values (v_uid, case when p_keep then 'plan_guest_claimed' else 'plan_guest_discarded' end, 'plan', v_plan.id, v_plan.crew_id,
          jsonb_build_object('claimed', v_claimed));

  return jsonb_build_object('claimed', v_claimed, 'status', v_own);
end $$;

revoke all on function app_private.release_plan_items_on_guest_decline() from public, anon, authenticated;
revoke all on function app_private.plan_items_clear_claimed_at() from public, anon, authenticated;
revoke all on function app_private.plan_guest_for_items(text, text, boolean) from public, anon, authenticated;
revoke all on function public.shared_plan_items(text, text) from public, anon, authenticated;
revoke all on function public.guest_claim_plan_item(text, text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.claim_plan_item(uuid, boolean) from public, anon, authenticated;
revoke all on function public.claim_plan_guest(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.shared_plan_items(text, text) to anon, authenticated;
grant execute on function public.guest_claim_plan_item(text, text, uuid, boolean) to anon, authenticated;
grant execute on function public.claim_plan_item(uuid, boolean) to authenticated, service_role;
grant execute on function public.claim_plan_guest(uuid, text, boolean) to authenticated;

comment on function public.shared_plan_items(text, text) is
  'P52: Mitbring-Liste für Gäste mit Zusage/Vielleicht über den Teilen-Link – Sachen mit offen/eigene/vergeben, ohne Namen.';
comment on function public.guest_claim_plan_item(text, text, uuid, boolean) is
  'P52: „Bring ich“ / „Doch nicht“ als Gast über den Teilen-Link.';
