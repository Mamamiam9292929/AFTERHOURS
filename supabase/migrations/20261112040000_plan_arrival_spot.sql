-- P44 · „Wo sitzt ihr?“ – wer schon da ist, sagt in ein paar Worten, wo
-- Die zweithäufigste Nachricht am Abend selbst nach „bin 10 min später“: „wir sitzen hinten links“ / „sind oben auf
-- der Terrasse“. Wer „Bin da“ gesagt hat (P43), schreibt jetzt auf der Planseite oder auf Home dazu, wo genau
-- („hinten links, Tisch 12“). Wer noch kommt, sieht es bei der Person – ohne Standort, ohne Karte.
--
-- Bewusst so gebaut:
--   * Nur zusammen mit „Bin da“ aus dem aktuellen Fenster: Wer „später“ sagt oder zurücknimmt, verliert den Hinweis
--     (Trigger), eine Verschiebung räumt ihn mit der Ansage weg (P43).
--   * Ein Satz, höchstens 60 Zeichen, eine Zeile (`clean_line`); leer löscht. Keine Benachrichtigung.
--   * Gelesen wie die Ansage selbst über `plan_arrival_status` (nur Mitglieder der Crew, nur im Fenster).
--   * Im Datenexport enthalten; Kontolöschung löscht ihn mit der Ansage.

alter table public.plan_arrivals
  add column spot text check (spot is null or char_length(spot) <= 60),
  add constraint plan_arrivals_spot_here check (spot is null or state = 'here');

comment on column public.plan_arrivals.spot is 'P44: „Wo sitzt ihr?“ – kurzer Hinweis, wo genau (nur bei „Bin da“).';

-- „Später“ oder ein neuer Stand ohne „da“: Hinweis weg (sonst stünde „hinten links“ bei jemandem, der noch kommt).
create function app_private.plan_arrival_spot_reset() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.state <> 'here' then
    new.spot := null;
  end if;
  return new;
end $$;
revoke all on function app_private.plan_arrival_spot_reset() from public, anon, authenticated;

create trigger plan_arrivals_spot_reset
before insert or update on public.plan_arrivals
for each row execute function app_private.plan_arrival_spot_reset();

-- Hinweis setzen (oder mit leerem Text löschen) – nur wer gerade „Bin da“ gesagt hat.
create function public.set_plan_arrival_spot(p_plan_id uuid, p_spot text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
  v_spot text := app_private.clean_line(p_spot, 60);
begin
  select * into v_plan from public.plans p where p.id = p_plan_id;
  if not found or not app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.forbid();
  end if;
  if not app_private.plan_arrival_open(v_plan) then
    perform app_private.fail('plan_arrival_closed');
  end if;
  if not app_private.plan_home_can_answer(p_plan_id, v_uid) then
    perform app_private.fail('plan_arrival_not_going');
  end if;
  perform app_private.rate_limit('plan_arrival_spot', 30, interval '1 hour');
  update public.plan_arrivals a set spot = v_spot
  where a.plan_id = p_plan_id and a.user_id = v_uid and a.state = 'here'
    and a.updated_at >= app_private.plan_arrival_from(v_plan);
  if not found then
    perform app_private.fail('plan_arrival_spot_not_here');
  end if;
  return v_spot;
end $$;

-- Stand für die Crew wie bisher (P43), dazu je Ansage der Hinweis `spot`.
create or replace function public.plan_arrival_status(p_plan_id uuid) returns jsonb
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
    'mine', (select jsonb_build_object('state', a.state, 'eta', a.eta, 'spot', a.spot, 'updated_at', a.updated_at)
             from public.plan_arrivals a where a.plan_id = p_plan_id and a.user_id = v_uid and a.updated_at >= v_from),
    'people', coalesce((select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'state', a.state, 'eta', a.eta, 'spot', a.spot, 'updated_at', a.updated_at)
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

revoke all on function public.set_plan_arrival_spot(uuid, text) from public, anon, authenticated;
grant execute on function public.set_plan_arrival_spot(uuid, text) to authenticated, service_role;
revoke all on function public.plan_arrival_status(uuid) from public, anon, authenticated;
grant execute on function public.plan_arrival_status(uuid) to authenticated, service_role;
comment on function public.set_plan_arrival_spot(uuid, text) is 'P44: „Wo sitzt ihr?“ – kurzer Hinweis (höchstens 60 Zeichen) zur eigenen Ansage „Bin da“; leer löscht.';


-- ---- Datenexport ------------------------------------------------------------------------------
-- Wie bisher (Stand P43), dazu der Hinweis `spot` bei den eigenen Ansagen.
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
    'plan_arrivals', coalesce((select jsonb_agg(jsonb_build_object('plan_id', a.plan_id, 'state', a.state, 'eta', a.eta, 'spot', a.spot, 'updated_at', a.updated_at) order by a.updated_at)
                               from public.plan_arrivals a where a.user_id = v_uid), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at) from public.reports r where r.reporter_id = v_uid), '[]'::jsonb)
  );
end $$;
