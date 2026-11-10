-- P34: „Bin bei allem dabei“ – `cast_vote_all` setzt „dabei“ bei allen Vorschlägen ohne eigene Antwort.
-- Schon gegebene Antworten bleiben, nur Mitglieder, nur solange die Abstimmung läuft, eine Benachrichtigung je
-- Person, und „überall dabei“ entscheidet eine Abstimmung mit „Entscheidet sich selbst“ nicht allein.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Carol');
select tests.make_user('Mallory'); -- Außenstehende

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew')::text);
select tests.set_var('token', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob'); select public.accept_crew_invitation(tests.var('token'));
select tests.login('carol'); select public.accept_crew_invitation(tests.var('token'));
select tests.login('mallory');
select tests.set_var('mallory_crew', public.create_crew('Fremde Crew')::text);

select tests.login('alice');
select tests.set_var('poll', public.create_poll(tests.var('crew')::uuid, 'Was geht am Freitag?', now() + interval '1 day',
  '[{"title":"Bowling"},{"title":"Kino"},{"title":"Pizza"}]')::text);
select tests.set_var('bowling', (select id::text from public.poll_options where poll_id = tests.var('poll')::uuid and title = 'Bowling'));
select tests.set_var('kino', (select id::text from public.poll_options where poll_id = tests.var('poll')::uuid and title = 'Kino'));
select tests.set_var('pizza', (select id::text from public.poll_options where poll_id = tests.var('poll')::uuid and title = 'Pizza'));

-- ---- Rechte und Angriffe von außen -----------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.cast_vote_all(uuid)', 'execute'), 'anon darf nicht');
select ok(has_function_privilege('authenticated', 'public.cast_vote_all(uuid)', 'execute'), 'angemeldete Personen dürfen aufrufen');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.cast_vote_all(uuid)'::regprocedure),
  'SECURITY DEFINER mit leerem search_path');

select tests.login_anon();
select throws_ok(format($$ select public.cast_vote_all(%L) $$, tests.var('poll')), '42501', null, 'anon scheitert');
select tests.login('mallory');
select throws_ok(format($$ select public.cast_vote_all(%L) $$, tests.var('poll')), '42501', 'forbidden', 'Außenstehende scheitern');
select throws_ok(format($$ select public.cast_vote_all(%L) $$, gen_random_uuid()), '42501', 'forbidden', 'unbekannte Abstimmung sieht aus wie eine fremde');
select throws_ok($$ select public.cast_vote_all(null) $$, '42501', 'forbidden', 'ohne Abstimmung nichts');
select tests.logout();
select is((select count(*)::int from public.poll_votes where poll_id = tests.var('poll')::uuid), 0, 'Angriffe haben keine Stimme hinterlassen');

-- ---- Überall dabei, eigene Antworten bleiben ------------------------------------------------------
select tests.login('bob');
select public.cast_vote(tests.var('kino')::uuid, 'no');
select is(public.cast_vote_all(tests.var('poll')::uuid), 2, 'Bob: zwei neue Stimmen (Bowling, Pizza)');
select is((select response::text from public.poll_votes where poll_option_id = tests.var('kino')::uuid and user_id = tests.uid('bob')), 'no',
  'Bobs „nein“ bei Kino bleibt');
select is((select string_agg(o.title, ',' order by o.position) from public.poll_votes v join public.poll_options o on o.id = v.poll_option_id
           where v.user_id = tests.uid('bob') and v.response = 'yes'), 'Bowling,Pizza', 'bei Bowling und Pizza dabei');
select is(public.cast_vote_all(tests.var('poll')::uuid), 0, 'ein zweiter Tipp ändert nichts');
select is((select count(*)::int from public.poll_votes where user_id = tests.uid('bob')), 3, 'genau eine Stimme je Vorschlag');

select tests.login('carol');
select is(public.cast_vote_all(tests.var('poll')::uuid), 3, 'Carol ohne Antwort: bei allen drei dabei');

select tests.login('alice');
select is(public.cast_vote_all(tests.var('poll')::uuid), 3, 'auch die Person, die gefragt hat, kann überall dabei sein');
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'poll_vote' and related_entity_id = tests.var('poll')::uuid), 2,
  'Alice bekommt je Person genau einen Hinweis (Bob, Carol) – keinen über sich selbst, keinen für den leeren zweiten Tipp');
select is((select count(*)::int from public.notifications where type = 'poll_vote' and user_id = tests.uid('alice') and actor_id = tests.uid('bob')), 1,
  'Bobs Einzelstimme und sein „überall dabei“ ergeben zusammen einen Hinweis');
select is((select count(*)::int from public.poll_votes where user_id = tests.uid('mallory')), 0, 'Mallory hat nirgends abgestimmt');

-- ---- „Entscheidet sich selbst“: überall dabei allein entscheidet nichts -------------------------------
select tests.login('alice');
select tests.set_var('auto', public.create_poll(tests.var('crew')::uuid, 'Samstag?', now() + interval '1 day',
  '[{"title":"Hütte"},{"title":"Bar"}]')::text);
select public.set_poll_auto_decide(tests.var('auto')::uuid, true);
select public.cast_vote_all(tests.var('auto')::uuid);
select tests.login('bob');
select public.cast_vote_all(tests.var('auto')::uuid);
select tests.login('carol');
select public.cast_vote_all(tests.var('auto')::uuid);
select tests.logout();
select is((select status::text from public.polls where id = tests.var('auto')::uuid), 'open',
  'alle überall dabei – Gleichstand, die Abstimmung läuft weiter');

select tests.login('alice');
select tests.set_var('auto2', public.create_poll(tests.var('crew')::uuid, 'Sonntag?', now() + interval '1 day',
  '[{"title":"Brunch"},{"title":"See"}]')::text);
select public.set_poll_auto_decide(tests.var('auto2')::uuid, true);
select public.cast_vote((select id from public.poll_options where poll_id = tests.var('auto2')::uuid and title = 'See'), 'no');
select tests.login('bob');
select public.cast_vote((select id from public.poll_options where poll_id = tests.var('auto2')::uuid and title = 'See'), 'no');
select tests.login('carol');
select is(public.cast_vote_all(tests.var('auto2')::uuid), 2, 'Carol: überall dabei');
select tests.logout();
select is((select status::text from public.polls where id = tests.var('auto2')::uuid), 'open',
  'Brunch hat nur eine Stimme – keine Mehrheit, läuft weiter');
select tests.login('alice');
select is(public.cast_vote_all(tests.var('auto2')::uuid), 1, 'Alice: nur Brunch fehlte noch');
select tests.logout();
select is((select status::text || ' ' || (winning_option_id = (select id from public.poll_options where poll_id = tests.var('auto2')::uuid and title = 'Brunch'))::text
           from public.polls where id = tests.var('auto2')::uuid), 'closed true',
  'mit Alices Stimme hat Brunch die Mehrheit – die Abstimmung entscheidet sich wie bei Einzelstimmen');

-- ---- Nach dem Ende -----------------------------------------------------------------------------------
select tests.login('alice');
select tests.set_var('done', public.create_poll(tests.var('crew')::uuid, 'Vorbei?', now() + interval '1 day', '[{"title":"Eins"},{"title":"Zwei"}]')::text);
select public.close_poll(tests.var('done')::uuid);
select tests.login('bob');
select throws_ok(format($$ select public.cast_vote_all(%L) $$, tests.var('done')), 'P0001', 'poll_closed', 'beendete Abstimmung: keine Stimmen mehr');

select tests.login('alice');
select tests.set_var('due', public.create_poll(tests.var('crew')::uuid, 'Abgelaufen?', now() + interval '1 day', '[{"title":"Eins"},{"title":"Zwei"}]')::text);
select tests.logout();
update public.polls set ends_at = now() - interval '1 minute', created_at = now() - interval '1 hour' where id = tests.var('due')::uuid;
select tests.login('bob');
select throws_ok(format($$ select public.cast_vote_all(%L) $$, tests.var('due')), 'P0001', 'poll_closed', 'Frist abgelaufen: keine Stimmen mehr, auch wenn der Status noch offen ist');
select tests.logout();
select is((select count(*)::int from public.poll_votes where poll_id in (tests.var('done')::uuid, tests.var('due')::uuid)), 0, 'dort liegt keine Stimme');

select * from finish();
rollback;
