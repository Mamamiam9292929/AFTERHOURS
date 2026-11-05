-- P25 Etappe 2 · „Noch 1 fehlt – bist du dabei?“ auch auf der geteilten Plan-Karte (/s/<token>) und in der
-- Messenger-Vorschau. Die Vorschau liefert dazu die Mindestzahl – nur solange der Plan offen ist (nicht
-- abgeschlossen, nicht abgesagt, noch nicht begonnen); sonst null. Die Zahl der Zusagen stand schon drin.
-- Ersetzt die Fassung aus 20261104130000 (Rechte bleiben bei create or replace erhalten).

create or replace function public.preview_shared_plan(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.plans;
begin
  v_plan := app_private.plan_by_share_token(p_token);
  if v_plan.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if coalesce(v_plan.ends_at, v_plan.starts_at) < now() - interval '3 days' then
    return jsonb_build_object('status', 'expired');
  end if;

  perform app_private.rate_limit_key(p_token, 'plan_share_public', 120, interval '10 minutes');

  return jsonb_build_object(
    'status', 'valid',
    'plan', jsonb_build_object(
      'title', v_plan.title,
      'starts_at', v_plan.starts_at,
      'ends_at', v_plan.ends_at,
      'status', v_plan.status,
      'going_count', app_private.plan_going_count(v_plan.id),
      'guests', app_private.plan_guests_open(v_plan),
      'min_going', case when v_plan.status not in ('completed', 'cancelled') and v_plan.starts_at > now()
                        then v_plan.min_going end),
    'plan_id', case when auth.uid() is not null and app_private.is_crew_member(v_plan.crew_id) then v_plan.id end);
end $$;

revoke all on function public.preview_shared_plan(text) from public, anon, authenticated;
grant execute on function public.preview_shared_plan(text) to anon, authenticated, service_role;
