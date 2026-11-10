-- P34 · „Bin bei allem dabei“: Wer im Gruppenchat „mir egal, ich komm überall mit“ schreibt, stimmt in der App
-- mit einem Tipp bei allen Vorschlägen ohne eigene Antwort auf „dabei“. Schon gegebene Antworten bleiben
-- unangetastet (wer bei Kino „nein“ gesagt hat, bleibt bei „nein“). Gleiche Regeln wie `cast_vote`:
-- nur Mitglieder der Crew, nur solange die Abstimmung läuft, gleiche Grenze für Stimmen.
-- Die Trigger für „Entscheidet sich selbst“ (S5) laufen je Zeile mit – „überall dabei“ allein erzeugt nie eine
-- klare Mehrheit für einen einzelnen Vorschlag, weil alle Vorschläge gleich viel dazugewinnen.

create function public.cast_vote_all(p_poll_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app_private.require_user();
  v_poll public.polls%rowtype;
  v_count integer;
begin
  select * into v_poll from public.polls p where p.id = p_poll_id;
  if not found or not app_private.is_crew_member(v_poll.crew_id) then
    perform app_private.forbid();
  end if;
  if v_poll.status <> 'open' or v_poll.ends_at <= now() then
    perform app_private.fail('poll_closed');
  end if;
  perform app_private.rate_limit('vote', 120, interval '1 minute');

  insert into public.poll_votes (poll_id, poll_option_id, user_id, response)
  select v_poll.id, o.id, v_uid, 'yes'::public.vote_response
  from public.poll_options o
  where o.poll_id = v_poll.id
    and not exists (select 1 from public.poll_votes v where v.poll_option_id = o.id and v.user_id = v_uid)
  order by o.position
  on conflict (poll_option_id, user_id) do nothing;
  get diagnostics v_count = row_count;

  -- Wie bei `cast_vote`: höchstens eine Benachrichtigung je Person und Abstimmung an die Person, die gefragt hat.
  if v_count > 0 and v_poll.created_by is distinct from v_uid then
    perform app_private.notify(v_poll.created_by, 'poll_vote', v_uid, v_poll.crew_id, 'poll', v_poll.id,
                               jsonb_build_object('title', v_poll.title),
                               'poll_vote:' || v_poll.id::text || ':' || v_uid::text);
  end if;
  return v_count;
end $$;

revoke all on function public.cast_vote_all(uuid) from public, anon, authenticated;
grant execute on function public.cast_vote_all(uuid) to authenticated, service_role;

comment on function public.cast_vote_all(uuid) is
  'P34: „Bin bei allem dabei“ – „dabei“ bei allen Vorschlägen ohne eigene Antwort; liefert die Zahl der neuen Stimmen.';
