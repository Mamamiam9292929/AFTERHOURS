-- AFTERHOURS · 3/5 · Interne Bausteine: Fehler, Rate Limits, Audit, Benachrichtigungen, Trigger
-- Nichts in dieser Datei ist direkt über die API aufrufbar.

-- ---------------------------------------------------------------------------------------------
-- Fehlerkonvention
--   P0001 + message = maschinenlesbarer Schlüssel (z. B. 'poll_closed'); die App übersetzt ihn.
--   42501 = keine Berechtigung (PostgREST antwortet mit 403).
-- ---------------------------------------------------------------------------------------------
create function app_private.fail(p_code text, p_detail text default null) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception '%', p_code using errcode = 'P0001', detail = coalesce(p_detail, '');
end $$;

create function app_private.forbid() returns void
language plpgsql set search_path = '' as $$
begin
  raise exception 'forbidden' using errcode = '42501';
end $$;

create function app_private.require_user() returns uuid
language plpgsql stable set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  return v_uid;
end $$;

-- Einzeilige Texte: Whitespace zusammenfassen, kürzen, leere Eingaben zu NULL.
create function app_private.clean_line(p_text text, p_max integer) returns text
language sql immutable set search_path = '' as $$
  select nullif(left(btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g')), p_max), '');
$$;

-- Mehrzeilige Texte: nur trimmen und kürzen.
create function app_private.clean_text(p_text text, p_max integer) returns text
language sql immutable set search_path = '' as $$
  select nullif(left(btrim(coalesce(p_text, '')), p_max), '');
$$;

create function app_private.hash_token(p_token text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
$$;

-- ---------------------------------------------------------------------------------------------
-- Rate Limit pro Nutzer und Aktion (gleitendes Fenster)
-- ---------------------------------------------------------------------------------------------
create function app_private.rate_limit(p_action text, p_max integer, p_window interval) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_count integer;
begin
  delete from public.rate_limit_hits h
  where h.user_id = v_uid and h.created_at < now() - interval '1 day';

  select count(*) into v_count
  from public.rate_limit_hits h
  where h.user_id = v_uid and h.action = p_action and h.created_at > now() - p_window;

  if v_count >= p_max then
    raise exception 'rate_limited' using errcode = 'P0001', detail = p_action;
  end if;

  insert into public.rate_limit_hits (user_id, action) values (v_uid, p_action);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Audit-Log für kritische Aktionen
-- ---------------------------------------------------------------------------------------------
create function app_private.audit(
  p_action text, p_entity_type text default null, p_entity_id uuid default null,
  p_crew_id uuid default null, p_meta jsonb default '{}'::jsonb
) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_log (actor_id, action, entity_type, entity_id, crew_id, meta)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, p_crew_id, coalesce(p_meta, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------------------------
-- Benachrichtigungen
-- ---------------------------------------------------------------------------------------------
-- Beachtet die persönlichen Einstellungen (fehlender Schlüssel = aktiviert) und entdoppelt über dedupe_key.
create function app_private.notify(
  p_user_id uuid, p_type text, p_actor_id uuid, p_crew_id uuid, p_entity_type text, p_entity_id uuid,
  p_payload jsonb default '{}'::jsonb, p_dedupe_key text default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null then
    return;
  end if;
  if exists (
    select 1 from public.user_settings s
    where s.user_id = p_user_id and (s.notification_preferences ->> p_type) = 'false'
  ) then
    return;
  end if;
  insert into public.notifications (user_id, type, actor_id, crew_id, entity_type, related_entity_id, payload, dedupe_key)
  values (p_user_id, p_type, p_actor_id, p_crew_id, p_entity_type, p_entity_id, coalesce(p_payload, '{}'::jsonb), p_dedupe_key)
  on conflict (user_id, dedupe_key) do nothing;
end $$;

-- An alle Mitglieder einer Crew, optional ohne die auslösende Person.
create function app_private.notify_crew(
  p_crew_id uuid, p_type text, p_actor_id uuid, p_entity_type text, p_entity_id uuid,
  p_payload jsonb default '{}'::jsonb, p_dedupe_key text default null, p_include_actor boolean default false
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_member record;
begin
  for v_member in
    select m.user_id from public.crew_members m
    where m.crew_id = p_crew_id and (p_include_actor or p_actor_id is null or m.user_id <> p_actor_id)
  loop
    perform app_private.notify(v_member.user_id, p_type, p_actor_id, p_crew_id, p_entity_type, p_entity_id, p_payload, p_dedupe_key);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Trigger: updated_at, Profil-Normalisierung
-- ---------------------------------------------------------------------------------------------
create function app_private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_touch before update on public.profiles for each row execute function app_private.touch_updated_at();
create trigger user_settings_touch before update on public.user_settings for each row execute function app_private.touch_updated_at();
create trigger crews_touch before update on public.crews for each row execute function app_private.touch_updated_at();
create trigger activities_touch before update on public.activities for each row execute function app_private.touch_updated_at();
create trigger plans_touch before update on public.plans for each row execute function app_private.touch_updated_at();
create trigger booking_requests_touch before update on public.booking_requests for each row execute function app_private.touch_updated_at();
create trigger ride_requests_touch before update on public.ride_requests for each row execute function app_private.touch_updated_at();

-- SECURITY DEFINER, weil der Trigger bei direkten Updates in der Rolle des Nutzers läuft, die internen
-- Hilfsfunktionen (clean_line) für API-Rollen aber gesperrt sind.
create function app_private.normalize_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.display_name := coalesce(app_private.clean_line(new.display_name, 40), '');
  new.city := app_private.clean_line(new.city, 80);
  return new;
end $$;
create trigger profiles_normalize before insert or update on public.profiles
  for each row execute function app_private.normalize_profile();

create function app_private.normalize_crew() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.name := coalesce(app_private.clean_line(new.name, 40), '');
  new.emoji := coalesce(app_private.clean_line(new.emoji, 16), '🌙');
  return new;
end $$;
create trigger crews_normalize before insert or update on public.crews
  for each row execute function app_private.normalize_crew();

-- ---------------------------------------------------------------------------------------------
-- Trigger: neues Konto -> Profil + Einstellungen
-- ---------------------------------------------------------------------------------------------
-- display_name stammt aus den (vom Nutzer gelieferten) Registrierungsdaten und wird deshalb bereinigt.
create function app_private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := app_private.clean_line(new.raw_user_meta_data ->> 'display_name', 40);
begin
  if v_name is null or char_length(v_name) < 2 then
    v_name := 'Neues Mitglied';
  end if;
  insert into public.profiles (id, display_name) values (new.id, v_name) on conflict (id) do nothing;
  insert into public.user_settings (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app_private.handle_new_user();

-- ---------------------------------------------------------------------------------------------
-- Trigger: Mitgliedschaften
-- ---------------------------------------------------------------------------------------------
-- Wer einer Crew beitritt, wird zu deren anstehenden Plänen eingeladen.
create function app_private.on_crew_member_added() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.plan_participants (plan_id, user_id)
  select p.id, new.user_id
  from public.plans p
  where p.crew_id = new.crew_id
    and p.status in ('proposed', 'confirmed', 'booking_pending', 'booked')
    and p.starts_at > now()
  on conflict do nothing;
  return new;
end $$;
create trigger crew_members_added after insert on public.crew_members
  for each row execute function app_private.on_crew_member_added();

-- Wer eine Crew verlässt (freiwillig, entfernt oder durch Kontolöschung):
--   * Stimmen in noch offenen Abstimmungen und Teilnahmen an künftigen Plänen entfallen,
--   * war es der Owner, rückt das dienstälteste Admin- bzw. Mitglied nach,
--   * bleibt niemand übrig, wird die Crew gelöscht.
create function app_private.on_crew_member_removed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_successor uuid;
begin
  if not exists (select 1 from public.crews c where c.id = old.crew_id) then
    return old; -- Crew wird gerade selbst gelöscht
  end if;

  delete from public.poll_votes v
  using public.polls p
  where v.poll_id = p.id and p.crew_id = old.crew_id and p.status = 'open' and v.user_id = old.user_id;

  delete from public.plan_participants pp
  using public.plans p
  where pp.plan_id = p.id and p.crew_id = old.crew_id and pp.user_id = old.user_id
    and p.status in ('proposed', 'confirmed', 'booking_pending', 'booked') and p.starts_at > now();

  delete from public.ride_offers o
  using public.plans p
  where o.plan_id = p.id and p.crew_id = old.crew_id and o.driver_user_id = old.user_id and p.starts_at > now();

  delete from public.ride_requests r
  using public.ride_offers o, public.plans p
  where r.ride_offer_id = o.id and o.plan_id = p.id and p.crew_id = old.crew_id
    and r.passenger_user_id = old.user_id and p.starts_at > now();

  update public.user_settings s
  set location_sharing_crew_id = null,
      location_sharing_mode = case when s.location_sharing_mode = 'crew' then 'off'::public.location_sharing_mode else s.location_sharing_mode end
  where s.user_id = old.user_id and s.location_sharing_crew_id = old.crew_id;

  if not exists (select 1 from public.crew_members m where m.crew_id = old.crew_id) then
    delete from public.crews c where c.id = old.crew_id;
    return old;
  end if;

  if old.role = 'owner' and not exists (select 1 from public.crew_members m where m.crew_id = old.crew_id and m.role = 'owner') then
    select m.user_id into v_successor
    from public.crew_members m
    where m.crew_id = old.crew_id
    order by (m.role = 'admin') desc, m.joined_at asc, m.user_id asc
    limit 1;

    update public.crew_members m set role = 'owner' where m.crew_id = old.crew_id and m.user_id = v_successor;
    perform app_private.notify(v_successor, 'crew_role_changed', null, old.crew_id, 'crew', old.crew_id,
                               jsonb_build_object('role', 'owner', 'reason', 'succession'));
    insert into public.audit_log (actor_id, action, entity_type, entity_id, crew_id, meta)
    values (old.user_id, 'crew_owner_succession', 'crew', old.crew_id, old.crew_id, jsonb_build_object('new_owner', v_successor));
  end if;
  return old;
end $$;
create trigger crew_members_removed after delete on public.crew_members
  for each row execute function app_private.on_crew_member_removed();

-- ---------------------------------------------------------------------------------------------
-- Abstimmung schließen (gemeinsame Logik für manuelles Beenden, Fristablauf und Cron)
-- ---------------------------------------------------------------------------------------------
-- Es zählen ausschließlich gespeicherte "Bin dabei"-Stimmen. Bei Gleichstand an der Spitze gibt es
-- keinen Gewinner (is_tie = true); ohne jede Zusage ebenfalls nicht (is_tie = false).
create function app_private.close_poll_internal(p_poll_id uuid, p_closed_by uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_poll public.polls%rowtype;
  v_max bigint;
  v_top_count bigint;
  v_winner uuid;
  v_winner_title text;
begin
  select * into v_poll from public.polls p where p.id = p_poll_id for update;
  if not found or v_poll.status = 'closed' then
    return;
  end if;

  with counts as (
    select o.id, count(v.id) filter (where v.response = 'yes') as yes_count
    from public.poll_options o
    left join public.poll_votes v on v.poll_option_id = o.id
    where o.poll_id = p_poll_id
    group by o.id
  ), top as (
    select coalesce(max(yes_count), 0) as max_yes from counts
  )
  select t.max_yes, count(*) filter (where c.yes_count = t.max_yes), (min(c.id::text) filter (where c.yes_count = t.max_yes))::uuid
  into v_max, v_top_count, v_winner
  from counts c cross join top t
  group by t.max_yes;

  if coalesce(v_max, 0) = 0 or v_top_count > 1 then
    v_winner := null;
  end if;

  update public.polls p
  set status = 'closed', closed_at = now(), closed_by = p_closed_by,
      winning_option_id = v_winner, is_tie = (coalesce(v_max, 0) > 0 and v_top_count > 1)
  where p.id = p_poll_id;

  select o.title into v_winner_title from public.poll_options o where o.id = v_winner;

  perform app_private.notify_crew(
    v_poll.crew_id, 'poll_result', p_closed_by, 'poll', p_poll_id,
    jsonb_build_object('title', v_poll.title, 'winner_title', v_winner_title,
                       'is_tie', (coalesce(v_max, 0) > 0 and v_top_count > 1), 'yes_count', coalesce(v_max, 0)),
    'poll_result:' || p_poll_id::text, p_closed_by is null
  );

  insert into public.audit_log (actor_id, action, entity_type, entity_id, crew_id, meta)
  values (p_closed_by, 'poll_closed', 'poll', p_poll_id, v_poll.crew_id,
          jsonb_build_object('winning_option_id', v_winner, 'automatic', p_closed_by is null));
end $$;

-- Für pg_cron bzw. service_role: schließt alle Abstimmungen, deren Frist abgelaufen ist.
create function app_private.finalize_due_polls() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_poll record;
  v_count integer := 0;
begin
  for v_poll in select p.id from public.polls p where p.status = 'open' and p.ends_at <= now() loop
    perform app_private.close_poll_internal(v_poll.id, null);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Rewards: Punkte für abgeschlossene Pläne
-- ---------------------------------------------------------------------------------------------
-- Schutz vor Missbrauch:
--   * nur für Pläne mit mindestens zwei zugesagten Personen,
--   * jede Aktion höchstens einmal (Unique-Index auf user_id/reason/related_entity_id),
--   * Tageslimit: 2x "organisiert", 3x "teilgenommen".
create function app_private.award_plan_rewards(p_plan_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.plans%rowtype;
  v_going integer;
  v_participant record;
  v_inserted integer;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id;
  if not found or v_plan.status <> 'completed' then
    return;
  end if;

  select count(*) into v_going from public.plan_participants pp
  where pp.plan_id = p_plan_id and pp.attendance_status = 'going';
  if v_going < 2 then
    return;
  end if;

  if v_plan.created_by is not null
     and exists (select 1 from public.crew_members m where m.crew_id = v_plan.crew_id and m.user_id = v_plan.created_by)
     and (select count(*) from public.reward_transactions t
          where t.user_id = v_plan.created_by and t.reason = 'plan_organized' and t.created_at > now() - interval '1 day') < 2
  then
    insert into public.reward_transactions (user_id, points_delta, reason, related_entity_id)
    values (v_plan.created_by, 30, 'plan_organized', p_plan_id)
    on conflict do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted > 0 then
      perform app_private.notify(v_plan.created_by, 'reward_earned', null, v_plan.crew_id, 'reward', p_plan_id,
                                 jsonb_build_object('points', 30, 'reason', 'plan_organized', 'title', v_plan.title),
                                 'reward:plan_organized:' || p_plan_id::text);
    end if;
  end if;

  for v_participant in
    select pp.user_id from public.plan_participants pp
    where pp.plan_id = p_plan_id and pp.attendance_status = 'going'
  loop
    if (select count(*) from public.reward_transactions t
        where t.user_id = v_participant.user_id and t.reason = 'plan_attended' and t.created_at > now() - interval '1 day') < 3
    then
      insert into public.reward_transactions (user_id, points_delta, reason, related_entity_id)
      values (v_participant.user_id, 10, 'plan_attended', p_plan_id)
      on conflict do nothing;
      get diagnostics v_inserted = row_count;
      if v_inserted > 0 then
        perform app_private.notify(v_participant.user_id, 'reward_earned', null, v_plan.crew_id, 'reward', p_plan_id,
                                   jsonb_build_object('points', 10, 'reason', 'plan_attended', 'title', v_plan.title),
                                   'reward:plan_attended:' || p_plan_id::text);
      end if;
    end if;
  end loop;
end $$;

-- Jede Punktebuchung wird zusätzlich im Audit-Log festgehalten.
create function app_private.audit_reward() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (actor_id, action, entity_type, entity_id, meta)
  values (auth.uid(), 'reward_transaction', 'reward', new.id,
          jsonb_build_object('user_id', new.user_id, 'points_delta', new.points_delta, 'reason', new.reason,
                             'related_entity_id', new.related_entity_id));
  return new;
end $$;
create trigger reward_transactions_audit after insert on public.reward_transactions
  for each row execute function app_private.audit_reward();
