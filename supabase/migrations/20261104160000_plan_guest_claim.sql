-- W10 Etappe 2 · Gast-Zusage ins eigene Konto übernehmen
-- Wer über den Teilen-Link /s/<token> als Gast zugesagt hat und danach der Crew beitritt, findet auf der
-- Planseite „Du hast hier schon als Gast geantwortet“ und übernimmt die Antwort mit einem Tipp – oder
-- löscht die Gast-Antwort. Sonst stünde dieselbe Person zweimal bei „Wer“ (als Gast und als Mitglied).
--
-- Bewusst so gebaut (wie W3 Etappe 2 bei Abstimmungen):
--   * Nachweis ist das Geheimnis, das nur auf dem Gerät des Gasts liegt (64 Hex-Zeichen, gespeichert ist
--     nur der SHA-256-Hash). Wer ein fremdes Geheimnis nicht kennt, findet keinen Gast.
--   * Nur Mitglieder der Crew, nur solange der Plan weder abgeschlossen noch abgesagt ist, nur mit
--     ausdrücklichem Tipp – die App übernimmt nie von selbst.
--   * Keine doppelte Antwort: Hat das Mitglied schon selbst geantwortet (going/maybe/declined), bleibt seine
--     Antwort; die Gast-Antwort verfällt. Der Gast wird in derselben Transaktion gelöscht.
--   * Keine neue Benachrichtigung: Die organisierende Person hat die Antwort schon als Gast-Antwort bekommen.

-- Gibt es zu diesem Geheimnis einen Gast in diesem Plan?
--   none   – nein (oder Plan abgeschlossen/abgesagt, oder Geheimnis ungültig)
--   found  – name, status (Gast-Antwort), own (eigene Antwort als Mitglied oder null)
create function public.plan_guest_claim_preview(p_plan_id uuid, p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
  v_guest public.plan_guests%rowtype;
  v_own public.attendance_status;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id;
  if not found or not app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.forbid();
  end if;
  if p_secret is null or p_secret !~ '^[0-9a-f]{64}$' or v_plan.status in ('completed', 'cancelled') then
    return jsonb_build_object('status', 'none');
  end if;
  perform app_private.rate_limit('plan_guest_lookup', 120, interval '10 minutes');

  select g.* into v_guest from public.plan_guests g
  where g.plan_id = v_plan.id and g.secret_hash = app_private.hash_token(p_secret);
  if v_guest.id is null then
    return jsonb_build_object('status', 'none');
  end if;

  select pp.attendance_status into v_own from public.plan_participants pp
  where pp.plan_id = v_plan.id and pp.user_id = v_uid and pp.attendance_status <> 'invited';

  return jsonb_build_object(
    'status', 'found',
    'name', v_guest.display_name,
    'answer', v_guest.attendance_status,
    'own', v_own);
end $$;

-- Gast-Antwort übernehmen (p_keep = true) oder löschen (p_keep = false).
-- Ergebnis: claimed = true, wenn die Gast-Antwort jetzt die eigene ist; status = eigene Antwort danach (oder null).
create function public.claim_plan_guest(p_plan_id uuid, p_secret text, p_keep boolean) returns jsonb
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
    v_own := v_guest.attendance_status;
    v_claimed := true;
  end if;

  delete from public.plan_guests g where g.id = v_guest.id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, crew_id, meta)
  values (v_uid, case when p_keep then 'plan_guest_claimed' else 'plan_guest_discarded' end, 'plan', v_plan.id, v_plan.crew_id,
          jsonb_build_object('claimed', v_claimed));

  return jsonb_build_object('claimed', v_claimed, 'status', v_own);
end $$;

revoke all on function public.plan_guest_claim_preview(uuid, text), public.claim_plan_guest(uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.plan_guest_claim_preview(uuid, text), public.claim_plan_guest(uuid, text, boolean)
  to authenticated;
