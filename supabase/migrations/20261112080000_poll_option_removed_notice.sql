-- P42 Etappe 2 · Bescheid, wenn jemand deinen Vorschlag rausnimmt.
-- Seit P42 dürfen auch wer die Abstimmung gestartet hat sowie Owner/Admin einen nachgereichten Vorschlag zurückziehen.
-- Die Person, die ihn nachgereicht hat, merkte davon nichts – ihr Termin oder Ort war einfach weg. Jetzt bekommt sie
-- einen Hinweis (Art `poll_reminder` mit `removed: true`, Gruppe „Erinnerungen“), mit Termin bzw. Ort im Text.
-- Kein Hinweis, wenn sie ihn selbst zurückzieht oder nicht mehr in der Crew ist. Alles andere wie in P42.

create or replace function public.remove_poll_option(p_option_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_option public.poll_options%rowtype;
  v_poll public.polls%rowtype;
  v_payload jsonb;
begin
  select * into v_option from public.poll_options o where o.id = p_option_id;
  if found then
    select * into v_poll from public.polls p where p.id = v_option.poll_id for update;
  end if;
  if v_option.id is null or not app_private.is_crew_member(v_poll.crew_id) then
    perform app_private.forbid();
  end if;
  if v_poll.status <> 'open' or v_poll.ends_at <= now() then
    perform app_private.fail('poll_closed');
  end if;
  if v_option.added_by is null then
    perform app_private.fail('poll_option_fixed');
  end if;
  if not (v_option.added_by = v_uid
          or v_poll.created_by is not distinct from v_uid
          or app_private.has_crew_role(v_poll.crew_id, array['owner', 'admin']::public.crew_role[])) then
    perform app_private.forbid();
  end if;
  if exists (select 1 from public.poll_votes v where v.poll_option_id = v_option.id and v.user_id <> v_option.added_by)
     or exists (select 1 from public.poll_guest_votes g where g.poll_option_id = v_option.id) then
    perform app_private.fail('poll_option_has_votes');
  end if;
  perform app_private.rate_limit('poll_option_withdraw', 20, interval '1 hour');

  delete from public.notifications n
  where n.dedupe_key in ('poll_slot_added:' || v_option.id::text, 'poll_place_added:' || v_option.id::text);

  update public.polls p
  set withdrawn_position = greatest(coalesce(p.withdrawn_position, v_option.position), v_option.position)
  where p.id = v_poll.id;

  delete from public.poll_options o where o.id = v_option.id;

  -- P42 Etappe 2: Nimmt jemand anderes den Vorschlag raus, erfährt es die Person, die ihn nachgereicht hat –
  -- solange sie noch in der Crew ist. Termin bzw. Ort stehen im Hinweis, weil der Vorschlag selbst weg ist.
  if v_option.added_by <> v_uid
     and exists (select 1 from public.crew_members m where m.crew_id = v_poll.crew_id and m.user_id = v_option.added_by) then
    v_payload := jsonb_build_object('title', v_poll.title, 'removed', true);
    if v_poll.kind = 'date' and v_option.proposed_date is not null then
      v_payload := v_payload || jsonb_build_object('date', v_option.proposed_date,
                                                   'time', to_char(v_option.proposed_time, 'HH24:MI'));
    else
      v_payload := v_payload || jsonb_build_object('place', v_option.title);
    end if;
    perform app_private.notify(v_option.added_by, 'poll_reminder', v_uid, v_poll.crew_id, 'poll', v_poll.id,
                               v_payload, 'poll_option_removed:' || v_option.id::text);
  end if;

  if v_poll.auto_decide and app_private.poll_clear_winner(v_poll.id) is not null then
    perform app_private.close_poll_internal(v_poll.id, null);
  end if;
end $$;

comment on function public.remove_poll_option(uuid) is
  'P42: nachgereichten Vorschlag zurückziehen (wer ihn nachgereicht hat, wer die Abstimmung gestartet hat, Owner/Admin), solange niemand sonst dazu geantwortet hat. Etappe 2: Hinweis an die Person, die ihn nachgereicht hat, wenn jemand anderes zurückzieht.';
