-- P21 · „Bin weg“ – Abwesenheiten bei der Terminsuche (Etappe 1)
-- Wer verreist ist, trägt einen Zeitraum ein („vom 10. bis 20. November weg“) – nur Tage, ohne Grund und
-- ohne Ort. Sichtbar ist er nur für Mitglieder der eigenen Crews, und nur, solange er nicht vorbei ist
-- (`crew_absences`). In „Wann könnt ihr?“ steht unter jedem Termin, wer da weg ist (rechnet die App).
-- Vergangene Zeiträume liest niemand mehr; `add_my_absence` räumt die eigenen beim Eintragen weg. Mit dem
-- Konto ist alles weg (Kaskade über `profiles`). Im Datenexport enthalten.

create table public.absences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  created_at timestamptz not null default now(),
  constraint absences_range check (ends_on >= starts_on and ends_on - starts_on <= 365)
);
create index absences_user_idx on public.absences (user_id, ends_on);

alter table public.absences enable row level security;
revoke all on table public.absences from public, anon, authenticated;

-- Trägt einen Zeitraum ein (beide Tage eingeschlossen). Nicht in der Vergangenheit, höchstens ein Jahr lang,
-- Beginn höchstens zwei Jahre voraus, höchstens 20 laufende oder kommende je Person. Liefert die ID.
create function public.add_my_absence(p_starts_on date, p_ends_on date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_id uuid;
begin
  perform app_private.rate_limit('add_my_absence', 30, interval '1 hour');

  if p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on or p_ends_on < v_today
     or p_ends_on - p_starts_on > 365 or p_starts_on > v_today + 730 then
    perform app_private.fail('invalid_absence');
  end if;

  delete from public.absences a where a.user_id = v_uid and a.ends_on < v_today;
  if (select count(*) from public.absences a where a.user_id = v_uid) >= 20 then
    perform app_private.fail('too_many_absences');
  end if;

  insert into public.absences (user_id, starts_on, ends_on) values (v_uid, greatest(p_starts_on, v_today), p_ends_on)
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.add_my_absence(date, date) from public, anon, authenticated;
grant execute on function public.add_my_absence(date, date) to authenticated, service_role;

-- Entfernt einen eigenen Zeitraum. Fremde oder unbekannte IDs ändern nichts (und verraten nichts).
create function public.remove_my_absence(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
begin
  perform app_private.rate_limit('remove_my_absence', 60, interval '1 hour');
  delete from public.absences a where a.id = p_id and a.user_id = v_uid;
end $$;

revoke all on function public.remove_my_absence(uuid) from public, anon, authenticated;
grant execute on function public.remove_my_absence(uuid) to authenticated, service_role;

-- Die eigenen laufenden und kommenden Zeiträume.
create function public.my_absences() returns table (id uuid, starts_on date, ends_on date)
language sql stable security definer set search_path = '' as $$
  select a.id, a.starts_on, a.ends_on from public.absences a
  where a.user_id = auth.uid() and a.ends_on >= (now() at time zone 'Europe/Berlin')::date
  order by a.starts_on, a.ends_on, a.id
$$;

revoke all on function public.my_absences() from public, anon, authenticated;
grant execute on function public.my_absences() to authenticated, service_role;

-- Laufende und kommende Zeiträume der Mitglieder einer Crew (nur für Mitglieder dieser Crew). Nur Person
-- und Tage – keine IDs, kein Zeitpunkt des Eintrags.
create function public.crew_absences(p_crew_id uuid) returns table (user_id uuid, starts_on date, ends_on date)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_user();
  if not app_private.is_crew_member(p_crew_id) then
    perform app_private.forbid();
  end if;
  return query
    select a.user_id, a.starts_on, a.ends_on
    from public.crew_members m
    join public.absences a on a.user_id = m.user_id
    where m.crew_id = p_crew_id and a.ends_on >= (now() at time zone 'Europe/Berlin')::date
    order by a.starts_on, a.ends_on, a.user_id;
end $$;

revoke all on function public.crew_absences(uuid) from public, anon, authenticated;
grant execute on function public.crew_absences(uuid) to authenticated, service_role;

-- ---- Datenexport ------------------------------------------------------------------------------
-- Wie bisher (Stand P20), dazu die Abwesenheiten.
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
    'birthday', (select jsonb_build_object('month', b.month, 'day', b.day, 'updated_at', b.updated_at)
                 from public.birthdays b where b.user_id = v_uid),
    'absences', coalesce((select jsonb_agg(jsonb_build_object('starts_on', a.starts_on, 'ends_on', a.ends_on, 'created_at', a.created_at) order by a.starts_on)
                          from public.absences a where a.user_id = v_uid), '[]'::jsonb),
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
    'plan_live_locations', coalesce((select jsonb_agg(jsonb_build_object('plan_id', l.plan_id, 'latitude', l.latitude, 'longitude', l.longitude,
                                                                         'accuracy_m', l.accuracy_m, 'started_at', l.started_at, 'updated_at', l.updated_at,
                                                                         'expires_at', l.expires_at, 'arrival_eta', l.arrival_eta) order by l.started_at)
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
