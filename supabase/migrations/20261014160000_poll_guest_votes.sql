-- W3 Etappe 1 · Mitstimmen ohne Konto per Link
-- Wer eine Abstimmung erstellt hat (oder Owner/Admin der Crew ist), kann „Gäste dürfen mitstimmen“
-- einschalten. Dann sehen Freunde ohne Konto über den Teilen-Link /v/<token> (W2 Etappe 2) die
-- Vorschläge, geben einen Namen ein und stimmen ab. Ihre Stimmen zählen wie die der Crew.
--
-- Bewusst so gebaut:
--   * Standard ist aus. Erst mit dem Schalter zeigt der Link die Vorschläge im Wortlaut (eigene
--     Vorschläge wie „Grillen bei Bob“ enthalten Namen) – wer einschaltet, sieht das im Hinweistext.
--   * Gäste sehen nur, was sie zum Abstimmen brauchen: Frage, Frist, Vorschläge mit Termin und die
--     Zahl der Antworten je Vorschlag. Keine Namen der Crew, keine IDs, kein Treffpunkt, kein Budget,
--     keine Beschreibung, kein Crew-Name.
--   * Ein Gast ist ein Geheimnis (64 Hex-Zeichen), das nur auf seinem Gerät liegt; gespeichert wird
--     nur der SHA-256-Hash. Mit demselben Geheimnis lässt sich die eigene Antwort ändern.
--   * Missbrauchsschutz: höchstens 30 Gäste je Abstimmung, 30 neue Gäste je Link und Stunde,
--     300 Stimmabgaben je Link in 10 Minuten. Ersteller:in und Owner/Admin können Gäste entfernen.
--   * Gäste haben kein Konto: Name und Antworten verschwinden mit der Abstimmung.

alter table public.polls add column guests_allowed boolean not null default false;

create table public.poll_guests (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls (id) on delete cascade,
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  display_name text not null check (char_length(display_name) between 2 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (poll_id, secret_hash)
);

create table public.poll_guest_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls (id) on delete cascade,
  poll_option_id uuid not null references public.poll_options (id) on delete cascade,
  guest_id uuid not null references public.poll_guests (id) on delete cascade,
  response public.vote_response not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (poll_option_id, guest_id)
);
create index poll_guest_votes_poll_idx on public.poll_guest_votes (poll_id);
create index poll_guest_votes_guest_idx on public.poll_guest_votes (guest_id);

alter table public.poll_guests enable row level security;
alter table public.poll_guest_votes enable row level security;
revoke all on table public.poll_guests, public.poll_guest_votes from public, anon, authenticated;

-- Die Crew sieht Namen und Antworten der Gäste ihrer Abstimmungen – nie den Hash des Geheimnisses.
create policy poll_guests_select_member on public.poll_guests for select to authenticated
  using (app_private.can_access_poll(poll_id));
create policy poll_guest_votes_select_member on public.poll_guest_votes for select to authenticated
  using (app_private.can_access_poll(poll_id));
grant select (id, poll_id, display_name, created_at) on public.poll_guests to authenticated;
grant select on public.poll_guest_votes to authenticated;
grant all on public.poll_guests, public.poll_guest_votes to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.poll_guest_votes;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Gemeinsame Bausteine
-- ---------------------------------------------------------------------------------------------
-- Zusagen je Option: Crew und Gäste zusammen. Grundlage für Ergebnis und Stichwahl.
create function app_private.poll_yes_counts(p_poll_id uuid) returns table (option_id uuid, yes_count bigint)
language sql stable security definer set search_path = '' as $$
  select o.id,
         (select count(*) from public.poll_votes v where v.poll_option_id = o.id and v.response = 'yes')
       + (select count(*) from public.poll_guest_votes g where g.poll_option_id = o.id and g.response = 'yes')
  from public.poll_options o
  where o.poll_id = p_poll_id;
$$;

-- Abstimmung zu einem Teilen-Link (oder NULL). Nur gültige Tokens werden gesucht.
create function app_private.poll_by_share_token(p_token text) returns public.polls
language plpgsql stable security definer set search_path = '' as $$
declare
  v_poll public.polls;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then
    return null;
  end if;
  select p.* into v_poll
  from public.poll_share_links l join public.polls p on p.id = l.poll_id
  where l.token = p_token;
  return v_poll;
end $$;

revoke all on function app_private.poll_yes_counts(uuid), app_private.poll_by_share_token(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Ergebnis und Stichwahl zählen Gäste mit (ersetzt die Fassung aus 20261011100200_internals.sql)
-- ---------------------------------------------------------------------------------------------
create or replace function app_private.close_poll_internal(p_poll_id uuid, p_closed_by uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_poll public.polls%rowtype;
  v_max bigint;
  v_top_count bigint;
  v_winner uuid;
  v_winner_title text;
begin
  select * into v_poll from public.polls p where p.id = p_poll_id for update;
  if not found or v_poll.status = 'closed' then
    return;
  end if;

  with counts as (
    select c.option_id as id, c.yes_count from app_private.poll_yes_counts(p_poll_id) c
  ), top as (
    select coalesce(max(yes_count), 0) as max_yes from counts
  )
  select t.max_yes, count(*) filter (where c.yes_count = t.max_yes), (min(c.id::text) filter (where c.yes_count = t.max_yes))::uuid
  into v_max, v_top_count, v_winner
  from counts c cross join top t
  group by t.max_yes;

  if coalesce(v_max, 0) = 0 or v_top_count > 1 then
    v_winner := null;
  end if;

  update public.polls p
  set status = 'closed', closed_at = now(), closed_by = p_closed_by,
      winning_option_id = v_winner, is_tie = (coalesce(v_max, 0) > 0 and v_top_count > 1)
  where p.id = p_poll_id;

  select o.title into v_winner_title from public.poll_options o where o.id = v_winner;

  perform app_private.notify_crew(
    v_poll.crew_id, 'poll_result', p_closed_by, 'poll', p_poll_id,
    jsonb_build_object('title', v_poll.title, 'winner_title', v_winner_title,
                       'is_tie', (coalesce(v_max, 0) > 0 and v_top_count > 1), 'yes_count', coalesce(v_max, 0)),
    'poll_result:' || p_poll_id::text, p_closed_by is null
  );

  insert into public.audit_log (actor_id, action, entity_type, entity_id, crew_id, meta)
  values (p_closed_by, 'poll_closed', 'poll', p_poll_id, v_poll.crew_id,
          jsonb_build_object('winning_option_id', v_winner, 'automatic', p_closed_by is null));
end $$;

-- Stichwahl: wie bisher, gleichauf zählt mit Gästen; der Gäste-Schalter wird übernommen.
create or replace function public.start_runoff_poll(p_poll_id uuid, p_title text, p_ends_at timestamptz) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_poll public.polls%rowtype;
  v_title text := app_private.clean_line(p_title, 80);
  v_new_id uuid;
begin
  select * into v_poll from public.polls p where p.id = p_poll_id;
  if not found or not app_private.is_crew_member(v_poll.crew_id) then
    perform app_private.forbid();
  end if;
  if not (v_poll.created_by is not distinct from v_uid
          or app_private.has_crew_role(v_poll.crew_id, array['owner', 'admin']::public.crew_role[])) then
    perform app_private.forbid();
  end if;
  if v_poll.status <> 'closed' or not v_poll.is_tie then
    perform app_private.fail('no_tie');
  end if;
  if exists (select 1 from public.polls c where c.parent_poll_id = p_poll_id) then
    perform app_private.fail('runoff_exists');
  end if;
  if v_title is null or char_length(v_title) < 3 then
    perform app_private.fail('invalid_title');
  end if;
  if p_ends_at is null or p_ends_at <= now() then
    perform app_private.fail('ends_in_past');
  end if;
  if p_ends_at > now() + interval '90 days' then
    perform app_private.fail('ends_too_late');
  end if;
  perform app_private.rate_limit('create_poll', 20, interval '1 hour');

  insert into public.polls (crew_id, created_by, parent_poll_id, title, description, meeting_point, budget_cents, min_participants, ends_at, guests_allowed)
  values (v_poll.crew_id, v_uid, p_poll_id, v_title, v_poll.description, v_poll.meeting_point, v_poll.budget_cents, v_poll.min_participants, p_ends_at, v_poll.guests_allowed)
  returning id into v_new_id;

  with counts as (
    select c.option_id as id, c.yes_count from app_private.poll_yes_counts(p_poll_id) c
  )
  insert into public.poll_options (poll_id, activity_id, title, proposed_date, proposed_time, estimated_price_cents, position)
  select v_new_id, o.activity_id, o.title, o.proposed_date, o.proposed_time, o.estimated_price_cents, o.position
  from public.poll_options o join counts c on c.id = o.id
  where c.yes_count = (select max(yes_count) from counts)
  order by o.position;

  perform app_private.notify_crew(v_poll.crew_id, 'poll_created', v_uid, 'poll', v_new_id,
                                  jsonb_build_object('title', v_title, 'runoff', true), 'poll_created:' || v_new_id::text);
  return v_new_id;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Vorschau des Teilen-Links: Gäste zählen bei „x haben abgestimmt“ mit; neu ist nur „guests“
-- (true = Mitstimmen ohne Konto ist gerade möglich). Ersetzt die Fassung aus 20261014120000.
-- ---------------------------------------------------------------------------------------------
create or replace function public.preview_shared_poll(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_poll public.polls;
  v_open boolean;
begin
  v_poll := app_private.poll_by_share_token(p_token);
  if v_poll.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if least(coalesce(v_poll.closed_at, v_poll.ends_at), v_poll.ends_at) < now() - interval '3 days' then
    return jsonb_build_object('status', 'expired');
  end if;

  perform app_private.rate_limit_key(p_token, 'poll_share_public', 120, interval '10 minutes');
  v_open := v_poll.status = 'open' and v_poll.ends_at > now();

  return jsonb_build_object(
    'status', 'valid',
    'poll', jsonb_build_object(
      'title', v_poll.title,
      'ends_at', v_poll.ends_at,
      'status', case when v_open then 'open' else 'closed' end,
      'option_count', (select count(*) from public.poll_options o where o.poll_id = v_poll.id),
      'voter_count', (select count(distinct v.user_id) from public.poll_votes v where v.poll_id = v_poll.id)
                   + (select count(distinct g.guest_id) from public.poll_guest_votes g where g.poll_id = v_poll.id),
      'guests', v_open and v_poll.guests_allowed),
    'poll_id', case when auth.uid() is not null and app_private.is_crew_member(v_poll.crew_id) then v_poll.id end);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Für die Crew: Schalter und Gäste entfernen
-- ---------------------------------------------------------------------------------------------
create function public.set_poll_guests(p_poll_id uuid, p_allowed boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_poll public.polls%rowtype;
begin
  select * into v_poll from public.polls p where p.id = p_poll_id for update;
  if not found or not app_private.is_crew_member(v_poll.crew_id) then
    perform app_private.forbid();
  end if;
  if not (v_poll.created_by is not distinct from v_uid
          or app_private.has_crew_role(v_poll.crew_id, array['owner', 'admin']::public.crew_role[])) then
    perform app_private.forbid();
  end if;
  if p_allowed is null then
    perform app_private.fail('invalid_input');
  end if;
  if v_poll.status <> 'open' or v_poll.ends_at <= now() then
    perform app_private.fail('poll_closed');
  end if;
  if v_poll.guests_allowed = p_allowed then
    return;
  end if;
  perform app_private.rate_limit('poll_guests_toggle', 30, interval '1 hour');

  update public.polls p set guests_allowed = p_allowed where p.id = p_poll_id;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, crew_id, meta)
  values (v_uid, 'poll_guests', 'poll', p_poll_id, v_poll.crew_id, jsonb_build_object('allowed', p_allowed));
end $$;

create function public.remove_poll_guest(p_guest_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_poll public.polls%rowtype;
begin
  select p.* into v_poll
  from public.poll_guests g join public.polls p on p.id = g.poll_id
  where g.id = p_guest_id;
  if not found or not app_private.is_crew_member(v_poll.crew_id) then
    perform app_private.forbid();
  end if;
  if not (v_poll.created_by is not distinct from v_uid
          or app_private.has_crew_role(v_poll.crew_id, array['owner', 'admin']::public.crew_role[])) then
    perform app_private.forbid();
  end if;
  -- Ein festgestelltes Ergebnis bleibt, wie es ist.
  if v_poll.status <> 'open' or v_poll.ends_at <= now() then
    perform app_private.fail('poll_closed');
  end if;

  delete from public.poll_guests g where g.id = p_guest_id;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, crew_id, meta)
  values (v_uid, 'poll_guest_removed', 'poll', v_poll.id, v_poll.crew_id, '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Ohne Konto: Stimmzettel lesen und abstimmen
-- ---------------------------------------------------------------------------------------------
-- Stimmzettel zum Link. p_secret (optional) erkennt einen Gast wieder, der schon abgestimmt hat.
--   not_found / expired  – wie bei der Vorschau
--   guests_off           – Gäste dürfen (nicht mehr) mitstimmen; sonst nichts
--   valid                – Frage, Frist, open, Vorschläge (key = Position) mit Zahl der Antworten,
--                          me = eigener Name und eigene Antworten oder null
create function public.shared_poll_ballot(p_token text, p_secret text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_poll public.polls;
  v_guest public.poll_guests;
begin
  v_poll := app_private.poll_by_share_token(p_token);
  if v_poll.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if least(coalesce(v_poll.closed_at, v_poll.ends_at), v_poll.ends_at) < now() - interval '3 days' then
    return jsonb_build_object('status', 'expired');
  end if;

  perform app_private.rate_limit_key(p_token, 'poll_guest_ballot', 240, interval '10 minutes');
  if not v_poll.guests_allowed then
    return jsonb_build_object('status', 'guests_off');
  end if;

  if p_secret ~ '^[0-9a-f]{64}$' then
    select g.* into v_guest from public.poll_guests g
    where g.poll_id = v_poll.id and g.secret_hash = app_private.hash_token(p_secret);
  end if;

  return jsonb_build_object(
    'status', 'valid',
    'poll', jsonb_build_object(
      'title', v_poll.title,
      'ends_at', v_poll.ends_at,
      'open', v_poll.status = 'open' and v_poll.ends_at > now()),
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', o.position,
               'title', o.title,
               'proposed_date', o.proposed_date,
               'proposed_time', left(o.proposed_time::text, 5),
               'yes', r.yes, 'maybe', r.maybe, 'no', r.no) order by o.position)
      from public.poll_options o
      cross join lateral (
        select count(*) filter (where x.response = 'yes') as yes,
               count(*) filter (where x.response = 'maybe') as maybe,
               count(*) filter (where x.response = 'no') as no
        from (select v.response from public.poll_votes v where v.poll_option_id = o.id
              union all
              select g.response from public.poll_guest_votes g where g.poll_option_id = o.id) x
      ) r
      where o.poll_id = v_poll.id), '[]'::jsonb),
    'me', case when v_guest.id is null then null else jsonb_build_object(
      'name', v_guest.display_name,
      'votes', coalesce((
        select jsonb_object_agg(o.position::text, g.response)
        from public.poll_guest_votes g join public.poll_options o on o.id = g.poll_option_id
        where g.guest_id = v_guest.id), '{}'::jsonb)) end);
end $$;

-- Abstimmen als Gast. p_votes: {"<key>": "yes" | "maybe" | "no" | null, …} – null zieht die Antwort
-- zurück, fehlende Schlüssel bleiben unverändert. Neue Gäste brauchen mindestens eine Antwort.
create function public.guest_vote_shared_poll(p_token text, p_secret text, p_name text, p_votes jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_poll public.polls;
  v_name text := app_private.clean_line(p_name, 40);
  v_guest_id uuid;
  v_entry record;
  v_option_id uuid;
  v_response public.vote_response;
  v_new boolean := false;
begin
  v_poll := app_private.poll_by_share_token(p_token);
  if v_poll.id is null then
    perform app_private.fail('share_not_found');
  end if;
  if not v_poll.guests_allowed then
    perform app_private.fail('guests_not_allowed');
  end if;
  if v_poll.status <> 'open' or v_poll.ends_at <= now() then
    perform app_private.fail('poll_closed');
  end if;
  -- Mitglieder stimmen in der App ab – nicht zusätzlich als Gast.
  if auth.uid() is not null and app_private.is_crew_member(v_poll.crew_id) then
    perform app_private.fail('already_member');
  end if;
  if p_secret is null or p_secret !~ '^[0-9a-f]{64}$' then
    perform app_private.fail('invalid_input');
  end if;
  if v_name is null or char_length(v_name) < 2 then
    perform app_private.fail('invalid_name');
  end if;
  if p_votes is null or jsonb_typeof(p_votes) <> 'object'
     or (select count(*) from jsonb_object_keys(p_votes)) not between 1 and 10 then
    perform app_private.fail('invalid_input');
  end if;
  -- Erst alles prüfen, dann schreiben: unbekannte Vorschläge oder Antworten ändern gar nichts.
  for v_entry in select key, value from jsonb_each(p_votes) loop
    if v_entry.key !~ '^[0-9]{1,3}$'
       or not exists (select 1 from public.poll_options o where o.poll_id = v_poll.id and o.position = v_entry.key::smallint) then
      perform app_private.fail('invalid_input');
    end if;
    if jsonb_typeof(v_entry.value) <> 'null'
       and (jsonb_typeof(v_entry.value) <> 'string' or v_entry.value #>> '{}' not in ('yes', 'maybe', 'no')) then
      perform app_private.fail('invalid_input');
    end if;
  end loop;

  perform app_private.rate_limit_key(p_token, 'poll_guest_vote', 300, interval '10 minutes');

  select g.id into v_guest_id from public.poll_guests g
  where g.poll_id = v_poll.id and g.secret_hash = app_private.hash_token(p_secret)
  for update;

  if v_guest_id is null then
    if not exists (select 1 from jsonb_each(p_votes) e where jsonb_typeof(e.value) = 'string') then
      perform app_private.fail('invalid_input');
    end if;
    perform 1 from public.polls p where p.id = v_poll.id for update;  -- Obergrenze ohne Wettlauf
    if (select count(*) from public.poll_guests g where g.poll_id = v_poll.id) >= 30 then
      perform app_private.fail('guest_limit');
    end if;
    perform app_private.rate_limit_key(p_token, 'poll_guest_join', 30, interval '1 hour');
    insert into public.poll_guests (poll_id, secret_hash, display_name)
    values (v_poll.id, app_private.hash_token(p_secret), v_name)
    returning id into v_guest_id;
    v_new := true;
  else
    update public.poll_guests g set display_name = v_name, updated_at = now()
    where g.id = v_guest_id and g.display_name is distinct from v_name;
  end if;

  for v_entry in select key, value from jsonb_each(p_votes) loop
    select o.id into v_option_id from public.poll_options o
    where o.poll_id = v_poll.id and o.position = v_entry.key::smallint;
    if jsonb_typeof(v_entry.value) = 'null' then
      delete from public.poll_guest_votes g where g.poll_option_id = v_option_id and g.guest_id = v_guest_id;
    else
      v_response := (v_entry.value #>> '{}')::public.vote_response;
      insert into public.poll_guest_votes (poll_id, poll_option_id, guest_id, response)
      values (v_poll.id, v_option_id, v_guest_id, v_response)
      on conflict (poll_option_id, guest_id)
      do update set response = excluded.response, updated_at = now();
    end if;
  end loop;

  if v_new then
    perform app_private.notify(v_poll.created_by, 'poll_vote', null, v_poll.crew_id, 'poll', v_poll.id,
                               jsonb_build_object('title', v_poll.title, 'guest', v_name),
                               'poll_vote:' || v_poll.id::text || ':guest:' || v_guest_id::text);
  end if;
end $$;

revoke all on function
  public.set_poll_guests(uuid, boolean), public.remove_poll_guest(uuid),
  public.shared_poll_ballot(text, text), public.guest_vote_shared_poll(text, text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.set_poll_guests(uuid, boolean), public.remove_poll_guest(uuid) to authenticated;
grant execute on function public.shared_poll_ballot(text, text), public.guest_vote_shared_poll(text, text, text, jsonb)
  to anon, authenticated;
