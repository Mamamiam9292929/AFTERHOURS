-- P40: „Und Sonntag?“ – `add_poll_slot` hängt einen weiteren Termin an eine laufende Termin-Abstimmung.
-- Jedes Mitglied darf, nur bei Termin-Abstimmungen (keine Stichwahl), solange sie läuft, gleiche Prüfungen wie
-- beim Anlegen, höchstens 10 Termine. Wer vorschlägt, ist dort dabei; wer schon abgestimmt hat, bekommt Bescheid.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');   -- Owner, startet die Abstimmung
select tests.make_user('Bob');     -- Mitglied, schlägt vor
select tests.make_user('Carol');   -- Mitglied, hat abgestimmt
select tests.make_user('Dave');    -- Mitglied, hat noch nicht abgestimmt
select tests.make_user('Mallory'); -- Außenstehende

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew')::text);
select tests.set_var('token', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob'); select public.accept_crew_invitation(tests.var('token'));
select tests.login('carol'); select public.accept_crew_invitation(tests.var('token'));
select tests.login('dave'); select public.accept_crew_invitation(tests.var('token'));
select tests.login('mallory');
select tests.set_var('mallory_crew', public.create_crew('Fremde Crew')::text);
select tests.logout();

select tests.set_var('d1', ((now() at time zone 'Europe/Berlin')::date + 3)::text);
select tests.set_var('d2', ((now() at time zone 'Europe/Berlin')::date + 4)::text);
select tests.set_var('d3', ((now() at time zone 'Europe/Berlin')::date + 5)::text);

select tests.login('alice');
select tests.set_var('poll', public.create_date_poll(tests.var('crew')::uuid, 'Wann könnt ihr?', now() + interval '1 day',
  format('[{"date":"%s","time":"20:00"},{"date":"%s","time":"20:00"}]', tests.var('d1'), tests.var('d2'))::jsonb)::text);
select public.cast_vote((select id from public.poll_options where poll_id = tests.var('poll')::uuid and proposed_date = tests.var('d1')::date), 'yes');
select tests.login('carol');
select public.cast_vote((select id from public.poll_options where poll_id = tests.var('poll')::uuid and proposed_date = tests.var('d2')::date), 'no');

-- ---- Rechte und Angriffe -----------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.add_poll_slot(uuid, date, time)', 'execute'), 'anon darf nicht');
select ok(has_function_privilege('authenticated', 'public.add_poll_slot(uuid, date, time)', 'execute'), 'angemeldete Personen dürfen aufrufen');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.add_poll_slot(uuid, date, time)'::regprocedure),
  'SECURITY DEFINER mit leerem search_path');

select tests.login_anon();
select throws_ok(format($$ select public.add_poll_slot(%L, %L) $$, tests.var('poll'), tests.var('d3')), '42501', null, 'anon scheitert');
select tests.login('mallory');
select throws_ok(format($$ select public.add_poll_slot(%L, %L) $$, tests.var('poll'), tests.var('d3')), '42501', 'forbidden', 'Außenstehende scheitern');
select throws_ok(format($$ select public.add_poll_slot(%L, %L) $$, gen_random_uuid(), tests.var('d3')), '42501', 'forbidden',
  'unbekannte Abstimmung sieht aus wie eine fremde');
select tests.logout();
select is((select count(*)::int from public.poll_options where poll_id = tests.var('poll')::uuid), 2, 'Angriffe haben keinen Termin angelegt');

-- ---- Prüfungen wie beim Anlegen ----------------------------------------------------------------------
select tests.login('bob');
select throws_ok(format($$ select public.add_poll_slot(%L, %L, '20:00') $$, tests.var('poll'), tests.var('d1')), 'P0001', 'poll_slot_duplicate',
  'gleicher Tag und gleiche Uhrzeit gibt es schon');
select throws_ok(format($$ select public.add_poll_slot(%L, %L) $$, tests.var('poll'), (now() at time zone 'Europe/Berlin')::date - 1), 'P0001', 'poll_slot_past',
  'gestern geht nicht');
select throws_ok(format($$ select public.add_poll_slot(%L, %L, '00:00') $$, tests.var('poll'), (now() at time zone 'Europe/Berlin')::date),
  'P0001', 'poll_slot_past', 'heute um Mitternacht ist vorbei');
select throws_ok(format($$ select public.add_poll_slot(%L, %L) $$, tests.var('poll'), (now() at time zone 'Europe/Berlin')::date + 400), 'P0001', 'poll_slot_invalid',
  'höchstens ein Jahr voraus');
select throws_ok(format($$ select public.add_poll_slot(%L, null) $$, tests.var('poll')), 'P0001', 'poll_slot_invalid', 'ohne Tag nichts');

-- ---- Vorschlagen: Titel, Position, eigene Stimme, Bescheid ------------------------------------------
select tests.set_var('added', public.add_poll_slot(tests.var('poll')::uuid, tests.var('d3')::date, '19:30:45')::text);
select tests.logout();
select is((select title from public.poll_options where id = tests.var('added')::uuid), app_private.german_date_label(tests.var('d3')::date),
  'Titel kommt vom Server, wie bei allen Terminen');
select is((select proposed_time from public.poll_options where id = tests.var('added')::uuid), '19:30'::time, 'Uhrzeit auf die Minute');
select is((select position from public.poll_options where id = tests.var('added')::uuid),
  (select max(position) from public.poll_options where poll_id = tests.var('poll')::uuid and id <> tests.var('added')::uuid) + 1::smallint,
  'hinten angehängt – bestehende Positionen (Stimmzettel für Gäste) bleiben');
select is((select string_agg(position::text, ',' order by position) from public.poll_options where poll_id = tests.var('poll')::uuid), '0,1,2', 'Positionen 0, 1, 2');
select is((select response::text from public.poll_votes where poll_option_id = tests.var('added')::uuid and user_id = tests.uid('bob')), 'yes',
  'wer vorschlägt, ist dort dabei');
select is((select count(*)::int from public.poll_votes where poll_id = tests.var('poll')::uuid), 3, 'bisherige Stimmen bleiben');
select is((select string_agg(p.display_name, ',' order by p.display_name) from public.notifications n join public.profiles p on p.id = n.user_id
           where n.type = 'poll_reminder' and n.related_entity_id = tests.var('poll')::uuid and (n.payload ->> 'added')::boolean),
  'Alice,Carol', 'Bescheid an alle, die schon abgestimmt haben (nicht Bob selbst, nicht Dave)');
select is((select payload ->> 'date' from public.notifications where type = 'poll_reminder' and user_id = tests.uid('carol') and related_entity_id = tests.var('poll')::uuid),
  tests.var('d3'), 'Hinweis nennt den Tag');
select is((select payload ->> 'time' from public.notifications where type = 'poll_reminder' and user_id = tests.uid('carol') and related_entity_id = tests.var('poll')::uuid),
  '19:30', 'und die Uhrzeit');
select is((select actor_id from public.notifications where type = 'poll_reminder' and user_id = tests.uid('carol') and related_entity_id = tests.var('poll')::uuid),
  tests.uid('bob'), 'Bob steht als auslösende Person dabei');

-- Gleicher Tag ohne Uhrzeit ist ein anderer Termin; Dave (ohne Stimme) darf auch.
select tests.login('dave');
select ok(public.add_poll_slot(tests.var('poll')::uuid, tests.var('d3')::date) is not null, 'gleicher Tag ohne Uhrzeit ist ein eigener Termin');
select throws_ok(format($$ select public.add_poll_slot(%L, %L) $$, tests.var('poll'), tests.var('d3')), 'P0001', 'poll_slot_duplicate', 'aber nur einmal');
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'poll_reminder' and user_id = tests.uid('bob') and related_entity_id = tests.var('poll')::uuid), 1,
  'Bob hat abgestimmt (durch seinen Vorschlag) und bekommt Bescheid über Daves Termin');

-- ---- Höchstens 10 Termine ----------------------------------------------------------------------------
select tests.login('alice');
select public.add_poll_slot(tests.var('poll')::uuid, (now() at time zone 'Europe/Berlin')::date + 10 + i) from generate_series(1, 6) i;
select is((select count(*)::int from public.poll_options where poll_id = tests.var('poll')::uuid), 10, 'zehn Termine');
select throws_ok(format($$ select public.add_poll_slot(%L, %L) $$, tests.var('poll'), (now() at time zone 'Europe/Berlin')::date + 30), 'P0001', 'poll_slot_full',
  'der elfte Termin passt nicht mehr');

-- ---- Nur Termin-Abstimmungen, keine Stichwahl --------------------------------------------------------
select tests.set_var('places', public.create_poll(tests.var('crew')::uuid, 'Was geht?', now() + interval '1 day', '[{"title":"Bowling"},{"title":"Kino"}]')::text);
select throws_ok(format($$ select public.add_poll_slot(%L, %L) $$, tests.var('places'), tests.var('d3')), 'P0001', 'poll_slot_unsupported',
  'Orts-Abstimmungen bekommen keine Termine');
select tests.set_var('runoff', public.create_date_poll(tests.var('crew')::uuid, 'Stichwahl: Wann?', now() + interval '1 day',
  format('[{"date":"%s"},{"date":"%s"}]', tests.var('d1'), tests.var('d2'))::jsonb)::text);
select tests.logout();
update public.polls set parent_poll_id = tests.var('poll')::uuid where id = tests.var('runoff')::uuid;
select tests.login('alice');
select throws_ok(format($$ select public.add_poll_slot(%L, %L) $$, tests.var('runoff'), tests.var('d3')), 'P0001', 'poll_slot_runoff',
  'in der Stichwahl geht es nur um die Termine mit Gleichstand');

-- ---- Fester Ort (P5 Etappe 3): neuer Termin trägt denselben Ort --------------------------------------
select tests.logout();
insert into public.activities (provider_id, external_id, name, category, city, data_source) values
  ('manual', 'p40-bowling', 'Bowling Nord', 'bowling', 'Leipzig', 'manual');
select tests.login('alice');
select tests.set_var('placed', public.create_place_date_poll(tests.var('crew')::uuid, 'Wann zum Bowling?', now() + interval '1 day',
  format('[{"date":"%s"},{"date":"%s"}]', tests.var('d1'), tests.var('d2'))::jsonb,
  (select id from public.activities where external_id = 'p40-bowling'))::text);
select tests.set_var('placed_opt', public.add_poll_slot(tests.var('placed')::uuid, tests.var('d3')::date)::text);
select is((select a.external_id from public.poll_options o join public.activities a on a.id = o.activity_id where o.id = tests.var('placed_opt')::uuid),
  'p40-bowling', 'fester Ort wird übernommen');
select is((select activity_id from public.poll_options where id = tests.var('added')::uuid), null, 'ohne festen Ort bleibt der Ort leer');

-- ---- Nach dem Ende -----------------------------------------------------------------------------------
select tests.set_var('done', public.create_date_poll(tests.var('crew')::uuid, 'Vorbei?', now() + interval '1 day',
  format('[{"date":"%s"},{"date":"%s"}]', tests.var('d1'), tests.var('d2'))::jsonb)::text);
select public.close_poll(tests.var('done')::uuid);
select throws_ok(format($$ select public.add_poll_slot(%L, %L) $$, tests.var('done'), tests.var('d3')), 'P0001', 'poll_closed', 'beendete Abstimmung');
select tests.set_var('due', public.create_date_poll(tests.var('crew')::uuid, 'Abgelaufen?', now() + interval '1 day',
  format('[{"date":"%s"},{"date":"%s"}]', tests.var('d1'), tests.var('d2'))::jsonb)::text);
select tests.logout();
update public.polls set ends_at = now() - interval '1 minute', created_at = now() - interval '1 hour' where id = tests.var('due')::uuid;
select tests.login('bob');
select throws_ok(format($$ select public.add_poll_slot(%L, %L) $$, tests.var('due'), tests.var('d3')), 'P0001', 'poll_closed',
  'Frist abgelaufen: kein neuer Termin, auch wenn der Status noch offen ist');

-- ---- Rate Limit --------------------------------------------------------------------------------------
select tests.set_var('many', public.create_date_poll(tests.var('crew')::uuid, 'Oft?', now() + interval '1 day',
  format('[{"date":"%s"},{"date":"%s"}]', tests.var('d1'), tests.var('d2'))::jsonb)::text);
select tests.logout();
delete from public.rate_limit_hits where action = 'poll_slot_add';
select tests.login('bob');
select public.add_poll_slot(tests.var('many')::uuid, tests.var('d1')::date, make_time(10 + i, 0, 0)) from generate_series(1, 8) i;
select tests.set_var('many2', public.create_date_poll(tests.var('crew')::uuid, 'Noch öfter?', now() + interval '1 day',
  format('[{"date":"%s"},{"date":"%s"}]', tests.var('d1'), tests.var('d2'))::jsonb)::text);
select public.add_poll_slot(tests.var('many2')::uuid, tests.var('d3')::date, make_time(10 + i, 0, 0)) from generate_series(1, 2) i;
select throws_ok(format($$ select public.add_poll_slot(%L, %L, '22:00') $$, tests.var('many2'), tests.var('d3')), 'P0001', 'rate_limited',
  'höchstens 10 neue Termine je Person und Stunde');

select * from finish();
rollback;
