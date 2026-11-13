-- P51 · „Ich bring wen mit“ – Begleitung zur Zusage
-- Im Gruppenchat steht unter „bin dabei“ oft „+1“ oder „bring Lisa mit“. In AFTERHOURS ging das bisher nicht:
-- Wer jemanden mitbrachte, schrieb es höchstens als Zusatz (P24) – gezählt wurde die Begleitung nirgends. Die
-- Reservierung war dann zu klein, die Mindestzahl (P25) zu streng und die Höchstzahl (P26) zu großzügig.
-- Jetzt sagt, wer „Bin dabei“ geantwortet hat, mit einem Tipp „+1“, „+2“ oder „+3“.
--
-- Bewusst so gebaut:
--   * Nur die eigene Zusage, nur bei „Bin dabei“, nur Mitglieder der Crew, nur vor Beginn und solange der Plan
--     weder abgeschlossen noch abgesagt ist. Höchstens 3 – mehr ist kein „+1“, sondern eine andere Runde.
--   * Begleitungen sind namenlos (keine Daten über Menschen ohne Konto). Sie gehören zur Zusage: Ändert sich die
--     Antwort (auch durch „Alle neu fragen“, P23, oder das Nachrücken), sind sie weg – ein Trigger erledigt das
--     für jeden Weg.
--   * Gezählt wird überall, wo `app_private.plan_going_count` zählt: Mindestzahl (Bescheid „Findet statt“),
--     Höchstzahl samt Nachrückliste, Vorschau im Messenger. Dazu die Zahlen auf der Zusagekarte für Gäste.
--     Passt die Begleitung nicht mehr in die Höchstzahl, gibt es `plan_full` – niemand wird verdrängt.
--     Weniger Begleitung macht Plätze frei: Die Nachrückliste rückt nach.
--   * Keine Benachrichtigung: Die Crew sieht „+1“ bei „Wer kommt mit?“; Bescheid gibt es nur, wenn dadurch die
--     Mindestzahl erreicht wird oder jemand nachrückt (bestehende Wege).
--   * Etappe 1: nur Mitglieder. Gäste über den Teilen-Link (W10) bringen noch niemanden mit.

alter table public.plan_participants
  add column plus_ones smallint not null default 0 check (plus_ones between 0 and 3);

comment on column public.plan_participants.plus_ones is
  'P51: so viele Begleitungen ohne Konto bringt die Person mit (0–3), nur bei „Bin dabei“.';

-- Begleitung gehört zur Zusage: jede andere Antwort setzt sie zurück.
create function app_private.plan_participant_plus_ones_reset() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.attendance_status is distinct from 'going' then
    new.plus_ones := 0;
  end if;
  return new;
end $$;
revoke all on function app_private.plan_participant_plus_ones_reset() from public, anon, authenticated;

create trigger plan_participants_plus_ones_reset
  before update of attendance_status on public.plan_participants
  for each row execute function app_private.plan_participant_plus_ones_reset();

-- Zusagen inklusive Begleitung (ersetzt 20261105060000; gleiche Signatur, gleiche Rechte).
create or replace function app_private.plan_going_count(p_plan_id uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select (select coalesce(sum(1 + pp.plus_ones), 0) from public.plan_participants pp
          where pp.plan_id = p_plan_id and pp.attendance_status = 'going')::integer
       + (select count(*) from public.plan_guests g where g.plan_id = p_plan_id and g.attendance_status = 'going')::integer;
$$;
revoke all on function app_private.plan_going_count(uuid) from public, anon, authenticated;

-- Begleitung setzen (0–3). Liefert die gespeicherte Zahl.
create function public.set_plan_plus_ones(p_plan_id uuid, p_count integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_plan public.plans%rowtype;
  v_row public.plan_participants%rowtype;
begin
  -- Sperre wie bei jeder Zusage (plan_capacity_guard): zwei gleichzeitige Änderungen zählen nacheinander.
  select * into v_plan from public.plans p where p.id = p_plan_id for update;
  if not found or not app_private.is_crew_member(v_plan.crew_id) then
    perform app_private.forbid();
  end if;
  if v_plan.status in ('completed', 'cancelled') then
    perform app_private.fail('plan_locked');
  end if;
  if v_plan.starts_at <= now() then
    perform app_private.fail('plan_plus_ones_started');
  end if;
  if p_count is null or p_count < 0 or p_count > 3 then
    perform app_private.fail('invalid_input');
  end if;

  select pp.* into v_row from public.plan_participants pp
  where pp.plan_id = p_plan_id and pp.user_id = v_uid
  for update;
  if v_row.user_id is null or v_row.attendance_status <> 'going' then
    perform app_private.fail('plan_plus_ones_not_going');
  end if;
  if p_count = v_row.plus_ones then
    return p_count;
  end if;

  if p_count > v_row.plus_ones and v_plan.max_going is not null
     and app_private.plan_going_count(p_plan_id) - v_row.plus_ones + p_count > v_plan.max_going then
    perform app_private.fail('plan_full');
  end if;

  perform app_private.rate_limit('plan_plus_ones', 30, interval '1 hour');

  update public.plan_participants pp set plus_ones = p_count
  where pp.plan_id = p_plan_id and pp.user_id = v_uid;

  if p_count > v_row.plus_ones then
    perform app_private.check_plan_min_going(p_plan_id);
  else
    perform app_private.promote_plan_waitlist(p_plan_id);
  end if;
  return p_count;
end $$;

revoke all on function public.set_plan_plus_ones(uuid, integer) from public, anon, authenticated;
grant execute on function public.set_plan_plus_ones(uuid, integer) to authenticated;
comment on function public.set_plan_plus_ones(uuid, integer) is
  'P51: „Ich bring wen mit“ – 0–3 Begleitungen zur eigenen Zusage; zählt bei Mindest- und Höchstzahl mit.';

-- Zusagekarte für Gäste: Begleitungen zählen bei „dabei“ mit (sonst unverändert gegenüber 20261113090000).
create or replace function public.shared_plan_rsvp(p_token text, p_secret text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.plans;
  v_guest public.plan_guests;
  v_place text;
begin
  v_plan := app_private.plan_by_share_token(p_token);
  if v_plan.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if coalesce(v_plan.ends_at, v_plan.starts_at) < now() - interval '3 days' then
    return jsonb_build_object('status', 'expired');
  end if;

  perform app_private.rate_limit_key(p_token, 'plan_guest_rsvp_read', 240, interval '10 minutes');
  if not v_plan.guests_allowed then
    return jsonb_build_object('status', 'guests_off');
  end if;

  if p_secret ~ '^[0-9a-f]{64}$' then
    select g.* into v_guest from public.plan_guests g
    where g.plan_id = v_plan.id and g.secret_hash = app_private.hash_token(p_secret);
  end if;
  select a.name into v_place from public.activities a where a.id = v_plan.activity_id;

  return jsonb_build_object(
    'status', 'valid',
    'plan', jsonb_build_object(
      'title', v_plan.title,
      'starts_at', v_plan.starts_at,
      'ends_at', v_plan.ends_at,
      'status', v_plan.status,
      'open', app_private.plan_guests_open(v_plan),
      'place', v_place,
      'address', v_plan.address,
      'meeting_point', v_plan.meeting_point,
      'can_join', app_private.plan_guest_join_open(v_plan),
      -- P50 Etappe 2b: weitere Stationen des Abends (Name, Uhrzeit, Adresse).
      'stops', app_private.plan_stops_json(v_plan.id)),
    'counts', (
      select jsonb_build_object(
               'going', coalesce(sum(x.n) filter (where x.s = 'going'), 0),
               'maybe', count(*) filter (where x.s = 'maybe'))
      from (select pp.attendance_status as s, 1 + pp.plus_ones as n from public.plan_participants pp where pp.plan_id = v_plan.id
            union all
            select g.attendance_status, 1 from public.plan_guests g where g.plan_id = v_plan.id) x),
    'me', case when v_guest.id is null then null else jsonb_strip_nulls(jsonb_build_object(
      'name', v_guest.display_name,
      'status', v_guest.attendance_status,
      'note', v_guest.note,
      'waitlist', case when v_guest.waitlisted_at is not null then app_private.plan_waitlist_position(v_plan.id, null, v_guest.id) end,
      'promoted', case when v_guest.promoted_at is not null and v_guest.attendance_status = 'going' then true end)) end);
end $$;
revoke all on function public.shared_plan_rsvp(text, text) from public, anon, authenticated;
grant execute on function public.shared_plan_rsvp(text, text) to anon, authenticated;

-- Datenexport: die eigene Begleitung steht bei den Plänen dabei (sonst unverändert gegenüber 20261112040000).
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
    'plans', coalesce((select jsonb_agg(jsonb_build_object('plan_id', pl.id, 'title', pl.title, 'starts_at', pl.starts_at, 'attendance_status', pp.attendance_status, 'note', pp.note, 'plus_ones', pp.plus_ones,
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
