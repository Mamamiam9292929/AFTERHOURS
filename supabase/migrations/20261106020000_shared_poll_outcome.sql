-- P28 · „Was draus wurde“ – Ergebnis für Gäste auf dem Abstimm-Link
-- Abstimmungen aus dem Ein-Satz-Start (S1/S2) landen im Gruppenchat, Freunde ohne Konto stimmen über /v/<token>
-- mit. War die Abstimmung vorbei, stand dort bisher nur „Was daraus wird, sieht die Crew in der App“ – wer
-- mitgestimmt hat, erfuhr nie, wofür sich die Runde entschieden hat. Jetzt liefert der Stimmzettel nach dem
-- Ende das Ergebnis mit: welcher Vorschlag gewonnen hat, ob ein Plan daraus wurde (Titel, Zeit, abgesagt) und –
-- nur für Gäste, die mit diesem Gerät mitgestimmt haben – den Teilen-Link des Plans bzw. der Stichwahl, sofern
-- die Crew ihn schon geteilt hat.
--
-- Bewusst so gebaut:
--   * Kein neuer Weg nach außen: Der Stimmzettel zeigt Vorschläge im Wortlaut ohnehin jedem mit dem Link, sobald
--     Gäste mitstimmen dürfen (W3). Gewinner, Titel und Zeit des Plans sind dieselbe Information. Treffpunkt,
--     Adresse, Notizen, Namen und Crew bleiben drin.
--   * Teilen-Links (Plan /s/…, Stichwahl /v/…) gibt es nur für Gäste mit gültigem Geheimnis und nur, wenn ein
--     Mitglied den Link schon erzeugt hat – die Abstimmung legt selbst keinen an. Der Plan-Link nur, solange der
--     Plan nicht abgesagt ist; der Stichwahl-Link nur, solange sie läuft und Gäste mitstimmen dürfen.
--   * Gleichstand: Ergebnis ist die Stichwahl (die jüngste Abstimmung mit `parent_poll_id`); wird aus ihr ein
--     Plan, zeigt der ursprüngliche Link auch diesen.
--   * Sonst bleibt der Stimmzettel, wie er war (gleiche Rechte, gleiches Rate Limit, `outcome` ist null, solange
--     die Abstimmung läuft).

create or replace function public.shared_poll_ballot(p_token text, p_secret text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_poll public.polls;
  v_guest public.poll_guests;
  v_runoff public.polls;
  v_plan public.plans;
  v_outcome jsonb;
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

  -- P28: Ergebnis erst nach dem Ende.
  if v_poll.status = 'closed' then
    select r.* into v_runoff from public.polls r
    where r.parent_poll_id = v_poll.id
    order by r.created_at desc, r.id
    limit 1;

    select p.* into v_plan from public.plans p
    where p.poll_id = v_poll.id or (v_runoff.id is not null and p.poll_id = v_runoff.id)
    order by (p.poll_id = v_poll.id) desc, p.created_at desc
    limit 1;

    v_outcome := jsonb_build_object(
      'winner', (select o.position from public.poll_options o
                 where o.id = v_poll.winning_option_id and o.poll_id = v_poll.id),
      'tie', v_poll.is_tie,
      'runoff', case when v_runoff.id is null then null else jsonb_build_object(
        'open', v_runoff.status = 'open' and v_runoff.ends_at > now(),
        'ends_at', v_runoff.ends_at,
        'token', case when v_guest.id is not null and v_runoff.status = 'open' and v_runoff.ends_at > now()
                           and v_runoff.guests_allowed
                      then (select l.token from public.poll_share_links l where l.poll_id = v_runoff.id) end) end,
      'plan', case when v_plan.id is null then null else jsonb_build_object(
        'title', v_plan.title,
        'starts_at', v_plan.starts_at,
        'cancelled', v_plan.status = 'cancelled',
        'token', case when v_guest.id is not null and v_plan.status <> 'cancelled'
                      then (select l.token from public.plan_share_links l where l.plan_id = v_plan.id) end) end);
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
        where g.guest_id = v_guest.id), '{}'::jsonb)) end,
    'outcome', v_outcome);
end $$;

comment on function public.shared_poll_ballot(text, text) is
  'W3/P28: Stimmzettel für Gäste ohne Konto; nach dem Ende mit Ergebnis (Gewinner, Plan, Stichwahl – Links nur für Gäste mit Geheimnis).';
