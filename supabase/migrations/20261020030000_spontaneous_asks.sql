-- S4 Etappe 1 · „Heute noch wer?“ – Spontan-Frage an die Crew
--
-- Ein Tipp fragt die ganze Crew, ob heute noch wer Lust hat. Antworten gibt es nur zwei: „Bock“ (in)
-- oder „heute nicht“ (out). Die Frage verfällt nach 2 Stunden von selbst (expires_at, kein Cron nötig);
-- wer gefragt hat, kann sie vorher beenden. Je Crew läuft höchstens eine Frage gleichzeitig.
-- Ab 3 × „Bock“ ist die Runde zusammen: alle, die Bock haben, bekommen einmal Bescheid (matched_at).
-- Lesen nur für die Crew (RLS), Schreiben nur über die RPCs. Alte Fragen (älter als 7 Tage) räumt die
-- nächste Frage der Crew weg – es bleibt kein Verlauf über Spontan-Abende liegen.
-- Etappe 2 (offen): ab 3 Zusagen Orte, die laut OSM-Öffnungszeiten jetzt offen haben; App-Kurzbefehl.

create table public.spontaneous_asks (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crews (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete cascade,
  note text check (note is null or char_length(note) between 1 and 80),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  closed_at timestamptz,
  matched_at timestamptz,
  check (expires_at > created_at)
);
comment on table public.spontaneous_asks is 'S4: „Heute noch wer?“ – verfällt nach 2 Stunden (expires_at) oder wenn closed_at gesetzt ist.';
create index spontaneous_asks_crew_idx on public.spontaneous_asks (crew_id, expires_at desc);
create index spontaneous_asks_creator_idx on public.spontaneous_asks (created_by);

create table public.spontaneous_answers (
  ask_id uuid not null references public.spontaneous_asks (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  answer text not null check (answer in ('in', 'out')),
  answered_at timestamptz not null default now(),
  primary key (ask_id, user_id)
);
create index spontaneous_answers_user_idx on public.spontaneous_answers (user_id);

alter table public.spontaneous_asks enable row level security;
alter table public.spontaneous_answers enable row level security;
revoke all on table public.spontaneous_asks from public, anon, authenticated;
revoke all on table public.spontaneous_answers from public, anon, authenticated;
grant select on table public.spontaneous_asks to authenticated;
grant select on table public.spontaneous_answers to authenticated;

create policy spontaneous_asks_select on public.spontaneous_asks
  for select to authenticated using (app_private.is_crew_member(crew_id));
create policy spontaneous_answers_select on public.spontaneous_answers
  for select to authenticated using (
    exists (select 1 from public.spontaneous_asks a where a.id = ask_id and app_private.is_crew_member(a.crew_id))
  );

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.spontaneous_asks, public.spontaneous_answers;
  end if;
end $$;

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'crew_member_joined', 'crew_member_removed', 'crew_role_changed',
  'poll_created', 'poll_reminder', 'poll_vote', 'poll_result',
  'plan_created', 'plan_changed', 'plan_cancelled', 'plan_attendance',
  'booking_status', 'ride_request', 'ride_confirmed', 'reward_earned',
  'plan_expense', 'plan_settlement',
  'spontaneous_ask', 'spontaneous_answer', 'spontaneous_match'
));

-- Läuft die Frage noch?
create function app_private.spontaneous_open(p_ask public.spontaneous_asks) returns boolean
language sql stable set search_path = '' as $$
  select p_ask.closed_at is null and p_ask.expires_at > now();
$$;

-- Fragt die Crew. Gibt die ID der neuen Frage zurück.
create function public.ask_spontaneous(p_crew_id uuid, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_note text := app_private.clean_line(p_note, 80);
  v_crew public.crews%rowtype;
  v_id uuid;
  v_expires timestamptz := now() + interval '2 hours';
begin
  if p_crew_id is null or not app_private.is_crew_member(p_crew_id) then
    perform app_private.forbid();
  end if;
  -- Sperre auf die Crew: zwei gleichzeitige Fragen ergeben trotzdem nur eine laufende.
  select * into v_crew from public.crews c where c.id = p_crew_id for update;
  if exists (
    select 1 from public.spontaneous_asks a
    where a.crew_id = p_crew_id and a.closed_at is null and a.expires_at > now()
  ) then
    perform app_private.fail('spontaneous_active');
  end if;
  perform app_private.rate_limit('spontaneous_ask', 6, interval '1 hour');

  delete from public.spontaneous_asks a where a.crew_id = p_crew_id and a.created_at < now() - interval '7 days';

  insert into public.spontaneous_asks (crew_id, created_by, note, expires_at)
  values (p_crew_id, v_uid, v_note, v_expires)
  returning id into v_id;
  -- Wer fragt, hat Bock.
  insert into public.spontaneous_answers (ask_id, user_id, answer) values (v_id, v_uid, 'in');

  perform app_private.notify_crew(p_crew_id, 'spontaneous_ask', v_uid, 'crew', p_crew_id,
                                  jsonb_build_object('ask_id', v_id, 'note', v_note, 'crew_name', v_crew.name, 'expires_at', v_expires),
                                  'spontaneous_ask:' || v_id::text);
  perform app_private.audit('spontaneous_asked', 'crew', p_crew_id, p_crew_id, jsonb_build_object('ask_id', v_id));
  return v_id;
end $$;

-- „Bock“ (in) oder „heute nicht“ (out); erneuter Tipp ändert die Antwort.
-- Gibt { in_count, out_count, matched } zurück.
create function public.answer_spontaneous(p_ask_id uuid, p_answer text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_ask public.spontaneous_asks%rowtype;
  v_crew_name text;
  v_in integer;
  v_out integer;
  v_member record;
begin
  select * into v_ask from public.spontaneous_asks a where a.id = p_ask_id for update;
  if not found or not app_private.is_crew_member(v_ask.crew_id) then
    perform app_private.forbid();
  end if;
  if not app_private.spontaneous_open(v_ask) then
    perform app_private.fail('spontaneous_over');
  end if;
  if p_answer is null or p_answer not in ('in', 'out') then
    perform app_private.fail('invalid_spontaneous_answer');
  end if;
  perform app_private.rate_limit('spontaneous_answer', 60, interval '1 hour');

  insert into public.spontaneous_answers (ask_id, user_id, answer) values (p_ask_id, v_uid, p_answer)
  on conflict (ask_id, user_id) do update set answer = excluded.answer, answered_at = now();

  select count(*) filter (where s.answer = 'in'), count(*) filter (where s.answer = 'out')
  into v_in, v_out
  from public.spontaneous_answers s where s.ask_id = p_ask_id;

  select c.name into v_crew_name from public.crews c where c.id = v_ask.crew_id;

  -- Wer gefragt hat, erfährt jede Zusage einmal.
  if p_answer = 'in' and v_uid <> v_ask.created_by then
    perform app_private.notify(v_ask.created_by, 'spontaneous_answer', v_uid, v_ask.crew_id, 'crew', v_ask.crew_id,
                               jsonb_build_object('ask_id', p_ask_id, 'note', v_ask.note, 'crew_name', v_crew_name, 'in_count', v_in),
                               'spontaneous_answer:' || p_ask_id::text || ':' || v_uid::text);
  end if;

  -- Ab drei Zusagen steht die Runde – alle mit „Bock“ bekommen einmal Bescheid.
  if v_in >= 3 and v_ask.matched_at is null then
    update public.spontaneous_asks a set matched_at = now() where a.id = p_ask_id;
    for v_member in
      select s.user_id from public.spontaneous_answers s
      join public.crew_members m on m.crew_id = v_ask.crew_id and m.user_id = s.user_id
      where s.ask_id = p_ask_id and s.answer = 'in'
    loop
      perform app_private.notify(v_member.user_id, 'spontaneous_match', null, v_ask.crew_id, 'crew', v_ask.crew_id,
                                 jsonb_build_object('ask_id', p_ask_id, 'note', v_ask.note, 'crew_name', v_crew_name, 'in_count', v_in),
                                 'spontaneous_match:' || p_ask_id::text);
    end loop;
    v_ask.matched_at := now();
  end if;

  return jsonb_build_object('in_count', v_in, 'out_count', v_out, 'matched', v_ask.matched_at is not null);
end $$;

-- Frage vorzeitig beenden: wer gefragt hat, Owner oder Admin. Bereits beendete Fragen bleiben, wie sie sind.
create function public.close_spontaneous(p_ask_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_ask public.spontaneous_asks%rowtype;
begin
  select * into v_ask from public.spontaneous_asks a where a.id = p_ask_id for update;
  if not found or not app_private.is_crew_member(v_ask.crew_id) then
    perform app_private.forbid();
  end if;
  if v_ask.created_by <> v_uid and not app_private.has_crew_role(v_ask.crew_id, array['owner', 'admin']::public.crew_role[]) then
    perform app_private.forbid();
  end if;
  if not app_private.spontaneous_open(v_ask) then
    return;
  end if;
  update public.spontaneous_asks a set closed_at = now() where a.id = p_ask_id;
  perform app_private.audit('spontaneous_closed', 'crew', v_ask.crew_id, v_ask.crew_id, jsonb_build_object('ask_id', p_ask_id));
end $$;

revoke all on function app_private.spontaneous_open(public.spontaneous_asks) from public, anon, authenticated;
revoke all on function public.ask_spontaneous(uuid, text) from public, anon, authenticated;
revoke all on function public.answer_spontaneous(uuid, text) from public, anon, authenticated;
revoke all on function public.close_spontaneous(uuid) from public, anon, authenticated;
grant execute on function public.ask_spontaneous(uuid, text) to authenticated;
grant execute on function public.answer_spontaneous(uuid, text) to authenticated;
grant execute on function public.close_spontaneous(uuid) to authenticated;

-- Datenexport: eigene Fragen und Antworten (sonst unverändert gegenüber 20261019010000_calendar_feeds).
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
