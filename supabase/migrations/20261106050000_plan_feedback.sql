-- P29 · „Wie war’s?“ – kurzes Urteil nach dem Abend
-- Nach einem abgeschlossenen Plan sagt jede Person aus der Crew, die dabei war, mit einem Tipp, wie es war:
-- „Nochmal!“ (again), „War okay“ (ok) oder „Eher nicht“ (meh). Die Crew sieht nur die Zahlen, nicht wer was
-- gesagt hat – damit niemand die Organisatorin öffentlich abstraft und trotzdem klar ist, welche Abende sich
-- lohnen. Die eigene Antwort sieht nur man selbst.
--
-- Bewusst so gebaut:
--   * Kein Lesen über RLS: Die Tabelle hat keine Leserechte für API-Rollen; `plan_feedback_summary` liefert nur Zahlen
--     und die eigene Antwort (Mitglieder der Crew des Plans, sonst verboten).
--   * Antworten nur, wer beim Plan „Bin dabei“ stand, nur nach dem Abschluss und höchstens 30 Tage danach.
--   * Kein Bezug nach außen: Das Urteil ist kein Ortsrating, es erscheint nirgends in Discover und nie für
--     Außenstehende (Ehrlichkeitsregel: keine erfundenen oder vermischten Bewertungen).
--   * Kontolöschung löscht die eigenen Antworten (Fremdschlüssel auf das Profil), der Datenexport enthält sie.

create table public.plan_feedback (
  plan_id uuid not null references public.plans (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  verdict text not null check (verdict in ('again', 'ok', 'meh')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (plan_id, user_id)
);
create index plan_feedback_user_idx on public.plan_feedback (user_id);

alter table public.plan_feedback enable row level security;
revoke all on table public.plan_feedback from public, anon, authenticated;
-- Keine Policy und keine Rechte: gelesen wird nur über `plan_feedback_summary`, geschrieben nur über `set_plan_feedback`.

-- Wie lange nach dem Abend noch geantwortet werden kann.
create function app_private.plan_feedback_open(p_plan public.plans) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_plan.status = 'completed'
     and coalesce(p_plan.completed_at, p_plan.starts_at) > now() - interval '30 days'
$$;

-- Urteil abgeben (`p_verdict` = again/ok/meh) oder zurückziehen (null).
create function public.set_plan_feedback(p_plan_id uuid, p_verdict text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id;
  if not found or not app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.forbid();
  end if;
  if p_verdict is not null and p_verdict not in ('again', 'ok', 'meh') then
    perform app_private.fail('invalid_plan_feedback');
  end if;
  if not app_private.plan_feedback_open(v_plan) then
    perform app_private.fail('plan_feedback_closed');
  end if;
  if not exists (select 1 from public.plan_participants pp
                 where pp.plan_id = p_plan_id and pp.user_id = v_uid and pp.attendance_status = 'going') then
    perform app_private.fail('plan_feedback_not_going');
  end if;
  perform app_private.rate_limit('plan_feedback', 60, interval '1 hour');

  if p_verdict is null then
    delete from public.plan_feedback f where f.plan_id = p_plan_id and f.user_id = v_uid;
  else
    insert into public.plan_feedback (plan_id, user_id, verdict)
    values (p_plan_id, v_uid, p_verdict)
    on conflict (plan_id, user_id) do update set verdict = excluded.verdict, updated_at = now()
    where public.plan_feedback.verdict is distinct from excluded.verdict;
  end if;
end $$;

-- Zahlen für die Crew, dazu die eigene Antwort und ob man (noch) antworten kann.
create function public.plan_feedback_summary(p_plan_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id;
  if not found or not app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.forbid();
  end if;
  return jsonb_build_object(
    'again', (select count(*)::int from public.plan_feedback f where f.plan_id = p_plan_id and f.verdict = 'again'),
    'ok', (select count(*)::int from public.plan_feedback f where f.plan_id = p_plan_id and f.verdict = 'ok'),
    'meh', (select count(*)::int from public.plan_feedback f where f.plan_id = p_plan_id and f.verdict = 'meh'),
    'mine', (select f.verdict from public.plan_feedback f where f.plan_id = p_plan_id and f.user_id = v_uid),
    'open', app_private.plan_feedback_open(v_plan),
    'can_answer', app_private.plan_feedback_open(v_plan) and exists (
      select 1 from public.plan_participants pp
      where pp.plan_id = p_plan_id and pp.user_id = v_uid and pp.attendance_status = 'going'));
end $$;

revoke all on function app_private.plan_feedback_open(public.plans) from public, anon, authenticated;
revoke all on function public.set_plan_feedback(uuid, text) from public, anon, authenticated;
revoke all on function public.plan_feedback_summary(uuid) from public, anon, authenticated;
grant execute on function public.set_plan_feedback(uuid, text) to authenticated, service_role;
grant execute on function public.plan_feedback_summary(uuid) to authenticated, service_role;

comment on table public.plan_feedback is 'P29: „Wie war’s?“ – Urteil nach dem Abend; nur über RPC, die Crew sieht nur Zahlen.';
comment on function public.set_plan_feedback(uuid, text) is 'P29: eigenes Urteil zu einem abgeschlossenen Plan (again/ok/meh, null = zurückziehen).';
comment on function public.plan_feedback_summary(uuid) is 'P29: Zahlen der Urteile, eigene Antwort, ob noch geantwortet werden kann.';

-- ---- Datenexport ------------------------------------------------------------------------------
-- Wie bisher (Stand P24), dazu die eigenen Urteile.
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
    'crews', coalesce((select jsonb_agg(jsonb_build_object('crew_id', c.id, 'name', c.name, 'role', m.role, 'joined_at', m.joined_at) order by m.joined_at)
                       from public.crew_members m join public.crews c on c.id = m.crew_id where m.user_id = v_uid), '[]'::jsonb),
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
    'reports', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at) from public.reports r where r.reporter_id = v_uid), '[]'::jsonb)
  );
end $$;

