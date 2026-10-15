-- =============================================================================================
-- AFTERHOURS – Termin-Abstimmung teilen (Roadmap P1, Etappe 2)
--
-- Geteilte Termin-Abstimmungen sollen im Gruppenchat und auf dem Stimmzettel als Termine erscheinen:
--   * preview_shared_poll liefert zusätzlich die Art („kind“) und – nur bei Termin-Abstimmungen – die
--     Termine („dates“: Datum, Uhrzeit oder null). Termine enthalten weder Namen noch Orte; bei
--     Orts-Abstimmungen bleibt es bei Frage, Frist und Zahlen (Vorschläge im Wortlaut bleiben in der Crew).
--   * shared_poll_ballot liefert zusätzlich die Art, damit der Stimmzettel „Wann kannst du?“ fragt.
-- Sonst unverändert gegenüber 20261014160000 (Vorschau) bzw. 20261014220000 (Stimmzettel).
-- Rechte bleiben bei create or replace erhalten.
-- =============================================================================================

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
      'guests', v_open and v_poll.guests_allowed,
      'kind', v_poll.kind)
      -- P1: Bei Termin-Abstimmungen gehören die Termine in die Einladung (keine Namen, keine Orte).
      || case when v_poll.kind = 'date' then jsonb_build_object('dates', coalesce((
           select jsonb_agg(jsonb_build_object('date', o.proposed_date, 'time', to_char(o.proposed_time, 'HH24:MI'))
                            order by o.proposed_date, o.proposed_time nulls first)
           from public.poll_options o where o.poll_id = v_poll.id and o.proposed_date is not null), '[]'::jsonb))
         else '{}'::jsonb end,
    'poll_id', case when auth.uid() is not null and app_private.is_crew_member(v_poll.crew_id) then v_poll.id end);
end $$;

create or replace function public.shared_poll_ballot(p_token text, p_secret text default null) returns jsonb
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
      'open', v_poll.status = 'open' and v_poll.ends_at > now(),
      'can_join', app_private.poll_guest_join_open(v_poll),
      'kind', v_poll.kind),
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
