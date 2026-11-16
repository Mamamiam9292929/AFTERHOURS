-- P55 Etappe 1 · „Ich besorg die Tickets“ – Sammelkauf im Ticket-Check
-- Oft kauft eine Person für mehrere (Gruppenrabatt, nur ein Konto beim Anbieter). Im Gruppenchat steht dann „Bob holt
-- für Lisa und Tom mit“ – und im Ticket-Check (P53) stehen Lisa und Tom trotzdem bei „Noch ohne Ticket“ und werden
-- nachgefragt. Jetzt tippt Bob im Ticket-Stand „Ich besorg welche“ und wählt Personen ohne Ticket aus der Zusageliste.
-- Bei ihnen steht „Bob besorgt dein Ticket“; sobald Bob „Gekauft“ tippt, haben sie ein Ticket („Ticket von Bob“).
--
-- Bewusst so gebaut:
--   * AFTERHOURS kauft nichts, kennt keinen Preis und verlinkt keinen Anbieter – es hält nur fest, was Bob sagt.
--     Den Betrag bei „Kosten teilen“ (P3) einzutragen folgt als Etappe 2.
--   * Besorgen nur, wer selbst zugesagt hat (nicht auf der Nachrückliste), nur für Mitglieder der Crew mit Zusage
--     (nicht auf der Nachrückliste) und ohne Ticket, die noch niemand anderes übernommen hat; nicht für sich selbst,
--     höchstens 30 Personen. Nur bei eingeschaltetem Ticket-Check, nur vor Beginn, nicht bei abgeschlossenen oder
--     abgesagten Plänen. `set_plan_ticket_buys` setzt die ganze Liste (hinzufügen und wieder abgeben in einem).
--   * Die eigene Angabe der Person hat Vorrang: Sagt sie selbst „Hab mein Ticket“ / „Noch keins“ oder nimmt ein
--     angebotenes Ticket (P54), ist Bobs Übernahme weg (Trigger). Nur „Gekauft“ setzt das Ticket mit Bob als Quelle.
--   * Absage gibt frei: Wer nicht mehr zusagt, wird von Bob nicht mehr mitgezählt; sagt Bob ab oder verlässt die Crew,
--     sind alle seine noch nicht gekauften Übernahmen weg. Schon gekaufte bleiben („Ticket von Bob“).
--   * Kein neuer Benachrichtigungstyp: `plan_reminder` mit `ticket_buy` bzw. `ticket_bought` im Payload; „Nachfragen“
--     (P53 Etappe 2a) fragt niemanden, dessen Ticket gerade jemand besorgt.
--   * Gäste über den Teilen-Link bleiben in dieser Etappe außen vor.

alter table public.plan_participants
  add column ticket_by uuid references public.profiles (id) on delete set null;
comment on column public.plan_participants.ticket_by is
  'P55: wer das Ticket dieser Person besorgt (ohne Ticket: übernommen, mit Ticket: gekauft). Nur über set_plan_ticket_buys/mark_plan_tickets_bought.';
create index plan_participants_ticket_by_idx on public.plan_participants (plan_id, ticket_by) where ticket_by is not null;

-- Eigene Angabe hat Vorrang; wer nicht mehr zusagt, wird nicht mehr mitbesorgt.
create function app_private.plan_participant_ticket_by_reset() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.ticket_by is null then
    return new;
  end if;
  if new.has_ticket is distinct from old.has_ticket
     and coalesce(current_setting('app.plan_ticket_bought', true), '') <> new.plan_id::text then
    new.ticket_by := null;
  elsif not new.has_ticket and (new.attendance_status <> 'going' or new.waitlisted_at is not null) then
    new.ticket_by := null;
  end if;
  return new;
end $$;
revoke all on function app_private.plan_participant_ticket_by_reset() from public, anon, authenticated;

create trigger plan_participants_ticket_by_reset
  before update of attendance_status, has_ticket, waitlisted_at on public.plan_participants
  for each row execute function app_private.plan_participant_ticket_by_reset();

-- Sagt die besorgende Person ab (oder verlässt die Crew), sind ihre noch nicht gekauften Übernahmen weg.
create function app_private.plan_participant_ticket_buyer_gone() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.attendance_status = 'going' and new.waitlisted_at is null then
    return new;
  end if;
  update public.plan_participants pp set ticket_by = null
  where pp.plan_id = old.plan_id and pp.ticket_by = old.user_id and not pp.has_ticket;
  return coalesce(new, old);
end $$;
revoke all on function app_private.plan_participant_ticket_buyer_gone() from public, anon, authenticated;

create trigger plan_participants_ticket_buyer_gone
  after update of attendance_status, waitlisted_at or delete on public.plan_participants
  for each row execute function app_private.plan_participant_ticket_buyer_gone();

-- ---------------------------------------------------------------------------------------------
-- „Ich besorg welche“: Liste der Personen setzen, deren Ticket die aufrufende Person besorgt. Neu Übernommene
-- bekommen Bescheid, nicht mehr Gelistete sind wieder frei. Liefert die Zahl der offenen Übernahmen.
-- ---------------------------------------------------------------------------------------------
create function public.set_plan_ticket_buys(p_plan_id uuid, p_user_ids uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
  v_me public.plan_participants%rowtype;
  v_ids uuid[];
  v_row record;
  v_count integer;
begin
  perform app_private.rate_limit('set_plan_ticket_buys', 30, interval '1 hour');

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
  if v_plan.starts_at <= now() then
    perform app_private.fail('plan_plus_ones_started');
  end if;
  if p_user_ids is null or array_position(p_user_ids, null) is not null or v_uid = any(p_user_ids) then
    perform app_private.fail('invalid_input');
  end if;
  v_ids := array(select distinct u from unnest(p_user_ids) u);
  if cardinality(v_ids) > 30 then
    perform app_private.fail('invalid_input');
  end if;

  -- Alle betroffenen Zeilen in fester Reihenfolge sperren – zwei gleichzeitig Besorgende übernehmen niemanden doppelt.
  perform 1 from public.plan_participants pp
  where pp.plan_id = p_plan_id and (pp.user_id = v_uid or pp.user_id = any(v_ids) or pp.ticket_by = v_uid)
  order by pp.user_id
  for update;

  select pp.* into v_me from public.plan_participants pp where pp.plan_id = p_plan_id and pp.user_id = v_uid;
  if v_me.user_id is null or v_me.attendance_status <> 'going' or v_me.waitlisted_at is not null then
    perform app_private.fail('plan_ticket_buy_not_going');
  end if;

  if exists (
    select 1 from unnest(v_ids) u
    where not exists (
      select 1 from public.plan_participants pp
      join public.crew_members m on m.crew_id = v_plan.crew_id and m.user_id = pp.user_id
      where pp.plan_id = p_plan_id and pp.user_id = u and pp.attendance_status = 'going' and pp.waitlisted_at is null
        and not pp.has_ticket and (pp.ticket_by is null or pp.ticket_by = v_uid))
  ) then
    perform app_private.fail('plan_ticket_buy_unavailable');
  end if;

  update public.plan_participants pp set ticket_by = null
  where pp.plan_id = p_plan_id and pp.ticket_by = v_uid and not pp.has_ticket and pp.user_id <> all(v_ids);

  for v_row in
    update public.plan_participants pp set ticket_by = v_uid
    where pp.plan_id = p_plan_id and pp.user_id = any(v_ids) and pp.ticket_by is null
    returning pp.user_id
  loop
    perform app_private.notify(v_row.user_id, 'plan_reminder', v_uid, v_plan.crew_id, 'plan', p_plan_id,
                               jsonb_build_object('title', v_plan.title, 'starts_at', v_plan.starts_at, 'ticket_buy', true),
                               'plan_ticket_buy:' || p_plan_id::text || ':' || v_row.user_id::text || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'));
  end loop;

  select count(*) into v_count from public.plan_participants pp
  where pp.plan_id = p_plan_id and pp.ticket_by = v_uid and not pp.has_ticket;
  return v_count;
end $$;
revoke all on function public.set_plan_ticket_buys(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.set_plan_ticket_buys(uuid, uuid[]) to authenticated;
comment on function public.set_plan_ticket_buys(uuid, uuid[]) is
  'P55: „Ich besorg welche“ – Personen mit Zusage ohne Ticket übernehmen (ganze Liste; leere Liste gibt alle wieder ab).';

-- ---------------------------------------------------------------------------------------------
-- „Gekauft“: Alle offenen Übernahmen der aufrufenden Person haben jetzt ein Ticket (Quelle bleibt stehen). Die
-- Personen bekommen Bescheid. Liefert die Zahl. Auch nach Beginn möglich (Abendkasse).
-- ---------------------------------------------------------------------------------------------
create function public.mark_plan_tickets_bought(p_plan_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
  v_row record;
  v_count integer := 0;
begin
  perform app_private.rate_limit('mark_plan_tickets_bought', 20, interval '1 hour');

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

  perform 1 from public.plan_participants pp
  where pp.plan_id = p_plan_id and pp.ticket_by = v_uid and not pp.has_ticket
  order by pp.user_id
  for update;

  perform set_config('app.plan_ticket_bought', p_plan_id::text, true);
  for v_row in
    update public.plan_participants pp set has_ticket = true
    where pp.plan_id = p_plan_id and pp.ticket_by = v_uid and not pp.has_ticket
      and exists (select 1 from public.crew_members m where m.crew_id = v_plan.crew_id and m.user_id = pp.user_id)
    returning pp.user_id
  loop
    perform app_private.notify(v_row.user_id, 'plan_reminder', v_uid, v_plan.crew_id, 'plan', p_plan_id,
                               jsonb_build_object('title', v_plan.title, 'starts_at', v_plan.starts_at, 'ticket_bought', true),
                               'plan_ticket_bought:' || p_plan_id::text || ':' || v_row.user_id::text || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'));
    v_count := v_count + 1;
  end loop;
  perform set_config('app.plan_ticket_bought', '', true);

  if v_count = 0 then
    perform app_private.fail('plan_ticket_buy_none');
  end if;
  return v_count;
end $$;
revoke all on function public.mark_plan_tickets_bought(uuid) from public, anon, authenticated;
grant execute on function public.mark_plan_tickets_bought(uuid) to authenticated;
comment on function public.mark_plan_tickets_bought(uuid) is
  'P55: „Gekauft“ – alle, deren Ticket die aufrufende Person besorgt, haben jetzt eins („Ticket von …“).';

-- ---------------------------------------------------------------------------------------------
-- Nachfragen (P53 Etappe 2a): niemanden fragen, dessen Ticket gerade jemand besorgt (sonst unverändert gegenüber
-- 20261113220000).
-- ---------------------------------------------------------------------------------------------
create or replace function public.remind_plan_tickets(p_plan_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
  v_member record;
  v_count integer := 0;
begin
  perform app_private.rate_limit('remind_plan_tickets', 30, interval '1 hour');

  select * into v_plan from public.plans p where p.id = p_plan_id;
  if not found or not app_private.can_manage_plan(v_plan) then
    perform app_private.forbid();
  end if;
  if v_plan.status in ('completed', 'cancelled') then
    perform app_private.fail('plan_locked');
  end if;
  if not v_plan.tickets_needed then
    perform app_private.fail('plan_tickets_off');
  end if;
  if v_plan.starts_at <= now() then
    perform app_private.fail('plan_already_started');
  end if;

  -- Sperrt die Zeile je Plan – zwei gleichzeitige Tipps fragen nicht doppelt.
  insert into public.plan_reminders (plan_id, last_sent_at) values (p_plan_id, '-infinity')
  on conflict (plan_id) do nothing;
  perform 1 from public.plan_reminders r where r.plan_id = p_plan_id for update;
  if exists (select 1 from public.plan_reminders r
             where r.plan_id = p_plan_id and r.ticket_sent_at > now() - interval '6 hours') then
    perform app_private.fail('reminder_too_soon');
  end if;

  for v_member in
    select pp.user_id from public.plan_participants pp
    join public.crew_members m on m.crew_id = v_plan.crew_id and m.user_id = pp.user_id
    where pp.plan_id = p_plan_id and pp.attendance_status = 'going' and not pp.has_ticket
      and pp.waitlisted_at is null and pp.ticket_by is null and pp.user_id <> v_uid
    order by pp.user_id
  loop
    perform app_private.notify(v_member.user_id, 'plan_reminder', v_uid, v_plan.crew_id, 'plan', p_plan_id,
                               jsonb_build_object('title', v_plan.title, 'starts_at', v_plan.starts_at, 'ticket', true),
                               'plan_reminder_ticket:' || p_plan_id::text || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    update public.plan_reminders r set ticket_sent_at = now() where r.plan_id = p_plan_id;
  end if;
  return v_count;
end $$;

-- Datenexport: bei den eigenen Plänen steht, wer das Ticket besorgt (sonst unverändert gegenüber 20261113200000).
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
    'plans', coalesce((select jsonb_agg(jsonb_build_object('plan_id', pl.id, 'title', pl.title, 'starts_at', pl.starts_at, 'attendance_status', pp.attendance_status, 'note', pp.note, 'plus_ones', pp.plus_ones, 'has_ticket', pp.has_ticket, 'ticket_by', pp.ticket_by,
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
