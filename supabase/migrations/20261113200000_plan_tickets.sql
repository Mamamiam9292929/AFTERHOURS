-- P53 · „Habt ihr alle Tickets?“ – Ticket-Check je Plan
-- Bei Konzert, Kino, Festival oder Fußball kauft meist jede:r sein Ticket selbst. Im Gruppenchat fragt dann
-- wochenlang jemand „habt ihr alle schon Tickets?“ – und am Abend steht doch einer ohne da. Wer organisiert (oder
-- Owner/Admin ist), schaltet für den Plan „Jede:r braucht ein Ticket“ ein. Danach sagt jede:r aus der Crew mit einem
-- Tipp „Hab mein Ticket“; alle sehen, wer schon eins hat und wer noch nicht.
--
-- Bewusst so gebaut:
--   * Nur die eigene Angabe, nur Mitglieder mit einer Zeile in `plan_participants`, nur solange der Plan weder
--     abgeschlossen noch abgesagt ist und der Ticket-Check an ist. Keine Kaufabwicklung, kein Link nach außen –
--     AFTERHOURS behauptet nichts über Tickets, es zeigt nur, was die Leute selbst sagen.
--   * Die Angabe hängt nicht an der Antwort: Wer ein Ticket hat und dann absagt, behält die Angabe – die Crew sieht
--     „hat ein Ticket übrig“. Das ist im Gruppenchat die zweithäufigste Ticket-Frage („wer will meins?“).
--   * Ausschalten löscht keine Angaben; wieder einschalten zeigt den alten Stand.
--   * Keine Benachrichtigung in Etappe 1 (Nachfragen bei „noch ohne Ticket“ folgt als Etappe 2).

alter table public.plans
  add column tickets_needed boolean not null default false;
comment on column public.plans.tickets_needed is
  'P53: Ticket-Check an – jede:r braucht ein eigenes Ticket, die Crew sieht, wer schon eins hat.';

alter table public.plan_participants
  add column has_ticket boolean not null default false;
comment on column public.plan_participants.has_ticket is
  'P53: Person sagt, sie hat ihr Ticket (nur eigene Angabe, über set_my_plan_ticket).';

-- Ticket-Check ein- oder ausschalten (Organisator:in, Owner, Admin). Liefert den gespeicherten Stand.
create function public.set_plan_tickets_needed(p_plan_id uuid, p_needed boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id for update;
  if not found or not app_private.can_manage_plan(v_plan) then
    perform app_private.forbid();
  end if;
  if v_plan.status in ('completed', 'cancelled') then
    perform app_private.fail('plan_locked');
  end if;
  if p_needed is null then
    perform app_private.fail('invalid_input');
  end if;
  if p_needed = v_plan.tickets_needed then
    return p_needed;
  end if;
  perform app_private.rate_limit('plan_tickets_needed', 30, interval '1 hour');

  update public.plans p set tickets_needed = p_needed where p.id = p_plan_id;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, crew_id, meta)
  values (v_uid, 'plan_tickets_needed_set', 'plan', p_plan_id, v_plan.crew_id, jsonb_build_object('tickets_needed', p_needed));
  return p_needed;
end $$;
revoke all on function public.set_plan_tickets_needed(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_plan_tickets_needed(uuid, boolean) to authenticated;
comment on function public.set_plan_tickets_needed(uuid, boolean) is
  'P53: Ticket-Check für einen Plan ein- oder ausschalten (Organisator:in, Owner, Admin).';

-- Eigene Angabe „Hab mein Ticket“ setzen oder zurücknehmen. Liefert den gespeicherten Stand.
create function public.set_my_plan_ticket(p_plan_id uuid, p_has boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
  v_row public.plan_participants%rowtype;
begin
  select * into v_plan from public.plans p where p.id = p_plan_id;
  if not found or not app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.forbid();
  end if;
  if v_plan.status in ('completed', 'cancelled') then
    perform app_private.fail('plan_locked');
  end if;
  if not v_plan.tickets_needed then
    perform app_private.fail('plan_tickets_off');
  end if;
  if p_has is null then
    perform app_private.fail('invalid_input');
  end if;

  select pp.* into v_row from public.plan_participants pp
  where pp.plan_id = p_plan_id and pp.user_id = v_uid
  for update;
  if v_row.user_id is null then
    perform app_private.fail('plan_ticket_not_invited');
  end if;
  if v_row.has_ticket = p_has then
    return p_has;
  end if;
  perform app_private.rate_limit('plan_ticket', 30, interval '1 hour');

  update public.plan_participants pp set has_ticket = p_has
  where pp.plan_id = p_plan_id and pp.user_id = v_uid;
  return p_has;
end $$;
revoke all on function public.set_my_plan_ticket(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_my_plan_ticket(uuid, boolean) to authenticated;
comment on function public.set_my_plan_ticket(uuid, boolean) is
  'P53: „Hab mein Ticket“ – eigene Angabe beim Ticket-Check eines Plans.';

-- Datenexport: die eigene Ticket-Angabe steht bei den Plänen dabei (sonst unverändert gegenüber 20261113110000).
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
    'plans', coalesce((select jsonb_agg(jsonb_build_object('plan_id', pl.id, 'title', pl.title, 'starts_at', pl.starts_at, 'attendance_status', pp.attendance_status, 'note', pp.note, 'plus_ones', pp.plus_ones, 'has_ticket', pp.has_ticket,
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
