-- P4 Etappe 3 · Je Gerät wählen, was als Push ankommt.
--
-- Bisher bekam jedes Gerät mit Push alles, was in der App ankommt. Jetzt lässt sich je Gerät eine
-- Auswahl stummschalten: auf dem Handy nur das Wichtigste, auf dem Laptop alles. In der App (Liste,
-- Zähler) ändert sich dadurch nichts – stumm ist nur die Mitteilung auf diesem einen Gerät.
--
-- Gespeichert werden Benachrichtigungstypen (wie in user_settings.notification_preferences); die App
-- fasst sie zu denselben Gruppen zusammen wie in den Einstellungen.

alter table public.push_subscriptions
  add column muted_types text[] not null default '{}'
  check (cardinality(muted_types) <= 40 and array_to_string(muted_types, ',') ~ '^([a-z_]{1,40}(,[a-z_]{1,40})*)?$');

-- Die eigene Auswahl darf die App lesen (wie Adresse und Name, nie die Schlüssel).
grant select (muted_types) on public.push_subscriptions to authenticated;

-- Neue Benachrichtigung → Warteschlange je Gerät, außer das Gerät hat diese Art stummgeschaltet.
create or replace function app_private.queue_push() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into app_private.push_outbox (notification_id, subscription_id)
  select new.id, s.id from public.push_subscriptions s
  where s.user_id = new.user_id and not (new.type = any (s.muted_types))
  on conflict do nothing;
  return new;
end $$;
revoke all on function app_private.queue_push() from public, anon, authenticated;

-- Auswahl für ein eigenes Gerät setzen. Gibt die gespeicherte (bereinigte, sortierte) Liste zurück.
-- Was für dieses Gerät schon in der Warteschlange liegt und jetzt stumm ist, geht nicht mehr raus.
create function public.set_push_muted_types(p_endpoint text, p_muted_types text[]) returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_endpoint text := btrim(coalesce(p_endpoint, ''));
  v_types text[];
  v_id uuid;
begin
  perform app_private.rate_limit('push_muted_types', 60, interval '10 minutes');
  if p_muted_types is null or cardinality(p_muted_types) > 40
     or exists (select 1 from unnest(p_muted_types) t where t is null or t !~ '^[a-z_]{1,40}$') then
    perform app_private.fail('invalid_push_muted_types');
  end if;
  select coalesce(array_agg(distinct t order by t), '{}') into v_types from unnest(p_muted_types) t;

  update public.push_subscriptions s set muted_types = v_types
  where s.user_id = v_uid and s.endpoint = v_endpoint
  returning s.id into v_id;
  if v_id is null then
    perform app_private.fail('push_device_not_found');
  end if;

  delete from app_private.push_outbox o
  using public.notifications n
  where o.subscription_id = v_id and n.id = o.notification_id and n.type = any (v_types);
  return v_types;
end $$;

revoke all on function public.set_push_muted_types(text, text[]) from public, anon, authenticated;
grant execute on function public.set_push_muted_types(text, text[]) to authenticated;

-- ---- Datenexport ------------------------------------------------------------------------------
-- Wie bisher, je Gerät dazu die stummgeschalteten Arten.
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
    'push_devices', coalesce((select jsonb_agg(jsonb_build_object('label', d.label, 'created_at', d.created_at, 'last_success_at', d.last_success_at, 'muted_types', d.muted_types) order by d.created_at)
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
