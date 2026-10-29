-- P14 Etappe 1 · Wer bringt was?
-- Beim Grillen, Spieleabend oder Picknick steht auf der Planseite eine Mitbring-Liste: jede Person
-- aus der Crew schreibt auf, was gebraucht wird („Kohle“, „Chips“, „Uno“), und tippt an, was sie
-- selbst mitbringt. Eine Sache bringt genau eine Person mit; wer es sich anders überlegt, gibt sie
-- wieder frei. Gelesen wird über RLS (nur die Crew des Plans), geschrieben nur per RPC.
--
-- Kontolöschung: eigene Einträge bleiben für die Crew stehen (created_by wird leer), eigene Zusagen
-- werden frei (claimed_by wird leer). Wer die Crew verlässt, gibt seine Zusagen bei kommenden Plänen
-- frei – sonst stünde dort jemand, der gar nicht mehr kommt.

create table public.plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  label text not null check (char_length(label) between 2 and 60),
  created_by uuid references public.profiles (id) on delete set null,
  claimed_by uuid references public.profiles (id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);
-- Dasselbe zweimal auf der Liste hilft niemandem („Chips“ und „chips“).
create unique index plan_items_plan_label_key on public.plan_items (plan_id, lower(label));
create index plan_items_plan_idx on public.plan_items (plan_id, created_at);
create index plan_items_created_by_idx on public.plan_items (created_by);
create index plan_items_claimed_by_idx on public.plan_items (claimed_by);

alter table public.plan_items enable row level security;
revoke all on table public.plan_items from public, anon, authenticated;
grant select on table public.plan_items to authenticated;

create policy plan_items_select_member on public.plan_items for select to authenticated
  using (app_private.can_access_plan(plan_id));

-- Wer etwas einträgt oder antippt, erscheint bei den anderen ohne Neuladen (RLS gilt auch für Realtime).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.plan_items;
  end if;
end $$;

-- Plan zu einem Eintrag holen und prüfen: Mitglied der Crew, Plan weder abgeschlossen noch abgesagt.
create function app_private.plan_for_items(p_plan_id uuid) returns public.plans
language plpgsql stable security definer set search_path = '' as $$
declare
  v_plan public.plans%rowtype;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id;
  if not found or not app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.forbid();
  end if;
  if v_plan.status in ('completed', 'cancelled') then
    perform app_private.fail('plan_locked');
  end if;
  return v_plan;
end $$;

-- Etwas auf die Liste setzen. p_claim: „Bring ich selbst mit“ – gleich mit Zusage.
create function public.add_plan_item(p_plan_id uuid, p_label text, p_claim boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_label text := app_private.clean_line(p_label, 60);
  v_id uuid;
begin
  perform app_private.plan_for_items(p_plan_id);
  if v_label is null or char_length(v_label) < 2 then
    perform app_private.fail('invalid_plan_item');
  end if;
  if exists (select 1 from public.plan_items i where i.plan_id = p_plan_id and lower(i.label) = lower(v_label)) then
    perform app_private.fail('plan_item_exists');
  end if;
  if (select count(*) from public.plan_items i where i.plan_id = p_plan_id) >= 40 then
    perform app_private.fail('plan_item_limit');
  end if;
  perform app_private.rate_limit('plan_item', 60, interval '1 hour');

  insert into public.plan_items (plan_id, label, created_by, claimed_by, claimed_at)
  values (p_plan_id, v_label, v_uid,
          case when coalesce(p_claim, false) then v_uid end,
          case when coalesce(p_claim, false) then now() end)
  on conflict (plan_id, lower(label)) do nothing
  returning id into v_id;
  if v_id is null then
    perform app_private.fail('plan_item_exists');
  end if;
  return v_id;
end $$;

-- „Bring ich“ (p_claim = true) oder „Doch nicht“ (false). Vergeben wird nur, was noch frei ist;
-- freigeben kann nur, wer es mitbringen wollte.
create function public.claim_plan_item(p_item_id uuid, p_claim boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_item public.plan_items%rowtype;
begin
  select * into v_item from public.plan_items i where i.id = p_item_id for update;
  if not found then
    perform app_private.forbid();
  end if;
  perform app_private.plan_for_items(v_item.plan_id);
  if p_claim is null then
    perform app_private.fail('invalid_plan_item');
  end if;
  perform app_private.rate_limit('plan_item_claim', 120, interval '1 hour');

  if p_claim then
    if v_item.claimed_by = v_uid then
      return;
    end if;
    if v_item.claimed_by is not null then
      perform app_private.fail('plan_item_taken');
    end if;
    update public.plan_items i set claimed_by = v_uid, claimed_at = now() where i.id = p_item_id;
  else
    if v_item.claimed_by is null then
      return;
    end if;
    if v_item.claimed_by <> v_uid then
      perform app_private.fail('plan_item_taken');
    end if;
    update public.plan_items i set claimed_by = null, claimed_at = null where i.id = p_item_id;
  end if;
end $$;

-- Von der Liste nehmen: wer es eingetragen hat, Organisator:in des Plans, Owner/Admins der Crew.
create function public.remove_plan_item(p_item_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_item public.plan_items%rowtype;
  v_plan public.plans%rowtype;
begin
  select * into v_item from public.plan_items i where i.id = p_item_id for update;
  if not found then
    perform app_private.forbid();
  end if;
  v_plan := app_private.plan_for_items(v_item.plan_id);
  if not (v_item.created_by = v_uid or app_private.can_manage_plan(v_plan)) then
    perform app_private.forbid();
  end if;
  perform app_private.rate_limit('plan_item_remove', 60, interval '1 hour');
  delete from public.plan_items i where i.id = p_item_id;
end $$;

-- Wer die Crew verlässt (freiwillig, entfernt, Kontolöschung), gibt Zusagen bei kommenden Plänen frei.
create function app_private.release_plan_items_on_leave() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.plan_items i
  set claimed_by = null, claimed_at = null
  from public.plans p
  where i.plan_id = p.id and p.crew_id = old.crew_id and i.claimed_by = old.user_id
    and p.status not in ('completed', 'cancelled') and p.starts_at > now();
  return old;
end $$;
create trigger crew_members_release_plan_items after delete on public.crew_members
  for each row execute function app_private.release_plan_items_on_leave();

revoke all on function app_private.plan_for_items(uuid) from public, anon, authenticated;
revoke all on function app_private.release_plan_items_on_leave() from public, anon, authenticated;
revoke all on function public.add_plan_item(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.claim_plan_item(uuid, boolean) from public, anon, authenticated;
revoke all on function public.remove_plan_item(uuid) from public, anon, authenticated;
grant execute on function public.add_plan_item(uuid, text, boolean) to authenticated, service_role;
grant execute on function public.claim_plan_item(uuid, boolean) to authenticated, service_role;
grant execute on function public.remove_plan_item(uuid) to authenticated, service_role;

-- ---- Datenexport ------------------------------------------------------------------------------
-- Wie bisher (Stand P4 Etappe 3), dazu was die Person auf Mitbring-Listen eingetragen oder zugesagt hat.
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
