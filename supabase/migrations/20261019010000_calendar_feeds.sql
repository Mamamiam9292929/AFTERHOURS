-- P2 Etappe 2 · Kalender-Abo
-- Jede Person kann einen persönlichen Abo-Link anlegen (/c/<token>.ics). Kalender-Apps (Apple, Google,
-- Outlook …) rufen ihn regelmäßig ab; neue Pläne, Änderungen und Absagen kommen so von selbst an.
--
-- Was der Link zeigt: die Pläne der Crews, in denen die Person gerade Mitglied ist – ab 60 Tagen in der
-- Vergangenheit, höchstens 300 –, ohne die, bei denen sie abgesagt hat. Je Plan nur, was auch die
-- Kalenderdatei (P2 Etappe 1) enthält, plus Crew-Name und die eigene Antwort: Titel, Beginn, Ende,
-- Adresse, Treffpunkt, Status. Keine Namen anderer Mitglieder, keine Notizen, keine Kosten, keine E-Mails.
--
-- Der Token (64 Hex-Zeichen, 244 Bit Zufall wie bei Einladungen) liegt im Klartext, damit die Person ihren Link in den Einstellungen wieder
-- ansehen kann (zweites Gerät, zweiter Kalender) – in einer Tabelle ohne jede API-Berechtigung. Er
-- öffnet nur Daten, die in derselben Datenbank liegen; wer die Tabelle lesen könnte, läse auch die Pläne.
-- Ein neuer Link ersetzt den alten sofort; „Abo beenden“ löscht ihn.

create table public.calendar_feeds (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  token text not null unique check (token ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.calendar_feeds enable row level security;
revoke all on table public.calendar_feeds from public, anon, authenticated;

create function app_private.calendar_feed_json(p_user_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('token', f.token, 'created_at', f.created_at, 'last_used_at', f.last_used_at)
  from public.calendar_feeds f where f.user_id = p_user_id;
$$;

-- Eigener Abo-Link oder null, wenn keiner angelegt ist.
create function public.my_calendar_feed() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
begin
  return app_private.calendar_feed_json(v_uid);
end $$;

-- Legt den Abo-Link an oder ersetzt ihn durch einen neuen (der alte funktioniert danach nicht mehr).
create function public.renew_calendar_feed() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_renewed boolean;
begin
  perform app_private.rate_limit('calendar_feed_renew', 10, interval '1 hour');
  v_renewed := exists (select 1 from public.calendar_feeds f where f.user_id = v_uid);

  insert into public.calendar_feeds as f (user_id, token)
  values (v_uid, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  on conflict (user_id) do update
    set token = excluded.token, created_at = now(), last_used_at = null;

  perform app_private.audit(case when v_renewed then 'calendar_feed_renewed' else 'calendar_feed_created' end, 'user', v_uid);
  return app_private.calendar_feed_json(v_uid);
end $$;

-- Beendet das Abo: Der Link liefert danach nichts mehr.
create function public.revoke_calendar_feed() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
begin
  delete from public.calendar_feeds f where f.user_id = v_uid;
  if found then
    perform app_private.audit('calendar_feed_revoked', 'user', v_uid);
  end if;
end $$;

-- Die Termine zum Link. Aufrufbar ohne Konto: Kalender-Apps melden sich nicht an.
create function public.calendar_feed_events(p_token text) returns jsonb
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

revoke all on function app_private.calendar_feed_json(uuid) from public, anon, authenticated;
revoke all on function public.my_calendar_feed() from public, anon, authenticated;
revoke all on function public.renew_calendar_feed() from public, anon, authenticated;
revoke all on function public.revoke_calendar_feed() from public, anon, authenticated;
revoke all on function public.calendar_feed_events(text) from public, anon, authenticated;
grant execute on function public.my_calendar_feed() to authenticated, service_role;
grant execute on function public.renew_calendar_feed() to authenticated, service_role;
grant execute on function public.revoke_calendar_feed() to authenticated, service_role;
grant execute on function public.calendar_feed_events(text) to anon, authenticated, service_role;

-- Datenexport (Art. 15/20 DSGVO) um das Kalender-Abo ergänzt (ohne den Link selbst). Sonst unverändert.
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
    'booking_requests', coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at) from public.booking_requests b where b.created_by = v_uid), '[]'::jsonb),
    'ride_offers', coalesce((select jsonb_agg(to_jsonb(o) order by o.created_at) from public.ride_offers o where o.driver_user_id = v_uid), '[]'::jsonb),
    'ride_requests', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at) from public.ride_requests r where r.passenger_user_id = v_uid), '[]'::jsonb),
    'reward_transactions', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from public.reward_transactions t where t.user_id = v_uid), '[]'::jsonb),
    'notifications', coalesce((select jsonb_agg(jsonb_build_object('type', n.type, 'payload', n.payload, 'created_at', n.created_at, 'read_at', n.read_at) order by n.created_at)
                               from public.notifications n where n.user_id = v_uid), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at) from public.reports r where r.reporter_id = v_uid), '[]'::jsonb)
  );
end $$;
