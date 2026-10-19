-- Termin-Abstimmung teilen (Roadmap P1, Etappe 2): Vorschau und Stimmzettel kennen die Art,
-- die Vorschau zeigt bei Termin-Abstimmungen die Termine – sonst nichts Neues, und nichts für Fremde.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Mallory'); -- Außenstehende

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew')::text);
select tests.set_var('invite', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob'); select public.accept_crew_invitation(tests.var('invite'));

select tests.set_var('d1', ((now() at time zone 'Europe/Berlin')::date + 10)::text);
select tests.set_var('d2', ((now() at time zone 'Europe/Berlin')::date + 3)::text);

select tests.login('alice');
select tests.set_var('poll', public.create_date_poll(tests.var('crew')::uuid, 'Wann geht Bowling?', now() + interval '1 day',
  jsonb_build_array(
    jsonb_build_object('date', tests.var('d1'), 'time', '20:00'),
    jsonb_build_object('date', tests.var('d2'))),
  'Treffpunkt Hinterhof bei Alice')::text);
select tests.set_var('token', public.poll_share_token(tests.var('poll')::uuid));
select tests.set_var('place_poll', public.create_poll(tests.var('crew')::uuid, 'Was machen wir?', now() + interval '1 day',
  jsonb_build_array(jsonb_build_object('title', 'Grillen bei Bob', 'proposed_date', tests.var('d1'), 'proposed_time', '19:00')))::text);
select tests.set_var('place_token', public.poll_share_token(tests.var('place_poll')::uuid));
select public.cast_vote((select id from public.poll_options where poll_id = tests.var('poll')::uuid and position = 1), 'yes');
select tests.logout();

-- ---- Vorschau ohne Konto: Termin-Abstimmung -----------------------------------------------------
select tests.login_anon();
select tests.set_var('preview', public.preview_shared_poll(tests.var('token'))::text);
select is(tests.var('preview')::jsonb #>> '{poll,kind}', 'date', 'Vorschau kennt die Art');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(tests.var('preview')::jsonb -> 'poll') k),
  array['dates', 'ends_at', 'guests', 'kind', 'option_count', 'status', 'title', 'voter_count'],
  'Termin-Abstimmung: zusätzlich nur die Termine');
select is(tests.var('preview')::jsonb #> '{poll,dates}',
  jsonb_build_array(jsonb_build_object('date', tests.var('d2'), 'time', null), jsonb_build_object('date', tests.var('d1'), 'time', '20:00')),
  'Termine chronologisch, Uhrzeit oder null');
select is(
  (select array_agg(distinct k order by k) from jsonb_array_elements(tests.var('preview')::jsonb #> '{poll,dates}') e, jsonb_object_keys(e) k),
  array['date', 'time'], 'je Termin nur Datum und Uhrzeit');
select is((tests.var('preview')::jsonb #>> '{poll,voter_count}')::int, 1, 'Zahl der Stimmen wie gehabt');
select ok(tests.var('preview') !~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'keine einzige ID');
select ok(tests.var('preview') !~* '(Hinterhof|Weekend|Alice|Bob|example\.test)', 'keine Beschreibung, keine Crew, keine Namen');

-- ---- Vorschau: Orts-Abstimmung bleibt ohne Termine -----------------------------------------------
select tests.set_var('place_preview', public.preview_shared_poll(tests.var('place_token'))::text);
select is(tests.var('place_preview')::jsonb #>> '{poll,kind}', 'place', 'Orts-Abstimmung: Art „place“');
select ok(not ((tests.var('place_preview')::jsonb -> 'poll') ? 'dates'), 'Orts-Abstimmung: keine Termine in der Vorschau');
select ok((tests.var('place_preview')::jsonb #- '{poll,ends_at}')::text !~* '(Grillen|19:00)', 'Vorschläge und ihre Zeiten bleiben in der Crew'); -- ends_at ausgenommen: kann zufällig 19:00 enthalten

-- ---- Angriff: unbekannter Token, abgelaufene Abstimmung -------------------------------------------
select is(public.preview_shared_poll(repeat('e', 32)), '{"status": "not_found"}'::jsonb, 'geratener Token: nur not_found, keine Termine');
select tests.logout();
update public.polls set ends_at = now() - interval '4 days', status = 'closed', closed_at = now() - interval '4 days'
  where id = tests.var('place_poll')::uuid;
select tests.login_anon();
select is(public.preview_shared_poll(tests.var('place_token')), '{"status": "expired"}'::jsonb, 'abgelaufen: nur der Status');

-- ---- Stimmzettel kennt die Art --------------------------------------------------------------------
select is(public.shared_poll_ballot(tests.var('token')), '{"status": "guests_off"}'::jsonb, 'ohne Freigabe weiterhin kein Stimmzettel');
select tests.login('mallory');
select throws_ok($$ select public.set_poll_guests(tests.var('poll')::uuid, true) $$, '42501', null, 'Außenstehende schalten Gäste nicht frei');
select tests.login('alice');
select public.set_poll_guests(tests.var('poll')::uuid, true);
select tests.login_anon();
select is(public.shared_poll_ballot(tests.var('token')) #>> '{poll,kind}', 'date', 'Stimmzettel: Art „date“');
select is(public.shared_poll_ballot(tests.var('token')) #>> '{options,0,proposed_date}', tests.var('d2'), 'Stimmzettel: Termine mit Datum');
select is(public.preview_shared_poll(tests.var('token')) #>> '{poll,guests}', 'true', 'Vorschau: Gäste dürfen mitstimmen');

-- ---- Mitglieder bekommen wie bisher die ID --------------------------------------------------------
select tests.login('bob');
select is(public.preview_shared_poll(tests.var('token')) ->> 'poll_id', tests.var('poll'), 'Mitglied: ID zum Weiterleiten');
select tests.login('mallory');
select ok(public.preview_shared_poll(tests.var('token')) -> 'poll_id' = 'null'::jsonb, 'Außenstehende: keine ID');
select tests.logout();

select * from finish();
rollback;
