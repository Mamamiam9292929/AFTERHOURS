-- P4 Etappe 1 · Web-Push: Benachrichtigungen kommen aufs Handy, auch wenn die App zu ist.
--
-- Ablauf:
--   1. Die App meldet ein Gerät an (save_push_subscription): Adresse beim Push-Dienst des Browsers
--      (Google, Apple, Mozilla, Microsoft) und die beiden öffentlichen Schlüssel, mit denen der Inhalt
--      Ende-zu-Ende verschlüsselt wird. Ein Gerät gehört immer der Person, die es zuletzt angemeldet hat.
--   2. Jede neue Benachrichtigung (public.notifications) legt je Gerät der Empfängerin einen Eintrag in
--      app_private.push_outbox an (Trigger). Abgeschaltete Benachrichtigungsgruppen entstehen gar nicht
--      erst (app_private.notify) – Push folgt damit denselben Einstellungen wie die App.
--   3. Die Edge Function `push` holt fällige Einträge (claim_push_batch, nur service_role), verschlüsselt
--      sie (RFC 8291) und schickt sie mit VAPID-Signatur (RFC 8292) an den Push-Dienst; das Ergebnis
--      meldet sie zurück (report_push_results). Abgemeldete Geräte (404/410) verschwinden.
--   4. Angestoßen wird die Function von der App: Nach einer eigenen Aktion ruft der Browser `push` auf
--      (push_kick prüft Anmeldung und Rate Limit). Optional zusätzlich jede Minute per pg_cron
--      (README Abschnitt 3).
--
-- Nichts davon verlässt die Datenbank unverschlüsselt: Der Push-Dienst sieht nur Geräteadresse,
-- Größe und Zeitpunkt. Eine gelesene oder gelöschte Benachrichtigung wird nicht mehr verschickt, eine
-- liegengebliebene nach einem Tag verworfen.

-- ---- Geräte -----------------------------------------------------------------------------------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Adresse beim Push-Dienst. Nur https; welche Dienste angeschrieben werden, entscheidet die Function.
  endpoint text not null unique check (
    char_length(endpoint) between 20 and 1000 and endpoint ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?/[!-~]*$'
  ),
  -- Öffentlicher Schlüssel des Geräts (P-256, 65 Byte) und Auth-Geheimnis (16 Byte), base64url.
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{86,88}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{21,24}$'),
  -- Für die Person: „Chrome auf Android“ – vom Browser erraten, nie etwas Genaueres.
  label text check (char_length(label) <= 60),
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count integer not null default 0 check (failure_count >= 0)
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id, created_at);
alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from public, anon, authenticated;
-- Die App liest nur die eigenen Geräte und nie die Schlüssel.
grant select (id, endpoint, label, created_at, last_success_at) on public.push_subscriptions to authenticated;
create policy push_subscriptions_select_own on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

-- ---- Warteschlange ----------------------------------------------------------------------------
create table app_private.push_outbox (
  id bigint generated always as identity primary key,
  notification_id uuid not null references public.notifications (id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions (id) on delete cascade,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  attempts integer not null default 0,
  unique (notification_id, subscription_id)
);
create index push_outbox_due_idx on app_private.push_outbox (id) where attempts < 3;
create index push_outbox_subscription_idx on app_private.push_outbox (subscription_id);
revoke all on table app_private.push_outbox from public, anon, authenticated;

create function app_private.queue_push() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into app_private.push_outbox (notification_id, subscription_id)
  select new.id, s.id from public.push_subscriptions s where s.user_id = new.user_id
  on conflict do nothing;
  return new;
end $$;
revoke all on function app_private.queue_push() from public, anon, authenticated;

create trigger notifications_queue_push after insert on public.notifications
  for each row execute function app_private.queue_push();

-- ---- Gerät an- und abmelden -------------------------------------------------------------------
create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_label text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_endpoint text := btrim(coalesce(p_endpoint, ''));
  v_p256dh text := btrim(coalesce(p_p256dh, ''));
  v_auth text := btrim(coalesce(p_auth, ''));
  v_label text := app_private.clean_line(regexp_replace(coalesce(p_label, ''), '[[:cntrl:]]', ' ', 'g'), 60);
  v_id uuid;
begin
  perform app_private.rate_limit('push_subscribe', 20, interval '1 hour');
  if char_length(v_endpoint) not between 20 and 1000 or v_endpoint !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?/[!-~]*$'
     or v_p256dh !~ '^[A-Za-z0-9_-]{86,88}$' or v_auth !~ '^[A-Za-z0-9_-]{21,24}$' then
    perform app_private.fail('invalid_push_subscription');
  end if;

  -- Dasselbe Gerät mit einer anderen Person: Es gehört ab jetzt der, die gerade angemeldet ist.
  -- Was für die vorige Person noch in der Warteschlange lag, geht nicht mehr an dieses Gerät.
  delete from public.push_subscriptions s where s.endpoint = v_endpoint and s.user_id <> v_uid;

  insert into public.push_subscriptions as s (user_id, endpoint, p256dh, auth, label)
  values (v_uid, v_endpoint, v_p256dh, v_auth, v_label)
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label, failure_count = 0
  returning s.id into v_id;

  -- Höchstens 10 Geräte je Person; das älteste fällt weg.
  delete from public.push_subscriptions s
  where s.user_id = v_uid and s.id in (
    select x.id from public.push_subscriptions x where x.user_id = v_uid
    order by x.created_at desc, x.id offset 10);
  return v_id;
end $$;

create function public.delete_push_subscription(p_endpoint text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
begin
  perform app_private.rate_limit('push_unsubscribe', 60, interval '1 hour');
  delete from public.push_subscriptions s where s.user_id = v_uid and s.endpoint = btrim(coalesce(p_endpoint, ''));
end $$;

-- ---- Versand (Edge Function) ------------------------------------------------------------------
-- Ob gerade etwas zu verschicken ist. Die App fragt das über die Function nach eigenen Aktionen –
-- mit Anmeldung und Rate Limit, damit niemand die Function im Kreis laufen lässt.
create function public.push_kick() returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_user();
  perform app_private.rate_limit('push_kick', 60, interval '10 minutes');
  return exists (
    select 1 from app_private.push_outbox o
    where o.attempts < 3 and o.created_at > now() - interval '1 day'
      and (o.claimed_at is null or o.claimed_at < now() - interval '2 minutes'));
end $$;

-- Holt bis zu p_limit fällige Nachrichten und merkt sie als in Arbeit vor (zwei Minuten, dann darf
-- ein anderer Lauf sie noch einmal versuchen; höchstens drei Versuche). Gelesene Benachrichtigungen
-- fallen weg, Liegengebliebenes nach einem Tag auch.
create function public.claim_push_batch(p_limit integer default 50) returns jsonb
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
      'unread', (select count(*) from public.notifications u where u.user_id = n.user_id and u.read_at is null))
  ) order by c.id), '[]'::jsonb)
  into v_result
  from claimed c
  join public.push_subscriptions s on s.id = c.subscription_id
  join public.notifications n on n.id = c.notification_id
  left join public.profiles a on a.id = n.actor_id;
  return v_result;
end $$;

-- Ergebnis des Versands: [{"id": <outbox>, "result": "sent" | "gone" | "retry"}].
-- sent: erledigt. gone: Gerät abgemeldet oder unbekannter Dienst – es wird entfernt.
-- retry: später noch einmal (bis zu drei Versuche je Nachricht); ein Gerät, das 20-mal hintereinander
-- scheitert, wird entfernt.
create function public.report_push_results(p_results jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_item jsonb;
  v_id bigint;
  v_sub uuid;
  v_count integer := 0;
begin
  if p_results is null or jsonb_typeof(p_results) <> 'array' or jsonb_array_length(p_results) > 500 then
    perform app_private.fail('invalid_push_results');
  end if;
  for v_item in select value from jsonb_array_elements(p_results) loop
    if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item -> 'id') <> 'number'
       or coalesce(v_item ->> 'result', '') not in ('sent', 'gone', 'retry') then
      continue;
    end if;
    v_id := (v_item ->> 'id')::bigint;
    select o.subscription_id into v_sub from app_private.push_outbox o where o.id = v_id;
    if v_sub is null then
      continue;
    end if;
    v_count := v_count + 1;
    if v_item ->> 'result' = 'sent' then
      delete from app_private.push_outbox o where o.id = v_id;
      update public.push_subscriptions s set last_success_at = now(), failure_count = 0 where s.id = v_sub;
    elsif v_item ->> 'result' = 'gone' then
      delete from public.push_subscriptions s where s.id = v_sub;
    else
      update public.push_subscriptions s set failure_count = s.failure_count + 1 where s.id = v_sub;
      delete from public.push_subscriptions s where s.id = v_sub and s.failure_count >= 20;
    end if;
  end loop;
  return v_count;
end $$;

revoke all on function public.save_push_subscription(text, text, text, text) from public, anon, authenticated;
revoke all on function public.delete_push_subscription(text) from public, anon, authenticated;
revoke all on function public.push_kick() from public, anon, authenticated;
revoke all on function public.claim_push_batch(integer) from public, anon, authenticated;
revoke all on function public.report_push_results(jsonb) from public, anon, authenticated;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.delete_push_subscription(text) to authenticated;
grant execute on function public.push_kick() to authenticated;
grant execute on function public.claim_push_batch(integer) to service_role;
grant execute on function public.report_push_results(jsonb) to service_role;

-- Optional für den Betrieb: jede Minute die Warteschlange leeren, auch wenn gerade niemand die App
-- benutzt (pg_cron + pg_net, Befehl im README Abschnitt 3).

-- ---- Datenexport ------------------------------------------------------------------------------
-- Wie bisher, dazu die eigenen Geräte für Push – ohne Adresse und Schlüssel.
create or replace function public.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
begin
  return jsonb_build_object(
    'exported_at', now(),
    'account', (select jsonb_build_object('id', u.id, 'email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at)
                from auth.users u where u.id = v_uid),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = v_uid),
    'settings', (select to_jsonb(s) from public.user_settings s where s.user_id = v_uid),
    'calendar_feed', (select jsonb_build_object('active', true, 'created_at', f.created_at, 'last_used_at', f.last_used_at)
                      from public.calendar_feeds f where f.user_id = v_uid),
    'push_devices', coalesce((select jsonb_agg(jsonb_build_object('label', d.label, 'created_at', d.created_at, 'last_success_at', d.last_success_at) order by d.created_at)
                              from public.push_subscriptions d where d.user_id = v_uid), '[]'::jsonb),
    'crews', coalesce((select jsonb_agg(jsonb_build_object('crew_id', c.id, 'name', c.name, 'role', m.role, 'joined_at', m.joined_at) order by m.joined_at)
                       from public.crew_members m join public.crews c on c.id = m.crew_id where m.user_id = v_uid), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('crew_id', cm.crew_id, 'body', cm.body, 'created_at', cm.created_at) order by cm.created_at)
                          from public.crew_messages cm where cm.user_id = v_uid), '[]'::jsonb),
    'polls_created', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'created_at', p.created_at) order by p.created_at)
                               from public.polls p where p.created_by = v_uid), '[]'::jsonb),
    'votes', coalesce((select jsonb_agg(jsonb_build_object('poll_id', v.poll_id, 'option', o.title, 'response', v.response, 'updated_at', v.updated_at) order by v.updated_at)
                       from public.poll_votes v join public.poll_options o on o.id = v.poll_option_id where v.user_id = v_uid), '[]'::jsonb),
    'plans', coalesce((select jsonb_agg(jsonb_build_object('plan_id', pl.id, 'title', pl.title, 'starts_at', pl.starts_at, 'attendance_status', pp.attendance_status,
                                                           'organizer', pl.created_by = v_uid) order by pl.starts_at)
                       from public.plan_participants pp join public.plans pl on pl.id = pp.plan_id where pp.user_id = v_uid), '[]'::jsonb),
    'plan_expenses', coalesce((select jsonb_agg(jsonb_build_object('plan_id', e.plan_id, 'kind', e.kind, 'description', e.description,
                                                                   'amount_cents', e.amount_cents, 'paid_by_me', e.paid_by = v_uid,
                                                                   'created_by_me', e.created_by = v_uid, 'created_at', e.created_at) order by e.created_at)
                               from public.plan_expenses e where e.paid_by = v_uid or e.created_by = v_uid), '[]'::jsonb),
    'plan_expense_shares', coalesce((select jsonb_agg(jsonb_build_object('plan_id', s.plan_id, 'kind', e.kind, 'description', e.description,
                                                                         'share_cents', s.amount_cents, 'created_at', e.created_at) order by e.created_at)
                                     from public.plan_expense_shares s join public.plan_expenses e on e.id = s.expense_id where s.user_id = v_uid), '[]'::jsonb),
    'spontaneous_asks', coalesce((select jsonb_agg(jsonb_build_object('crew_id', a.crew_id, 'note', a.note, 'created_at', a.created_at,
                                                                      'expires_at', a.expires_at, 'closed_at', a.closed_at) order by a.created_at)
                                  from public.spontaneous_asks a where a.created_by = v_uid), '[]'::jsonb),
    'spontaneous_answers', coalesce((select jsonb_agg(jsonb_build_object('crew_id', a.crew_id, 'answer', s.answer, 'answered_at', s.answered_at) order by s.answered_at)
                                     from public.spontaneous_answers s join public.spontaneous_asks a on a.id = s.ask_id where s.user_id = v_uid), '[]'::jsonb),
    'booking_requests', coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at) from public.booking_requests b where b.created_by = v_uid), '[]'::jsonb),
    'ride_offers', coalesce((select jsonb_agg(to_jsonb(o) order by o.created_at) from public.ride_offers o where o.driver_user_id = v_uid), '[]'::jsonb),
    'ride_requests', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at) from public.ride_requests r where r.passenger_user_id = v_uid), '[]'::jsonb),
    'reward_transactions', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from public.reward_transactions t where t.user_id = v_uid), '[]'::jsonb),
    'notifications', coalesce((select jsonb_agg(jsonb_build_object('type', n.type, 'payload', n.payload, 'created_at', n.created_at, 'read_at', n.read_at) order by n.created_at)
                               from public.notifications n where n.user_id = v_uid), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at) from public.reports r where r.reporter_id = v_uid), '[]'::jsonb)
  );
end $$;
