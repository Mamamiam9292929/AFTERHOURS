-- P13 Etappe 1 · Live-Standort nur während eines Plans
-- „Wo seid ihr?“: Wer zu einem Plan zugesagt (oder „vielleicht“) hat, kann rund um den Abend seinen
-- Standort mit den anderen teilen, die ebenfalls kommen – um sich am Treffpunkt zu finden, ohne
-- Dauertracking.
--
-- Regeln
--   - Nur auf ausdrücklichen Tipp („Standort teilen“) und nur für genau einen Plan. Die Einstellung
--     „Standortfreigabe“ bleibt davon unberührt (Standard: aus).
--   - Zeitfenster: ab 2 Stunden vor Beginn bis zum Ende (ohne Ende: 4 Stunden nach Beginn). Nicht bei
--     abgesagten oder abgeschlossenen Plänen.
--   - Eine Freigabe gilt höchstens 3 Stunden und nie über das Fenster hinaus. Aktualisieren verlängert sie
--     nicht – danach muss man neu tippen.
--   - Gespeichert wird nur die letzte Position, auf 4 Nachkommastellen gerundet (rund 10 m), dazu die
--     Genauigkeit des Geräts. Kein Verlauf.
--   - Sehen dürfen nur Mitglieder der Crew, die selbst zugesagt oder „vielleicht“ gesagt haben.
--   - Gelöscht wird beim Beenden, beim Ablauf (nächster Aufruf irgendeiner Person oder pg_cron), bei
--     Absage/Abschluss/Verschieben des Plans, bei geänderter Antwort, beim Verlassen der Crew und mit dem
--     Konto. Lesen filtert Abgelaufenes zusätzlich über RLS weg.

create table public.plan_live_locations (
  plan_id uuid not null references public.plans (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m integer check (accuracy_m is null or accuracy_m between 0 and 100000),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (plan_id, user_id),
  check (expires_at > started_at)
);
create index plan_live_locations_user_idx on public.plan_live_locations (user_id);
create index plan_live_locations_expires_idx on public.plan_live_locations (expires_at);

-- ---- Regeln als Funktionen --------------------------------------------------------------------
-- Zeitfenster eines Plans: [Beginn − 2 h, Ende bzw. Beginn + 4 h).
create function app_private.plan_live_window(p_plan public.plans) returns tstzrange
language sql immutable set search_path = '' as $$
  select tstzrange(p_plan.starts_at - interval '2 hours', coalesce(p_plan.ends_at, p_plan.starts_at + interval '4 hours'), '[)');
$$;

-- Darf die anfragende Person beim Plan mitmachen (teilen und sehen)? Crew-Mitglied, Antwort „dabei“ oder
-- „vielleicht“, Plan weder abgesagt noch abgeschlossen. Das Zeitfenster prüft die RPC bzw. expires_at.
create function app_private.can_use_plan_live(p_plan_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.plans p
    join public.crew_members m on m.crew_id = p.crew_id and m.user_id = (select auth.uid())
    join public.plan_participants pp on pp.plan_id = p.id and pp.user_id = m.user_id
    where p.id = p_plan_id
      and p.status not in ('cancelled', 'completed')
      and pp.attendance_status in ('going', 'maybe')
  );
$$;

alter table public.plan_live_locations enable row level security;
revoke all on table public.plan_live_locations from public, anon, authenticated;
grant select on table public.plan_live_locations to authenticated;

create policy plan_live_locations_select on public.plan_live_locations for select to authenticated
  using (expires_at > now() and app_private.can_use_plan_live(plan_id));

-- Neue Positionen erscheinen bei den anderen ohne Neuladen (RLS gilt auch für Realtime).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.plan_live_locations;
  end if;
end $$;

-- Abgelaufenes löschen (auch für pg_cron, README Abschnitt 3).
create function app_private.purge_plan_live_locations() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  delete from public.plan_live_locations l where l.expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---- RPCs -------------------------------------------------------------------------------------
-- Standort teilen bzw. aktualisieren. Liefert, bis wann die Freigabe gilt. Beim ersten Aufruf (oder nach
-- Ablauf) beginnt eine neue Freigabe; danach wird nur die Position ersetzt – die Frist bleibt.
create function public.share_plan_live_location(p_plan_id uuid, p_latitude double precision, p_longitude double precision, p_accuracy_m double precision default null)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
  v_window tstzrange;
  v_now timestamptz := now();
  v_expires timestamptz;
  v_lat double precision;
  v_lng double precision;
  v_acc integer;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id;
  if not found or not app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.forbid();
  end if;
  if v_plan.status in ('cancelled', 'completed') then
    perform app_private.fail('plan_locked');
  end if;
  if not app_private.can_use_plan_live(p_plan_id) then
    perform app_private.fail('live_location_not_going');
  end if;
  v_window := app_private.plan_live_window(v_plan);
  if not (v_now <@ v_window) then
    perform app_private.fail('live_location_outside_window');
  end if;
  if p_latitude is null or p_longitude is null
     or p_latitude = 'NaN'::double precision or p_longitude = 'NaN'::double precision
     or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    perform app_private.fail('invalid_location');
  end if;
  perform app_private.rate_limit('plan_live_location', 240, interval '1 hour');

  v_lat := round(p_latitude::numeric, 4)::double precision;
  v_lng := round(p_longitude::numeric, 4)::double precision;
  v_acc := case
             when p_accuracy_m is null or p_accuracy_m = 'NaN'::double precision or p_accuracy_m < 0 then null
             else least(round(p_accuracy_m), 100000)::integer
           end;
  v_expires := least(upper(v_window), v_now + interval '3 hours');

  perform app_private.purge_plan_live_locations();
  insert into public.plan_live_locations as l (plan_id, user_id, latitude, longitude, accuracy_m, started_at, updated_at, expires_at)
  values (p_plan_id, v_uid, v_lat, v_lng, v_acc, v_now, v_now, v_expires)
  on conflict (plan_id, user_id) do update
    set latitude = excluded.latitude, longitude = excluded.longitude, accuracy_m = excluded.accuracy_m, updated_at = v_now
  returning l.expires_at into v_expires;
  return v_expires;
end $$;

-- Nicht mehr teilen: die eigene Position ist sofort weg. Geht immer, auch nach Ablauf.
create function public.stop_plan_live_location(p_plan_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
begin
  delete from public.plan_live_locations l where l.plan_id = p_plan_id and l.user_id = v_uid;
  perform app_private.purge_plan_live_locations();
end $$;

-- ---- Aufräumen bei Änderungen ------------------------------------------------------------------
-- Antwort geändert („nicht dabei“) oder Teilnahme entfernt: eigene Position weg.
create function app_private.drop_live_location_on_attendance() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' or new.attendance_status not in ('going', 'maybe') then
    delete from public.plan_live_locations l where l.plan_id = old.plan_id and l.user_id = old.user_id;
  end if;
  return null;
end $$;
create trigger plan_participants_drop_live_location after update of attendance_status or delete on public.plan_participants
  for each row execute function app_private.drop_live_location_on_attendance();

-- Plan abgesagt, abgeschlossen oder verschoben: alle Positionen weg (verschoben = neues Fenster, neu tippen).
create function app_private.drop_live_locations_on_plan_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('cancelled', 'completed') or new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at then
    delete from public.plan_live_locations l where l.plan_id = new.id;
  end if;
  return null;
end $$;
create trigger plans_drop_live_locations after update of status, starts_at, ends_at on public.plans
  for each row execute function app_private.drop_live_locations_on_plan_change();

-- Crew verlassen (freiwillig, entfernt, Kontolöschung): Positionen bei Plänen dieser Crew weg.
create function app_private.drop_live_locations_on_leave() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.plan_live_locations l
  using public.plans p
  where l.plan_id = p.id and p.crew_id = old.crew_id and l.user_id = old.user_id;
  return null;
end $$;
create trigger crew_members_drop_live_locations after delete on public.crew_members
  for each row execute function app_private.drop_live_locations_on_leave();

revoke all on function app_private.plan_live_window(public.plans) from public, anon, authenticated;
revoke all on function app_private.can_use_plan_live(uuid) from public, anon;
grant execute on function app_private.can_use_plan_live(uuid) to authenticated, service_role;
revoke all on function app_private.purge_plan_live_locations() from public, anon, authenticated;
grant execute on function app_private.purge_plan_live_locations() to service_role;
revoke all on function app_private.drop_live_location_on_attendance() from public, anon, authenticated;
revoke all on function app_private.drop_live_locations_on_plan_change() from public, anon, authenticated;
revoke all on function app_private.drop_live_locations_on_leave() from public, anon, authenticated;
revoke all on function public.share_plan_live_location(uuid, double precision, double precision, double precision) from public, anon, authenticated;
revoke all on function public.stop_plan_live_location(uuid) from public, anon, authenticated;
grant execute on function public.share_plan_live_location(uuid, double precision, double precision, double precision) to authenticated, service_role;
grant execute on function public.stop_plan_live_location(uuid) to authenticated, service_role;

-- ---- Datenexport ------------------------------------------------------------------------------
-- Wie bisher (Stand P10), dazu eine laufende Standortfreigabe.
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
    'plan_items', coalesce((select jsonb_agg(jsonb_build_object('plan_id', i.plan_id, 'label', i.label, 'created_by_me', i.created_by = v_uid,
                                                                'bringing', i.claimed_by = v_uid, 'created_at', i.created_at) order by i.created_at)
                            from public.plan_items i where i.created_by = v_uid or i.claimed_by = v_uid), '[]'::jsonb),
    -- P13: eine laufende Freigabe (es gibt keinen Verlauf; Abgelaufenes ist gelöscht).
    'plan_live_locations', coalesce((select jsonb_agg(jsonb_build_object('plan_id', l.plan_id, 'latitude', l.latitude, 'longitude', l.longitude,
                                                                         'accuracy_m', l.accuracy_m, 'started_at', l.started_at, 'updated_at', l.updated_at,
                                                                         'expires_at', l.expires_at) order by l.started_at)
                                     from public.plan_live_locations l where l.user_id = v_uid), '[]'::jsonb),
    'plan_photos', coalesce((select jsonb_agg(jsonb_build_object('plan_id', ph.plan_id, 'path', ph.path, 'width', ph.width, 'height', ph.height,
                                                                 'uploaded_at', ph.uploaded_at) order by ph.created_at)
                             from public.plan_photos ph where ph.uploaded_by = v_uid and ph.uploaded_at is not null), '[]'::jsonb),
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
