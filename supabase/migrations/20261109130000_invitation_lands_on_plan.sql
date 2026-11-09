-- W11 Etappe 2 · Nach dem Beitritt direkt zum Plan (bzw. zur Abstimmung)
--
-- Wer als Gast vom Plan-Link (W11) oder vom Abstimm-Link (W3) aus einen persönlichen Einladungslink geholt hat,
-- landete nach dem Beitritt auf der Crew-Seite und musste den Abend erst suchen, um dort seine Gast-Antwort zu
-- übernehmen. `accept_crew_invitation` liefert jetzt zusätzlich, woher die Einladung kam:
--   * `plan_id` – Einladung aus einem Plan-Link, der Plan ist nicht abgesagt
--   * `poll_id` – Einladung aus einem Abstimm-Link
-- Beides nur bei `joined` bzw. `already_member`, also nur für Personen, die die Crew (und damit Plan und
-- Abstimmung über RLS) ohnehin sehen dürfen. Normale Einladungen liefern beides als null.
-- Sonst bleibt die Funktion unverändert (Rechte bleiben bei `create or replace` erhalten).

create or replace function public.accept_crew_invitation(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_inv public.crew_invitations;
  v_state text;
  v_plan_id uuid;
  v_poll_id uuid;
begin
  perform app_private.rate_limit('invitation_accept', 20, interval '10 minutes');
  select * into v_inv from public.crew_invitations i where i.token_hash = app_private.hash_token(p_token) for update;
  v_state := app_private.invitation_state(v_inv);

  if v_inv.id is not null then
    select p.id into v_plan_id from public.plans p
    where p.id = v_inv.via_plan_id and p.crew_id = v_inv.crew_id and p.status <> 'cancelled';
    select p.id into v_poll_id from public.polls p
    where p.id = v_inv.via_poll_id and p.crew_id = v_inv.crew_id;
  end if;

  if v_inv.id is not null and exists (select 1 from public.crew_members m where m.crew_id = v_inv.crew_id and m.user_id = v_uid) then
    return jsonb_build_object('status', 'already_member', 'crew_id', v_inv.crew_id, 'plan_id', v_plan_id, 'poll_id', v_poll_id);
  end if;
  if v_state <> 'valid' then
    return jsonb_build_object('status', v_state);
  end if;
  if (select count(*) from public.crew_members m where m.crew_id = v_inv.crew_id) >= 50 then
    return jsonb_build_object('status', 'crew_full');
  end if;
  if (select count(*) from public.crew_members m where m.user_id = v_uid) >= 30 then
    return jsonb_build_object('status', 'crew_limit_reached');
  end if;

  insert into public.crew_members (crew_id, user_id, role) values (v_inv.crew_id, v_uid, 'member');
  update public.crew_invitations i set use_count = i.use_count + 1 where i.id = v_inv.id;

  perform app_private.notify(m.user_id, 'crew_member_joined', v_uid, v_inv.crew_id, 'crew', v_inv.crew_id, '{}'::jsonb,
                             'crew_member_joined:' || v_inv.crew_id::text || ':' || v_uid::text)
  from public.crew_members m
  where m.crew_id = v_inv.crew_id and m.role in ('owner', 'admin') and m.user_id <> v_uid;

  perform app_private.audit('crew_joined', 'crew', v_inv.crew_id, v_inv.crew_id, jsonb_build_object('invitation_id', v_inv.id));
  return jsonb_build_object('status', 'joined', 'crew_id', v_inv.crew_id, 'plan_id', v_plan_id, 'poll_id', v_poll_id);
end $$;
