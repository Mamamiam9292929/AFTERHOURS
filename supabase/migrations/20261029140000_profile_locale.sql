-- P11 Etappe 2a · Sprache im Profil.
--
-- Bisher galt die Sprache nur auf dem Gerät (localStorage). Was der Server ohne die App erzeugt –
-- Kalender-Abo, Push-Mitteilungen –, war deshalb immer deutsch. Jetzt merkt sich das Konto die Sprache:
--   * die App speichert sie beim Wechsel in den Einstellungen (set_my_locale) und einmalig beim ersten
--     Start nach dem Update (dann die Sprache, die das Gerät gerade zeigt),
--   * ein neues Gerät ohne eigene Wahl übernimmt sie,
--   * Kalender-Abo (calendar_feed_events) und Push (claim_push_batch) liefern sie mit.
-- null heißt „noch nie gesetzt“ und wird überall wie Deutsch behandelt.

alter table public.user_settings
  add column locale text check (locale is null or locale in ('de', 'en'));
-- Lesbar wie der Rest der eigenen Einstellungen (select ist für die ganze Tabelle vergeben), geändert wird
-- nur über die RPC: Für die neue Spalte gibt es bewusst kein update-Recht.

create function public.set_my_locale(p_locale text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
begin
  perform app_private.rate_limit('set_locale', 30, interval '10 minutes');
  if p_locale is null or p_locale not in ('de', 'en') then
    perform app_private.fail('invalid_locale');
  end if;
  insert into public.user_settings (user_id, locale) values (v_uid, p_locale)
  on conflict (user_id) do update set locale = excluded.locale
  where public.user_settings.locale is distinct from excluded.locale;
  return p_locale;
end $$;

revoke all on function public.set_my_locale(text) from public, anon, authenticated;
grant execute on function public.set_my_locale(text) to authenticated;

-- ---- Kalender-Abo: wie bisher, dazu die Sprache --------------------------------------------------
create or replace function public.calendar_feed_events(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_feed public.calendar_feeds;
begin
  -- Alles, was kein Token sein kann, wird gar nicht erst gesucht (und schreibt nichts).
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'not_found');
  end if;

  select f.* into v_feed from public.calendar_feeds f where f.token = p_token;
  if v_feed.user_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Kalender fragen alle paar Minuten bis Stunden; mehr als 60 Abrufe in 10 Minuten sind kein Kalender.
  perform app_private.rate_limit_key(p_token, 'calendar_feed', 60, interval '10 minutes');

  -- „Zuletzt abgerufen“ höchstens einmal je Viertelstunde schreiben.
  if v_feed.last_used_at is null or v_feed.last_used_at < now() - interval '15 minutes' then
    update public.calendar_feeds f set last_used_at = now() where f.user_id = v_feed.user_id;
  end if;

  return jsonb_build_object(
    'status', 'valid',
    -- P11 Etappe 2a: Sprache im Profil der Person, der das Abo gehört (null → Deutsch).
    'locale', (select s.locale from public.user_settings s where s.user_id = v_feed.user_id),
    'events', coalesce((
      select jsonb_agg(e.event order by e.starts_at, e.id)
      from (
        select p.id, p.starts_at,
               jsonb_build_object(
                 'id', p.id,
                 'title', p.title,
                 'starts_at', p.starts_at,
                 'ends_at', p.ends_at,
                 'address', p.address,
                 'meeting_point', p.meeting_point,
                 'status', p.status,
                 'attendance', coalesce(pp.attendance_status::text, 'invited'),
                 'crew', c.name,
                 'created_at', p.created_at,
                 'updated_at', p.updated_at) as event
        from public.plans p
        join public.crews c on c.id = p.crew_id
        join public.crew_members m on m.crew_id = p.crew_id and m.user_id = v_feed.user_id
        left join public.plan_participants pp on pp.plan_id = p.id and pp.user_id = v_feed.user_id
        where coalesce(p.ends_at, p.starts_at) >= now() - interval '60 days'
          and pp.attendance_status is distinct from 'declined'
        order by p.starts_at
        limit 300
      ) e), '[]'::jsonb));
end $$;

-- ---- Push: wie bisher, jede Nachricht trägt die Sprache --------------------------------------------
create or replace function public.claim_push_batch(p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_result jsonb;
begin
  delete from app_private.push_outbox o
  where o.created_at < now() - interval '1 day'
     or (o.attempts >= 3 and o.claimed_at < now() - interval '2 minutes')
     or exists (select 1 from public.notifications n where n.id = o.notification_id and n.read_at is not null);

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

-- Rechte bleiben wie in den ursprünglichen Migrationen; zur Sicherheit noch einmal ausdrücklich.
revoke all on function public.calendar_feed_events(text) from public, anon, authenticated;
grant execute on function public.calendar_feed_events(text) to anon, authenticated, service_role;
revoke all on function public.claim_push_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_push_batch(integer) to service_role;
