-- P49 · Nachtruhe fürs Handy
-- Push-Mitteilungen kommen, sobald irgendwer in der Crew etwas tut – auch um 1:30, wenn die halbe Crew noch unterwegs
-- ist. Bisher half nur „Crew stummschalten“ (P35) oder Arten je Gerät abschalten (P4 Etappe 3); beides gilt rund um die
-- Uhr. Jetzt wählt jede Person ein festes Zeitfenster (z. B. 23–8 Uhr, Berliner Zeit), in dem ihr Handy still bleibt.
--
-- Bewusst so gebaut:
--   * Still ist nur der Push. In der App (Liste der Benachrichtigungen, Zähler) kommt weiter alles an – morgens liegt
--     es dort. Die App sagt das so.
--   * Gilt für die Person, also alle Geräte und alle Crews. Standard: aus (niemand bekommt ungefragt weniger).
--   * Ganze Stunden, Berliner Zeit (wie die ganze App). Von = Bis ist kein Fenster und wird abgelehnt.
--   * Was in der Nachtruhe entsteht, kommt nicht in die Warteschlange (`queue_push`). Was schon wartete, als die
--     Nachtruhe begann, geht ebenfalls nicht mehr raus (`claim_push_batch`) – sonst brummt es um 23:20 für etwas
--     von 22:55, nur weil gerade erst jemand die App geöffnet hat.
--   * Nicht nachgeholt: Morgens kommt kein Schwall alter Mitteilungen. Das steht so in der App.
--   * Spalten in `user_settings` → Datenexport (`settings`) und Kontolöschung (Kaskade) wie bisher, ohne neue Tabelle.
--     Lesbar wie der Rest der eigenen Einstellungen, geändert nur über `set_push_quiet_hours`.

alter table public.user_settings
  add column push_quiet_from smallint check (push_quiet_from between 0 and 23),
  add column push_quiet_to smallint check (push_quiet_to between 0 and 23),
  add constraint user_settings_push_quiet_pair check (
    (push_quiet_from is null and push_quiet_to is null)
    or (push_quiet_from is not null and push_quiet_to is not null and push_quiet_from <> push_quiet_to)
  );
comment on column public.user_settings.push_quiet_from is 'P49: Nachtruhe ab (volle Stunde, Europe/Berlin); null = keine Nachtruhe';
comment on column public.user_settings.push_quiet_to is 'P49: Nachtruhe bis (volle Stunde, Europe/Berlin, ausschließlich); null = keine Nachtruhe';

-- Liegt der Zeitpunkt in der Nachtruhe? Fenster über Mitternacht (23–8) wie am Tag (13–15). Berliner Ortszeit,
-- also auch über die Zeitumstellung richtig.
create function app_private.in_quiet_hours(p_from smallint, p_to smallint, p_at timestamptz) returns boolean
language sql stable set search_path = '' as $$
  select case
    when p_from is null or p_to is null or p_from = p_to then false
    when p_from < p_to then extract(hour from p_at at time zone 'Europe/Berlin') >= p_from
                        and extract(hour from p_at at time zone 'Europe/Berlin') < p_to
    else extract(hour from p_at at time zone 'Europe/Berlin') >= p_from
      or extract(hour from p_at at time zone 'Europe/Berlin') < p_to
  end $$;
revoke all on function app_private.in_quiet_hours(smallint, smallint, timestamptz) from public, anon, authenticated;

-- Hat die Person gerade Nachtruhe?
create function app_private.push_quiet_now(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select app_private.in_quiet_hours(s.push_quiet_from, s.push_quiet_to, now())
                   from public.user_settings s where s.user_id = p_user), false) $$;
revoke all on function app_private.push_quiet_now(uuid) from public, anon, authenticated;

-- Stellt die eigene Nachtruhe ein: beide null = aus, sonst volle Stunden 0–23, Von ≠ Bis.
-- Liefert den Stand: {from, to} (beide null = aus).
create function public.set_push_quiet_hours(p_from integer, p_to integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
begin
  perform app_private.rate_limit('push_quiet_hours', 30, interval '10 minutes');
  if (p_from is null) <> (p_to is null)
     or (p_from is not null and (p_from not between 0 and 23 or p_to not between 0 and 23 or p_from = p_to)) then
    perform app_private.fail('invalid_quiet_hours');
  end if;

  insert into public.user_settings (user_id, push_quiet_from, push_quiet_to, updated_at)
  values (v_uid, p_from, p_to, now())
  on conflict (user_id) do update
    set push_quiet_from = excluded.push_quiet_from, push_quiet_to = excluded.push_quiet_to, updated_at = now();

  -- Beginnt die Nachtruhe gerade jetzt, bleibt auch Wartendes still.
  if app_private.push_quiet_now(v_uid) then
    delete from app_private.push_outbox o
    using public.push_subscriptions s
    where s.id = o.subscription_id and s.user_id = v_uid;
  end if;

  return jsonb_build_object('from', p_from, 'to', p_to);
end $$;

revoke all on function public.set_push_quiet_hours(integer, integer) from public, anon, authenticated;
grant execute on function public.set_push_quiet_hours(integer, integer) to authenticated;
comment on function public.set_push_quiet_hours(integer, integer) is 'P49: Nachtruhe fürs Handy – volle Stunden (Europe/Berlin), beide null = aus.';

-- Neue Benachrichtigung → Warteschlange je Gerät. Wie bisher (Stand P35), dazu: nicht in der Nachtruhe (P49).
create or replace function app_private.queue_push() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.crew_id is not null and exists (
    select 1 from public.crew_push_mutes m
    where m.crew_id = new.crew_id and m.user_id = new.user_id and (m.muted_until is null or m.muted_until > now())
  ) then
    return new;
  end if;
  if app_private.push_quiet_now(new.user_id) then
    return new;
  end if;
  insert into app_private.push_outbox (notification_id, subscription_id)
  select new.id, s.id from public.push_subscriptions s
  where s.user_id = new.user_id and not (new.type = any (s.muted_types))
  on conflict do nothing;
  return new;
end $$;
revoke all on function app_private.queue_push() from public, anon, authenticated;

-- ---- Push: wie bisher (Stand P11 Etappe 2a), dazu fällt weg, was in die Nachtruhe geraten ist ------------
create or replace function public.claim_push_batch(p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_result jsonb;
begin
  delete from app_private.push_outbox o
  where o.created_at < now() - interval '1 day'
     or (o.attempts >= 3 and o.claimed_at < now() - interval '2 minutes')
     or exists (select 1 from public.notifications n where n.id = o.notification_id and n.read_at is not null)
     -- P49: Wer inzwischen Nachtruhe hat, bekommt Wartendes nicht mehr.
     or exists (select 1 from public.push_subscriptions s join public.user_settings us on us.user_id = s.user_id
                where s.id = o.subscription_id and app_private.in_quiet_hours(us.push_quiet_from, us.push_quiet_to, now()));

  with due as (
    select o.id from app_private.push_outbox o
    where o.attempts < 3 and (o.claimed_at is null or o.claimed_at < now() - interval '2 minutes')
    order by o.id
    limit v_limit
    for update of o skip locked
  ), claimed as (
    update app_private.push_outbox o set claimed_at = now(), attempts = o.attempts + 1
    from due where o.id = due.id
    returning o.id, o.notification_id, o.subscription_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'endpoint', s.endpoint,
    'p256dh', s.p256dh,
    'auth', s.auth,
    -- Spontanes („Heute noch wer?“) eilt; alles andere darf der Push-Dienst bündeln.
    'urgency', case when n.type like 'spontaneous%' then 'high' else 'normal' end,
    'message', jsonb_build_object(
      'v', 1,
      'id', n.id,
      'type', n.type,
      'actor', a.display_name,
      'crew_id', n.crew_id,
      'entity_type', n.entity_type,
      'entity_id', n.related_entity_id,
      -- Ein Push trägt höchstens 4 KB. Sehr große Inhalte kommen ohne Einzelheiten an.
      'payload', case when octet_length(n.payload::text) > 2500 then '{}'::jsonb else n.payload end,
      'at', n.created_at,
      'unread', (select count(*) from public.notifications u where u.user_id = n.user_id and u.read_at is null),
      -- P11 Etappe 2a: Sprache im Profil – der Service Worker kennt die Wahl in der App nicht.
      'locale', (select us.locale from public.user_settings us where us.user_id = n.user_id))
  ) order by c.id), '[]'::jsonb)
  into v_result
  from claimed c
  join public.push_subscriptions s on s.id = c.subscription_id
  join public.notifications n on n.id = c.notification_id
  left join public.profiles a on a.id = n.actor_id;
  return v_result;
end $$;
revoke all on function public.claim_push_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_push_batch(integer) to service_role;
