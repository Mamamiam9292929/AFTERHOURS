-- P43 · „Seid ihr schon da?“ – am Abend selbst mit einem Tipp „Bin da“ oder „Bin in 20 Min. da“, ohne Standort
-- Am Abend selbst ist die häufigste Nachricht im Gruppenchat „bin 10 min später“ oder „wir sitzen hinten links, wo
-- seid ihr?“. „Bin gleich da“ gab es bisher nur zusammen mit dem Live-Standort (P13 Etappe 2b) – wer seinen Standort
-- nicht teilen will, musste zurück in den Chat. Jetzt sagt jede Person mit „Bin dabei“ oder „Vielleicht“ auf der
-- Planseite „Bin da“ oder „Bin in 10/20/30/60 Min. da“; die Crew sieht, wer schon da ist und wer gegen wann kommt.
--
-- Bewusst so gebaut:
--   * Kein Standort, keine Benachrichtigung: nur eine Ansage, die man selbst macht. Die Uhrzeit rechnet der Server
--     (jetzt + Minuten), die App schätzt nichts.
--   * Nur im Zeitfenster rund um den Beginn: ab 1 Stunde vorher bis 3 Stunden nach Beginn, höchstens bis zum Ende
--     (ohne gültiges Ende gilt der Abend 4 Stunden nach Beginn als vorbei, wie bei P13/P31). Gleiche Regel wie
--     `arrivalOpen` in src/lib/arrival.ts.
--   * Wird der Plan verschoben, gelten alte Ansagen nicht weiter: `plan_arrival_status` zeigt nur Ansagen aus dem
--     aktuellen Fenster, und jede neue Ansage räumt alte (vorbei, abgesagt, aus einem früheren Fenster) weg.
--   * Kein Lesen über RLS: Die Tabelle hat keine Rechte für API-Rollen; gelesen wird nur über `plan_arrival_status`
--     (Mitglieder der Crew des Plans), geschrieben nur über `set_plan_arrival`.
--   * Wer nichts sagt, erscheint nicht mit Namen – nur als Zahl.
--   * Kontolöschung löscht die eigenen Ansagen (Fremdschlüssel auf das Profil), der Datenexport enthält sie.

create table public.plan_arrivals (
  plan_id uuid not null references public.plans (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  state text not null check (state in ('here', 'late')),
  eta timestamptz,
  updated_at timestamptz not null default now(),
  primary key (plan_id, user_id),
  constraint plan_arrivals_eta_check check ((state = 'late') = (eta is not null))
);
create index plan_arrivals_user_idx on public.plan_arrivals (user_id);

alter table public.plan_arrivals enable row level security;
revoke all on table public.plan_arrivals from public, anon, authenticated;
-- Keine Policy und keine Rechte: gelesen wird nur über `plan_arrival_status`, geschrieben nur über `set_plan_arrival`.

-- Beginn des Fensters (1 Stunde vor Beginn) – Ansagen davor gehören zu einer früheren Uhrzeit des Plans.
create function app_private.plan_arrival_from(p_plan public.plans) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select p_plan.starts_at - interval '1 hour'
$$;

-- Ist „Seid ihr schon da?“ für diesen Plan gerade offen?
create function app_private.plan_arrival_open(p_plan public.plans) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_plan.status <> 'cancelled'
     and now() >= p_plan.starts_at - interval '1 hour'
     and now() < least(p_plan.starts_at + interval '3 hours',
                       case when p_plan.ends_at > p_plan.starts_at then p_plan.ends_at else p_plan.starts_at + interval '4 hours' end)
$$;

-- „Bin da“ (`here`), „Bin in … Min. da“ (`late`, 1–120 Minuten) oder zurücknehmen (`none`).
create function public.set_plan_arrival(p_plan_id uuid, p_state text, p_minutes integer default null) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
  v_eta timestamptz;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id;
  if not found or not app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.forbid();
  end if;
  if p_state is null or p_state not in ('here', 'late', 'none') then
    perform app_private.fail('invalid_input');
  end if;
  if p_state = 'late' and (p_minutes is null or p_minutes not between 1 and 120) then
    perform app_private.fail('invalid_arrival');
  end if;
  if not app_private.plan_arrival_open(v_plan) then
    perform app_private.fail('plan_arrival_closed');
  end if;
  -- Wer dabei ist oder vielleicht kommt (wer spontan doch kommt, hat oft nicht umgestellt) – wie bei P31.
  if not app_private.plan_home_can_answer(p_plan_id, v_uid) then
    perform app_private.fail('plan_arrival_not_going');
  end if;
  perform app_private.rate_limit('plan_arrival', 30, interval '1 hour');

  if p_state = 'none' then
    delete from public.plan_arrivals a where a.plan_id = p_plan_id and a.user_id = v_uid;
  else
    v_eta := case when p_state = 'late' then now() + make_interval(mins => p_minutes) end;
    insert into public.plan_arrivals (plan_id, user_id, state, eta, updated_at) values (p_plan_id, v_uid, p_state, v_eta, now())
    on conflict (plan_id, user_id) do update set state = excluded.state, eta = excluded.eta, updated_at = excluded.updated_at;
  end if;

  -- Aufräumen: Ansagen, deren Fenster vorbei ist, deren Plan abgesagt wurde oder die vor einer Verschiebung lagen.
  delete from public.plan_arrivals a
  using public.plans p
  where p.id = a.plan_id
    and (not app_private.plan_arrival_open(p) or a.updated_at < app_private.plan_arrival_from(p));
  return v_eta;
end $$;

-- Stand für die Crew: offen?, darf ich ansagen?, meine Ansage, alle Ansagen aus dem aktuellen Fenster (nur Mitglieder
-- der Crew) und wie viele mit „Bin dabei“/„Vielleicht“ noch nichts gesagt haben.
create function public.plan_arrival_status(p_plan_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
  v_from timestamptz;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id;
  if not found or not app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.forbid();
  end if;
  if not app_private.plan_arrival_open(v_plan) then
    return jsonb_build_object('open', false, 'can_answer', false, 'mine', null, 'people', '[]'::jsonb, 'missing', 0);
  end if;
  v_from := app_private.plan_arrival_from(v_plan);
  return jsonb_build_object(
    'open', true,
    'can_answer', app_private.plan_home_can_answer(p_plan_id, v_uid),
    'mine', (select jsonb_build_object('state', a.state, 'eta', a.eta, 'updated_at', a.updated_at)
             from public.plan_arrivals a where a.plan_id = p_plan_id and a.user_id = v_uid and a.updated_at >= v_from),
    'people', coalesce((select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'state', a.state, 'eta', a.eta, 'updated_at', a.updated_at)
                                         order by a.updated_at, a.user_id)
                        from public.plan_arrivals a
                        join public.crew_members m on m.crew_id = v_plan.crew_id and m.user_id = a.user_id
                        join public.plan_participants pp on pp.plan_id = a.plan_id and pp.user_id = a.user_id
                                                         and pp.attendance_status in ('going', 'maybe')
                        where a.plan_id = p_plan_id and a.updated_at >= v_from), '[]'::jsonb),
    'missing', (select count(*)::int from public.plan_participants pp
                join public.crew_members m on m.crew_id = v_plan.crew_id and m.user_id = pp.user_id
                where pp.plan_id = p_plan_id and pp.attendance_status in ('going', 'maybe')
                  and not exists (select 1 from public.plan_arrivals a
                                  where a.plan_id = p_plan_id and a.user_id = pp.user_id and a.updated_at >= v_from)));
end $$;

revoke all on function app_private.plan_arrival_from(public.plans) from public, anon, authenticated;
revoke all on function app_private.plan_arrival_open(public.plans) from public, anon, authenticated;
revoke all on function public.set_plan_arrival(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.plan_arrival_status(uuid) from public, anon, authenticated;
grant execute on function public.set_plan_arrival(uuid, text, integer) to authenticated, service_role;
grant execute on function public.plan_arrival_status(uuid) to authenticated, service_role;

comment on table public.plan_arrivals is 'P43: „Seid ihr schon da?“ – „Bin da“ oder „Bin in … Min. da“ am Abend selbst; ohne Standort, nur über RPC, nur im Fenster sichtbar.';
comment on function public.set_plan_arrival(uuid, text, integer) is 'P43: „Bin da“ (here), „Bin in … Min. da“ (late, 1–120 Minuten) oder zurücknehmen (none) – nur mit Zusage/Vielleicht, ab 1 h vor bis 3 h nach Beginn.';
comment on function public.plan_arrival_status(uuid) is 'P43: Stand von „Seid ihr schon da?“ für Mitglieder der Crew: wer da ist, wer gegen wann kommt, wie viele nichts gesagt haben.';


-- ---- Datenexport ------------------------------------------------------------------------------
-- Wie bisher (Stand P35), dazu die eigenen Ansagen „Bin da“ / „Bin in … Min. da“.
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
    'crew_wishes', coalesce((select jsonb_agg(jsonb_build_object('crew_id', w.crew_id, 'place', act.name, 'created_at', w.created_at) order by w.created_at)
                             from public.crew_wishes w join public.activities act on act.id = w.activity_id where w.added_by = v_uid), '[]'::jsonb),
    'settings', (select to_jsonb(s) from public.user_settings s where s.user_id = v_uid),
    'calendar_feed', (select jsonb_build_object('active', true, 'created_at', f.created_at, 'last_used_at', f.last_used_at)
                      from public.calendar_feeds f where f.user_id = v_uid),
    'push_devices', coalesce((select jsonb_agg(jsonb_build_object('label', d.label, 'created_at', d.created_at, 'last_success_at', d.last_success_at, 'muted_types', d.muted_types) order by d.created_at)
                              from public.push_subscriptions d where d.user_id = v_uid), '[]'::jsonb),
    'crews', coalesce((select jsonb_agg(jsonb_build_object('crew_id', c.id, 'name', c.name, 'role', m.role, 'joined_at', m.joined_at,
                                                           'push_muted', mu.crew_id is not null, 'push_muted_until', mu.muted_until) order by m.joined_at)
                       from public.crew_members m join public.crews c on c.id = m.crew_id
                       left join public.crew_push_mutes mu on mu.crew_id = m.crew_id and mu.user_id = m.user_id
                       where m.user_id = v_uid), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('crew_id', cm.crew_id, 'body', cm.body, 'created_at', cm.created_at) order by cm.created_at)
                          from public.crew_messages cm where cm.user_id = v_uid), '[]'::jsonb),
    'polls_created', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'created_at', p.created_at) order by p.created_at)
                               from public.polls p where p.created_by = v_uid), '[]'::jsonb),
    'votes', coalesce((select jsonb_agg(jsonb_build_object('poll_id', v.poll_id, 'option', o.title, 'response', v.response, 'updated_at', v.updated_at) order by v.updated_at)
                       from public.poll_votes v join public.poll_options o on o.id = v.poll_option_id where v.user_id = v_uid), '[]'::jsonb),
    'plans', coalesce((select jsonb_agg(jsonb_build_object('plan_id', pl.id, 'title', pl.title, 'starts_at', pl.starts_at, 'attendance_status', pp.attendance_status, 'note', pp.note,
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
    'plan_feedback', coalesce((select jsonb_agg(jsonb_build_object('plan_id', f.plan_id, 'verdict', f.verdict, 'created_at', f.created_at,
                                                                   'updated_at', f.updated_at) order by f.created_at)
                               from public.plan_feedback f where f.user_id = v_uid), '[]'::jsonb),
    'plan_home_checkins', coalesce((select jsonb_agg(jsonb_build_object('plan_id', h.plan_id, 'arrived_at', h.arrived_at) order by h.arrived_at)
                                    from public.plan_home_checkins h where h.user_id = v_uid), '[]'::jsonb),
    'plan_arrivals', coalesce((select jsonb_agg(jsonb_build_object('plan_id', a.plan_id, 'state', a.state, 'eta', a.eta, 'updated_at', a.updated_at) order by a.updated_at)
                               from public.plan_arrivals a where a.user_id = v_uid), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at) from public.reports r where r.reporter_id = v_uid), '[]'::jsonb)
  );
end $$;

