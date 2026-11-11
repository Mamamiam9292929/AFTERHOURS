-- P42: „Vertippt?“ – `remove_poll_option` zieht einen nachgereichten Vorschlag (P40) zurück.
-- Dürfen: wer ihn nachgereicht hat, wer die Abstimmung gestartet hat, Owner/Admin. Nur nachgereichte Vorschläge,
-- nur solange die Abstimmung läuft und niemand sonst (auch kein Gast) dazu geantwortet hat. Position bleibt verbraucht.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');   -- Owner, startet die Abstimmungen
select tests.make_user('Bob');     -- Mitglied, reicht nach
select tests.make_user('Carol');   -- Mitglied, hat abgestimmt
select tests.make_user('Dave');    -- Mitglied, sonst nichts
select tests.make_user('Mallory'); -- Außenstehende

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew')::text);
select tests.set_var('token', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob'); select public.accept_crew_invitation(tests.var('token'));
select tests.login('carol'); select public.accept_crew_invitation(tests.var('token'));
select tests.login('dave'); select public.accept_crew_invitation(tests.var('token'));
select tests.logout();

select tests.set_var('d1', ((now() at time zone 'Europe/Berlin')::date + 3)::text);
select tests.set_var('d2', ((now() at time zone 'Europe/Berlin')::date + 4)::text);
select tests.set_var('d3', ((now() at time zone 'Europe/Berlin')::date + 5)::text);
select tests.set_var('d4', ((now() at time zone 'Europe/Berlin')::date + 6)::text);

select tests.login('alice');
select tests.set_var('poll', public.create_date_poll(tests.var('crew')::uuid, 'Wann könnt ihr?', now() + interval '1 day',
  format('[{"date":"%s"},{"date":"%s"}]', tests.var('d1'), tests.var('d2'))::jsonb)::text);
select tests.set_var('fixed', (select id::text from public.poll_options where poll_id = tests.var('poll')::uuid and proposed_date = tests.var('d1')::date));
select tests.login('carol');
select public.cast_vote(tests.var('fixed')::uuid, 'yes');
select tests.login('bob');
select tests.set_var('typo', public.add_poll_slot(tests.var('poll')::uuid, tests.var('d3')::date)::text);
select tests.logout();

-- ---- Rechte und Angriffe -----------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.remove_poll_option(uuid)', 'execute'), 'anon darf nicht');
select ok(has_function_privilege('authenticated', 'public.remove_poll_option(uuid)', 'execute'), 'angemeldete Personen dürfen aufrufen');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.remove_poll_option(uuid)'::regprocedure),
  'SECURITY DEFINER mit leerem search_path');

select is((select added_by from public.poll_options where id = tests.var('typo')::uuid), tests.uid('bob'), 'add_poll_slot merkt sich, wer nachgereicht hat');
select is((select added_by from public.poll_options where id = tests.var('fixed')::uuid), null, 'Vorschläge vom Start haben niemanden');

select tests.login_anon();
select throws_ok(format($$ select public.remove_poll_option(%L) $$, tests.var('typo')), '42501', null, 'anon scheitert');
select tests.login('mallory');
select throws_ok(format($$ select public.remove_poll_option(%L) $$, tests.var('typo')), '42501', 'forbidden', 'Außenstehende scheitern');
select throws_ok(format($$ select public.remove_poll_option(%L) $$, gen_random_uuid()), '42501', 'forbidden',
  'unbekannter Vorschlag sieht aus wie ein fremder');
select tests.login('dave');
select throws_ok(format($$ select public.remove_poll_option(%L) $$, tests.var('typo')), '42501', 'forbidden',
  'einfache Mitglieder ziehen fremde Vorschläge nicht zurück');
select tests.login('bob');
select throws_ok(format($$ select public.remove_poll_option(%L) $$, tests.var('fixed')), 'P0001', 'poll_option_fixed',
  'Vorschläge vom Start bleiben');
select tests.logout();
select is((select count(*)::int from public.poll_options where poll_id = tests.var('poll')::uuid), 3, 'Angriffe haben nichts gelöscht');

-- ---- Zurückziehen: Vorschlag, eigene Stimme und Hinweis verschwinden -----------------------------------
select is((select count(*)::int from public.notifications where dedupe_key = 'poll_slot_added:' || tests.var('typo')), 1,
  'vorher: Hinweis an Carol (hat schon abgestimmt)');
select tests.login('bob');
select lives_ok(format($$ select public.remove_poll_option(%L) $$, tests.var('typo')), 'Bob zieht seinen Vorschlag zurück');
select tests.logout();
select is((select count(*)::int from public.poll_options where id = tests.var('typo')::uuid), 0, 'Vorschlag ist weg');
select is((select count(*)::int from public.poll_votes where poll_option_id = tests.var('typo')::uuid), 0, 'Bobs eigene Stimme dazu auch');
select is((select count(*)::int from public.poll_votes where poll_id = tests.var('poll')::uuid), 1, 'Carols Stimme bleibt');
select is((select count(*)::int from public.notifications where dedupe_key = 'poll_slot_added:' || tests.var('typo')), 0,
  'der Hinweis an die Crew ist zurückgenommen');
select is((select withdrawn_position from public.polls where id = tests.var('poll')::uuid), 3::smallint, 'Position 3 ist verbraucht');

-- Neuer Vorschlag bekommt nicht die Position des zurückgezogenen (Stimmzettel für Gäste).
select tests.login('bob');
select tests.set_var('again', public.add_poll_slot(tests.var('poll')::uuid, tests.var('d4')::date)::text);
select tests.logout();
select is((select string_agg(position::text, ',' order by position) from public.poll_options where poll_id = tests.var('poll')::uuid), '1,2,4',
  'nachgereichter Vorschlag kommt hinter die verbrauchte Position');

-- ---- Sobald jemand anderes antwortet, bleibt der Vorschlag ----------------------------------------------
select tests.login('carol');
select public.cast_vote(tests.var('again')::uuid, 'no');
select tests.login('bob');
select throws_ok(format($$ select public.remove_poll_option(%L) $$, tests.var('again')), 'P0001', 'poll_option_has_votes',
  'auch ein „Nicht dabei“ von Carol zählt als Antwort');
select tests.login('carol');
select public.retract_vote(tests.var('again')::uuid);

-- ---- Wer die Abstimmung gestartet hat und Owner/Admin dürfen auch --------------------------------------
select tests.login('dave');
select tests.set_var('dave_poll', public.create_date_poll(tests.var('crew')::uuid, 'Daves Frage', now() + interval '1 day',
  format('[{"date":"%s"},{"date":"%s"}]', tests.var('d1'), tests.var('d2'))::jsonb)::text);
select tests.login('bob');
select tests.set_var('dave_extra', public.add_poll_slot(tests.var('dave_poll')::uuid, tests.var('d3')::date)::text);
select tests.set_var('dave_extra2', public.add_poll_slot(tests.var('dave_poll')::uuid, tests.var('d4')::date)::text);
select tests.login('dave');
select lives_ok(format($$ select public.remove_poll_option(%L) $$, tests.var('dave_extra')), 'wer gestartet hat, räumt auf');
select tests.login('alice');
select lives_ok(format($$ select public.remove_poll_option(%L) $$, tests.var('dave_extra2')), 'Owner räumt auf');
select lives_ok(format($$ select public.remove_poll_option(%L) $$, tests.var('again')), 'Owner zieht Bobs Vorschlag zurück (Bobs eigene Stimme zählt nicht)');
select tests.logout();
select is((select count(*)::int from public.poll_options where poll_id in (tests.var('poll')::uuid, tests.var('dave_poll')::uuid)), 4,
  'übrig: die Vorschläge vom Start');

-- ---- Orte: add_poll_place merkt sich die Person; Gast-Stimmen zählen als Antwort -------------------------
select tests.login('alice');
select tests.set_var('places', public.create_poll(tests.var('crew')::uuid, 'Was machen wir?', now() + interval '1 day',
  '[{"title":"Bowling"},{"title":"Kino"}]'::jsonb)::text);
select public.set_poll_guests(tests.var('places')::uuid, true);
select tests.set_var('share', public.poll_share_token(tests.var('places')::uuid));
select tests.login('bob');
select tests.set_var('karaoke', public.add_poll_place(tests.var('places')::uuid, null, 'Karaoke')::text);
select tests.logout();
select is((select added_by from public.poll_options where id = tests.var('karaoke')::uuid), tests.uid('bob'), 'add_poll_place merkt sich die Person');
select tests.set_var('karaoke_key', (select position::text from public.poll_options where id = tests.var('karaoke')::uuid));
select tests.login_anon();
select public.guest_vote_shared_poll(tests.var('share'), repeat('c', 64), 'Carla', jsonb_build_object(tests.var('karaoke_key'), 'yes'));
select tests.login('bob');
select throws_ok(format($$ select public.remove_poll_option(%L) $$, tests.var('karaoke')), 'P0001', 'poll_option_has_votes',
  'Gast hat dazu geantwortet – der Vorschlag bleibt');

-- ---- Nach dem Ende -----------------------------------------------------------------------------------
select tests.set_var('bar', public.add_poll_place(tests.var('places')::uuid, null, 'Bar')::text);
select tests.login('alice');
select public.close_poll(tests.var('places')::uuid);
select tests.login('bob');
select throws_ok(format($$ select public.remove_poll_option(%L) $$, tests.var('bar')), 'P0001', 'poll_closed', 'beendete Abstimmung');
select tests.logout();

-- ---- „Entscheidet sich selbst“ (S5): hielt nur der neue Vorschlag auf, entscheidet es sich jetzt ----------
-- Vier in der Crew. Bob reicht Kino nach, dann sagen Alice, Carol und Dave „dabei“ zu Bowling (3 von 4) – Kino
-- könnte noch aufholen. Zieht Bob Kino zurück, ist Bowling uneinholbar vorn.
select tests.login('alice');
select tests.set_var('auto', public.create_poll(tests.var('crew')::uuid, 'Was machen wir Samstag?', now() + interval '1 day',
  format('[{"title":"Bowling","proposed_date":"%s","proposed_time":"20:00"},{"title":"Billard","proposed_date":"%s","proposed_time":"20:00"}]',
         tests.var('d1'), tests.var('d1'))::jsonb)::text);
select tests.logout();
update public.polls set auto_decide = true where id = tests.var('auto')::uuid;
select tests.set_var('auto_bowling', (select id::text from public.poll_options where poll_id = tests.var('auto')::uuid and title = 'Bowling'));
select tests.set_var('auto_billard', (select id::text from public.poll_options where poll_id = tests.var('auto')::uuid and title = 'Billard'));
select tests.login('bob');
select tests.set_var('auto_kino', public.add_poll_place(tests.var('auto')::uuid, null, 'Kino')::text);
select tests.login('alice');
select public.cast_vote(tests.var('auto_bowling')::uuid, 'yes'); select public.cast_vote(tests.var('auto_billard')::uuid, 'no');
select tests.login('carol');
select public.cast_vote(tests.var('auto_bowling')::uuid, 'yes'); select public.cast_vote(tests.var('auto_billard')::uuid, 'no');
select tests.login('dave');
select public.cast_vote(tests.var('auto_bowling')::uuid, 'yes');
select is((select status::text from public.polls where id = tests.var('auto')::uuid), 'open', 'S5: Kino kann noch aufholen – offen');
select tests.login('bob');
select public.remove_poll_option(tests.var('auto_kino')::uuid);
select tests.logout();
select is((select status::text || ' ' || coalesce(winning_option_id::text, '-') from public.polls where id = tests.var('auto')::uuid),
  'closed ' || tests.var('auto_bowling'), 'S5: ohne Kino entscheidet sich die Abstimmung');

-- ---- Rate Limit --------------------------------------------------------------------------------------
select tests.login('alice');
select tests.set_var('many', public.create_poll(tests.var('crew')::uuid, 'Oft?', now() + interval '1 day', '[{"title":"A"},{"title":"B"}]')::text);
select tests.logout();
delete from public.rate_limit_hits where action in ('poll_option_withdraw', 'poll_place_add');
select tests.login('carol');
select public.remove_poll_option(public.add_poll_place(tests.var('many')::uuid, null, 'Ort ' || i)) from generate_series(1, 10) i;
select tests.logout();
delete from public.rate_limit_hits where action = 'poll_place_add';
select tests.login('carol');
select public.remove_poll_option(public.add_poll_place(tests.var('many')::uuid, null, 'Ort ' || i)) from generate_series(11, 20) i;
select tests.logout();
delete from public.rate_limit_hits where action = 'poll_place_add';
select tests.login('carol');
select tests.set_var('last', public.add_poll_place(tests.var('many')::uuid, null, 'Ort 21')::text);
select throws_ok(format($$ select public.remove_poll_option(%L) $$, tests.var('last')), 'P0001', 'rate_limited',
  'höchstens 20 je Person und Stunde');
select tests.logout();
select is((select position from public.poll_options where id = tests.var('last')::uuid), 23::smallint,
  'Positionen werden nie wiederverwendet (A und B auf 1 und 2, dann 20 zurückgezogene)');

select * from finish();
rollback;
