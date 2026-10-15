-- P3 Etappe 1 · Kosten aufteilen nach dem Abend
-- Wer etwas ausgelegt hat, trägt es beim Plan ein („Bowlingbahn, 48 €, bezahlt von Alice, geteilt
-- durch Alice und Bob“). Die App rechnet daraus, wer wem wie viel gibt. Bezahlt wird nichts – die
-- App zeigt nur die Übersicht. Wer zurückgezahlt hat, tippt „Erledigt“; das ist eine Rückzahlung
-- (kind = 'settlement') im selben Modell: bezahlt von der Person, die schuldete, Anteil der Person,
-- die das Geld bekommt. So bleibt die Rechnung eine einzige Summe über alle Einträge.
--
-- Anteile speichert der Server (gleichmäßig, Rest-Cent der Reihe nach), damit alle Geräte dieselben
-- Beträge sehen. Gelesen wird über RLS (nur die Crew des Plans), geschrieben nur per RPC.
-- Kontolöschung: eigene Ausgaben und Anteile entfallen (ON DELETE CASCADE) – die übrigen Beträge
-- bleiben in sich stimmig, weil Schulden immer aus den Anteilen berechnet werden.

create table public.plan_expenses (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  kind text not null default 'expense' check (kind in ('expense', 'settlement')),
  description text check (description is null or char_length(description) between 2 and 80),
  amount_cents integer not null check (amount_cents between 1 and 1000000),
  paid_by uuid not null references public.profiles (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((kind = 'expense') = (description is not null))
);
create index plan_expenses_plan_idx on public.plan_expenses (plan_id, created_at);
create index plan_expenses_paid_by_idx on public.plan_expenses (paid_by);
create index plan_expenses_created_by_idx on public.plan_expenses (created_by);

create table public.plan_expense_shares (
  expense_id uuid not null references public.plan_expenses (id) on delete cascade,
  plan_id uuid not null references public.plans (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  amount_cents integer not null check (amount_cents between 0 and 1000000),
  primary key (expense_id, user_id)
);
create index plan_expense_shares_plan_idx on public.plan_expense_shares (plan_id);
create index plan_expense_shares_user_idx on public.plan_expense_shares (user_id);

alter table public.plan_expenses enable row level security;
alter table public.plan_expense_shares enable row level security;
revoke all on table public.plan_expenses, public.plan_expense_shares from public, anon, authenticated;
grant select on table public.plan_expenses, public.plan_expense_shares to authenticated;

create policy plan_expenses_select_member on public.plan_expenses for select to authenticated
  using (app_private.can_access_plan(plan_id));
create policy plan_expense_shares_select_member on public.plan_expense_shares for select to authenticated
  using (app_private.can_access_plan(plan_id));

-- Neue Einträge erscheinen bei den anderen ohne Neuladen (RLS gilt auch für Realtime).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.plan_expenses;
  end if;
end $$;

-- Zwei neue Benachrichtigungen: eine Ausgabe, an der du beteiligt bist; eine Rückzahlung an oder von dir.
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'crew_member_joined', 'crew_member_removed', 'crew_role_changed',
  'poll_created', 'poll_reminder', 'poll_vote', 'poll_result',
  'plan_created', 'plan_changed', 'plan_cancelled', 'plan_attendance',
  'booking_status', 'ride_request', 'ride_confirmed', 'reward_earned',
  'plan_expense', 'plan_settlement'
));

-- Prüft, ob eine Person (noch) Mitglied der Crew ist – für Zahlende und Beteiligte.
create function app_private.is_member_of(p_crew_id uuid, p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.crew_members m where m.crew_id = p_crew_id and m.user_id = p_user_id);
$$;

-- Ausgabe eintragen. p_paid_by: wer bezahlt hat (Standard: ich), p_split_with: auf wen sie geteilt
-- wird (1–50 Mitglieder der Crew; die zahlende Person muss nicht dabei sein).
create function public.add_plan_expense(
  p_plan_id uuid, p_description text, p_amount_cents integer, p_paid_by uuid, p_split_with uuid[]
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
  v_description text := app_private.clean_line(p_description, 80);
  v_payer uuid := coalesce(p_paid_by, v_uid);
  v_members uuid[];
  v_count integer;
  v_id uuid;
  v_share record;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id;
  if not found or not app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.forbid();
  end if;
  if v_description is null or char_length(v_description) < 2 then
    perform app_private.fail('invalid_expense_description');
  end if;
  if p_amount_cents is null or p_amount_cents not between 1 and 1000000 then
    perform app_private.fail('invalid_expense_amount');
  end if;

  select array_agg(distinct u order by u) into v_members
  from unnest(coalesce(p_split_with, '{}'::uuid[])) as s(u) where u is not null;
  v_count := coalesce(cardinality(v_members), 0);
  if v_count = 0 or v_count > 50 then
    perform app_private.fail('invalid_expense_split');
  end if;
  if not app_private.is_member_of(v_plan.crew_id, v_payer)
     or exists (select 1 from unnest(v_members) as s(u) where not app_private.is_member_of(v_plan.crew_id, u)) then
    perform app_private.fail('invalid_expense_split');
  end if;
  if (select count(*) from public.plan_expenses e where e.plan_id = p_plan_id) >= 200 then
    perform app_private.fail('expense_limit');
  end if;
  perform app_private.rate_limit('plan_expense', 60, interval '1 hour');

  insert into public.plan_expenses (plan_id, kind, description, amount_cents, paid_by, created_by)
  values (p_plan_id, 'expense', v_description, p_amount_cents, v_payer, v_uid)
  returning id into v_id;

  -- Gleichmäßig teilen; die Rest-Cent bekommen die ersten Personen (sortiert nach ID) je einen.
  insert into public.plan_expense_shares (expense_id, plan_id, user_id, amount_cents)
  select v_id, p_plan_id, s.u, p_amount_cents / v_count + case when s.ord <= p_amount_cents % v_count then 1 else 0 end
  from unnest(v_members) with ordinality as s(u, ord);

  -- Beteiligte (außer mir) erfahren, was sie das kostet; wer als zahlende Person eingetragen wurde,
  -- erfährt das auch (ohne Anteil, falls nicht beteiligt).
  for v_share in
    select sh.user_id, sh.amount_cents from public.plan_expense_shares sh
    where sh.expense_id = v_id and sh.user_id <> v_uid and sh.user_id <> v_payer
    union all
    select v_payer, null::integer where v_payer <> v_uid
  loop
    perform app_private.notify(v_share.user_id, 'plan_expense', v_uid, v_plan.crew_id, 'plan', v_plan.id,
      jsonb_build_object('title', v_plan.title, 'description', v_description, 'amount_cents', p_amount_cents,
                         'share_cents', v_share.amount_cents, 'you_paid', v_share.user_id = v_payer));
  end loop;
  return v_id;
end $$;

-- Rückzahlung festhalten („Bob hat Alice 14 € gegeben“). Nur die beiden Beteiligten dürfen das.
create function public.record_plan_settlement(p_plan_id uuid, p_from uuid, p_to uuid, p_amount_cents integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
  v_other uuid;
  v_id uuid;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id;
  if not found or not app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.forbid();
  end if;
  if p_from is null or p_to is null or p_from = p_to then
    perform app_private.fail('invalid_settlement');
  end if;
  if v_uid <> p_from and v_uid <> p_to then
    perform app_private.forbid();
  end if;
  if p_amount_cents is null or p_amount_cents not between 1 and 1000000 then
    perform app_private.fail('invalid_expense_amount');
  end if;
  if not app_private.is_member_of(v_plan.crew_id, p_from) or not app_private.is_member_of(v_plan.crew_id, p_to) then
    perform app_private.fail('invalid_settlement');
  end if;
  if (select count(*) from public.plan_expenses e where e.plan_id = p_plan_id) >= 200 then
    perform app_private.fail('expense_limit');
  end if;
  perform app_private.rate_limit('plan_expense', 60, interval '1 hour');

  insert into public.plan_expenses (plan_id, kind, description, amount_cents, paid_by, created_by)
  values (p_plan_id, 'settlement', null, p_amount_cents, p_from, v_uid)
  returning id into v_id;
  insert into public.plan_expense_shares (expense_id, plan_id, user_id, amount_cents)
  values (v_id, p_plan_id, p_to, p_amount_cents);

  v_other := case when v_uid = p_from then p_to else p_from end;
  perform app_private.notify(v_other, 'plan_settlement', v_uid, v_plan.crew_id, 'plan', v_plan.id,
    jsonb_build_object('title', v_plan.title, 'amount_cents', p_amount_cents, 'direction', case when v_uid = p_from then 'paid_you' else 'received' end));
  return v_id;
end $$;

-- Eintrag löschen: wer ihn angelegt hat, wer bezahlt hat, bei Rückzahlungen auch wer das Geld
-- bekommen hat, außerdem Owner/Admins der Crew.
create function public.delete_plan_expense(p_expense_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_expense public.plan_expenses%rowtype;
  v_crew_id uuid;
begin
  select * into v_expense from public.plan_expenses e where e.id = p_expense_id for update;
  if not found then
    perform app_private.forbid();
  end if;
  select p.crew_id into v_crew_id from public.plans p where p.id = v_expense.plan_id;
  if not app_private.is_crew_member(v_crew_id) then
    perform app_private.forbid();
  end if;
  if not (
    v_expense.created_by = v_uid or v_expense.paid_by = v_uid
    or (v_expense.kind = 'settlement' and exists (select 1 from public.plan_expense_shares s where s.expense_id = v_expense.id and s.user_id = v_uid))
    or app_private.has_crew_role(v_crew_id, array['owner', 'admin']::public.crew_role[])
  ) then
    perform app_private.forbid();
  end if;
  perform app_private.rate_limit('plan_expense_delete', 60, interval '1 hour');

  delete from public.plan_expenses e where e.id = p_expense_id;
  perform app_private.audit('plan_expense_deleted', 'plan', v_expense.plan_id, v_crew_id,
    jsonb_build_object('kind', v_expense.kind, 'amount_cents', v_expense.amount_cents, 'paid_by', v_expense.paid_by));
end $$;

revoke all on function app_private.is_member_of(uuid, uuid) from public, anon, authenticated;
revoke all on function public.add_plan_expense(uuid, text, integer, uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.record_plan_settlement(uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.delete_plan_expense(uuid) from public, anon, authenticated;
grant execute on function public.add_plan_expense(uuid, text, integer, uuid, uuid[]) to authenticated, service_role;
grant execute on function public.record_plan_settlement(uuid, uuid, uuid, integer) to authenticated, service_role;
grant execute on function public.delete_plan_expense(uuid) to authenticated, service_role;

-- Datenexport (Art. 15/20 DSGVO) um Ausgaben und Anteile ergänzt. Sonst unverändert.
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
