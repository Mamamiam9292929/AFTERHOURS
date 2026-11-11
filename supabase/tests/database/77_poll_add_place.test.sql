-- P40 Etappe 2: „Und das Kino?“ – `add_poll_place` hängt einen weiteren Ort an eine laufende Orts-Abstimmung.
-- Jedes Mitglied darf, nur bei Orts-Abstimmungen (keine Stichwahl), solange sie läuft; Ort aus Discover oder
-- eigener Vorschlag, nichts doppelt, höchstens 10. Gemeinsamer Termin wird übernommen. Wer vorschlägt, ist dort
-- dabei; wer schon abgestimmt hat, bekommt Bescheid. „Entscheidet sich selbst“ (S5) wartet auf den neuen Ort.
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

insert into public.activities (provider_id, external_id, name, category, city, data_source) values
  ('manual', 'p40b-bowling', 'Bowling Nord', 'bowling', 'Leipzig', 'manual'),
  ('manual', 'p40b-kino', 'Kino am Markt', 'cinema', 'Leipzig', 'manual'),
  ('manual', 'p40b-alt', 'Geschlossene Bar', 'bar', 'Leipzig', 'manual');
update public.activities set is_active = false where external_id = 'p40b-alt';
select tests.set_var('bowling', (select id::text from public.activities where external_id = 'p40b-bowling'));
select tests.set_var('kino', (select id::text from public.activities where external_id = 'p40b-kino'));
select tests.set_var('alt', (select id::text from public.activities where external_id = 'p40b-alt'));
select tests.set_var('d1', ((now() at time zone 'Europe/Berlin')::date + 3)::text);

-- Abstimmung wie aus „bowling oder billard fr 20 uhr“ (S1): alle Vorschläge mit demselben Termin.
select tests.login('alice');
select tests.set_var('poll', public.create_poll(tests.var('crew')::uuid, 'Was machen wir?', now() + interval '1 day',
  format('[{"activity_id":"%s","proposed_date":"%s","proposed_time":"20:00"},{"title":"Billard","proposed_date":"%s","proposed_time":"20:00"}]',
         tests.var('bowling'), tests.var('d1'), tests.var('d1'))::jsonb)::text);
select public.cast_vote((select id from public.poll_options where poll_id = tests.var('poll')::uuid and title = 'Bowling Nord'), 'yes');
select tests.login('carol');
select public.cast_vote((select id from public.poll_options where poll_id = tests.var('poll')::uuid and title = 'Billard'), 'no');

-- ---- Rechte und Angriffe -----------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.add_poll_place(uuid, uuid, text)', 'execute'), 'anon darf nicht');
select ok(has_function_privilege('authenticated', 'public.add_poll_place(uuid, uuid, text)', 'execute'), 'angemeldete Personen dürfen aufrufen');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.add_poll_place(uuid, uuid, text)'::regprocedure),
  'SECURITY DEFINER mit leerem search_path');

select tests.login_anon();
select throws_ok(format($$ select public.add_poll_place(%L, null, 'Kino') $$, tests.var('poll')), '42501', null, 'anon scheitert');
select tests.login('mallory');
select throws_ok(format($$ select public.add_poll_place(%L, null, 'Kino') $$, tests.var('poll')), '42501', 'forbidden', 'Außenstehende scheitern');
select throws_ok(format($$ select public.add_poll_place(%L, null, 'Kino') $$, gen_random_uuid()), '42501', 'forbidden',
  'unbekannte Abstimmung sieht aus wie eine fremde');
select tests.logout();
select is((select count(*)::int from public.poll_options where poll_id = tests.var('poll')::uuid), 2, 'Angriffe haben keinen Ort angelegt');

-- ---- Prüfungen ---------------------------------------------------------------------------------------
select tests.login('bob');
select throws_ok(format($$ select public.add_poll_place(%L, %L) $$, tests.var('poll'), tests.var('bowling')), 'P0001', 'poll_place_duplicate',
  'gleicher Ort aus Discover gibt es schon');
select throws_ok(format($$ select public.add_poll_place(%L, null, '  bILLard ') $$, tests.var('poll')), 'P0001', 'poll_place_duplicate',
  'gleicher Titel, andere Schreibweise');
select throws_ok(format($$ select public.add_poll_place(%L, null, '   ') $$, tests.var('poll')), 'P0001', 'poll_place_invalid', 'ohne Titel nichts');
select throws_ok(format($$ select public.add_poll_place(%L) $$, tests.var('poll')), 'P0001', 'poll_place_invalid', 'ohne Ort und Titel nichts');
select throws_ok(format($$ select public.add_poll_place(%L, %L) $$, tests.var('poll'), tests.var('alt')), 'P0001', 'unknown_activity',
  'geschlossener Ort geht nicht');
select throws_ok(format($$ select public.add_poll_place(%L, %L) $$, tests.var('poll'), gen_random_uuid()), 'P0001', 'unknown_activity',
  'unbekannter Ort geht nicht');

-- ---- Vorschlagen: Ort aus Discover, Termin, Position, eigene Stimme, Bescheid ------------------------
select tests.set_var('added', public.add_poll_place(tests.var('poll')::uuid, tests.var('kino')::uuid)::text);
select tests.logout();
select is((select title from public.poll_options where id = tests.var('added')::uuid), 'Kino am Markt', 'Titel ist der Name des Orts');
select is((select activity_id::text from public.poll_options where id = tests.var('added')::uuid), tests.var('kino'), 'Ort aus Discover');
select is((select proposed_date::text || ' ' || proposed_time::text from public.poll_options where id = tests.var('added')::uuid),
  tests.var('d1') || ' 20:00:00', 'gemeinsamer Termin wird übernommen');
select is((select estimated_price_cents from public.poll_options where id = tests.var('added')::uuid), null, 'kein geratener Preis');
select is((select string_agg(position::text, ',' order by position) from public.poll_options where poll_id = tests.var('poll')::uuid), '1,2,3',
  'hinten angehängt – bestehende Positionen (Stimmzettel für Gäste) bleiben');
select is((select response::text from public.poll_votes where poll_option_id = tests.var('added')::uuid and user_id = tests.uid('bob')), 'yes',
  'wer vorschlägt, ist dort dabei');
select is((select count(*)::int from public.poll_votes where poll_id = tests.var('poll')::uuid), 3, 'bisherige Stimmen bleiben');
select is((select string_agg(p.display_name, ',' order by p.display_name) from public.notifications n join public.profiles p on p.id = n.user_id
           where n.type = 'poll_reminder' and n.related_entity_id = tests.var('poll')::uuid and (n.payload ->> 'added')::boolean),
  'Alice,Carol', 'Bescheid an alle, die schon abgestimmt haben (nicht Bob selbst, nicht Dave)');
select is((select payload ->> 'place' from public.notifications where type = 'poll_reminder' and user_id = tests.uid('carol') and related_entity_id = tests.var('poll')::uuid),
  'Kino am Markt', 'Hinweis nennt den Ort');
select is((select actor_id from public.notifications where type = 'poll_reminder' and user_id = tests.uid('carol') and related_entity_id = tests.var('poll')::uuid),
  tests.uid('bob'), 'Bob steht als auslösende Person dabei');

-- Eigener Vorschlag (Dave, ohne Stimme), Leerzeichen werden bereinigt.
select tests.login('dave');
select tests.set_var('own', public.add_poll_place(tests.var('poll')::uuid, null, '  Picknick im Park  ')::text);
select tests.logout();
select is((select title || '|' || coalesce(activity_id::text, '-') from public.poll_options where id = tests.var('own')::uuid), 'Picknick im Park|-',
  'eigener Vorschlag ohne Ort, Titel bereinigt');
select is((select count(*)::int from public.notifications where type = 'poll_reminder' and user_id = tests.uid('bob') and related_entity_id = tests.var('poll')::uuid), 1,
  'Bob hat abgestimmt (durch seinen Vorschlag) und bekommt Bescheid über Daves Ort');

-- ---- Verschiedene Termine: neuer Ort bleibt ohne Termin -----------------------------------------------
select tests.login('alice');
select tests.set_var('mixed', public.create_poll(tests.var('crew')::uuid, 'Fr oder Sa?', now() + interval '1 day',
  format('[{"title":"Bowling","proposed_date":"%s"},{"title":"Kino","proposed_date":"%s"}]',
         tests.var('d1'), ((now() at time zone 'Europe/Berlin')::date + 4))::jsonb)::text);
select tests.set_var('mixed_opt', public.add_poll_place(tests.var('mixed')::uuid, null, 'Karaoke')::text);
select is((select proposed_date from public.poll_options where id = tests.var('mixed_opt')::uuid), null, 'verschiedene Termine: kein Termin geraten');
select tests.set_var('nodate', public.create_poll(tests.var('crew')::uuid, 'Irgendwann?', now() + interval '1 day', '[{"title":"Bowling"},{"title":"Kino"}]')::text);
select tests.set_var('nodate_opt', public.add_poll_place(tests.var('nodate')::uuid, null, 'Karaoke')::text);
select is((select proposed_date from public.poll_options where id = tests.var('nodate_opt')::uuid), null, 'ohne Termin bleibt es ohne');

-- ---- Höchstens 10 Vorschläge -------------------------------------------------------------------------
select public.add_poll_place(tests.var('nodate')::uuid, null, 'Ort ' || i) from generate_series(1, 7) i;
select is((select count(*)::int from public.poll_options where poll_id = tests.var('nodate')::uuid), 10, 'zehn Vorschläge');
select throws_ok(format($$ select public.add_poll_place(%L, null, 'Noch einer') $$, tests.var('nodate')), 'P0001', 'poll_place_full',
  'der elfte Vorschlag passt nicht mehr');

-- ---- Nur Orts-Abstimmungen, keine Stichwahl ----------------------------------------------------------
select tests.set_var('dates', public.create_date_poll(tests.var('crew')::uuid, 'Wann könnt ihr?', now() + interval '1 day',
  format('[{"date":"%s"},{"date":"%s"}]', tests.var('d1'), ((now() at time zone 'Europe/Berlin')::date + 4))::jsonb)::text);
select throws_ok(format($$ select public.add_poll_place(%L, null, 'Kino') $$, tests.var('dates')), 'P0001', 'poll_place_unsupported',
  'Termin-Abstimmungen bekommen keine Orte');
select tests.set_var('runoff', public.create_poll(tests.var('crew')::uuid, 'Stichwahl: Was?', now() + interval '1 day', '[{"title":"Bowling"},{"title":"Kino"}]')::text);
select tests.logout();
update public.polls set parent_poll_id = tests.var('nodate')::uuid where id = tests.var('runoff')::uuid;
select tests.login('alice');
select throws_ok(format($$ select public.add_poll_place(%L, null, 'Karaoke') $$, tests.var('runoff')), 'P0001', 'poll_place_runoff',
  'in der Stichwahl geht es nur um die Vorschläge mit Gleichstand');

-- ---- Nach dem Ende -----------------------------------------------------------------------------------
select tests.set_var('done', public.create_poll(tests.var('crew')::uuid, 'Vorbei?', now() + interval '1 day', '[{"title":"Bowling"},{"title":"Kino"}]')::text);
select public.close_poll(tests.var('done')::uuid);
select throws_ok(format($$ select public.add_poll_place(%L, null, 'Karaoke') $$, tests.var('done')), 'P0001', 'poll_closed', 'beendete Abstimmung');
select tests.set_var('due', public.create_poll(tests.var('crew')::uuid, 'Abgelaufen?', now() + interval '1 day', '[{"title":"Bowling"},{"title":"Kino"}]')::text);
select tests.logout();
update public.polls set ends_at = now() - interval '1 minute', created_at = now() - interval '1 hour' where id = tests.var('due')::uuid;
select tests.login('bob');
select throws_ok(format($$ select public.add_poll_place(%L, null, 'Karaoke') $$, tests.var('due')), 'P0001', 'poll_closed',
  'Frist abgelaufen: kein neuer Ort, auch wenn der Status noch offen ist');
select tests.logout();

-- ---- „Entscheidet sich selbst“ (S5): der neue Ort bekommt seine Chance ---------------------------------
-- Crew mit 4 Mitgliedern. Bowling hat Alice und Carol; Bob schlägt Kino vor. Danach sagt auch Dave „dabei“
-- zu Bowling (3 von 4) – ohne Kino wäre das entschieden, aber Kino kann noch aufholen (Bob + 3 ohne Antwort).
select tests.login('alice');
select tests.set_var('auto', public.create_poll(tests.var('crew')::uuid, 'Was machen wir Samstag?', now() + interval '1 day',
  format('[{"title":"Bowling","proposed_date":"%s","proposed_time":"20:00"},{"title":"Billard","proposed_date":"%s","proposed_time":"20:00"}]',
         tests.var('d1'), tests.var('d1'))::jsonb)::text);
select tests.logout();
update public.polls set auto_decide = true where id = tests.var('auto')::uuid;
select tests.set_var('auto_bowling', (select id::text from public.poll_options where poll_id = tests.var('auto')::uuid and title = 'Bowling'));
select tests.set_var('auto_billard', (select id::text from public.poll_options where poll_id = tests.var('auto')::uuid and title = 'Billard'));
select tests.login('alice');
select public.cast_vote(tests.var('auto_bowling')::uuid, 'yes'); select public.cast_vote(tests.var('auto_billard')::uuid, 'no');
select tests.login('carol');
select public.cast_vote(tests.var('auto_bowling')::uuid, 'yes'); select public.cast_vote(tests.var('auto_billard')::uuid, 'no');
select tests.login('bob');
select tests.set_var('auto_kino', public.add_poll_place(tests.var('auto')::uuid, null, 'Kino')::text);
select tests.login('dave');
select public.cast_vote(tests.var('auto_bowling')::uuid, 'yes');
select is((select status::text from public.polls where id = tests.var('auto')::uuid), 'open',
  'S5: drei von vier bei Bowling, aber der neue Ort kann noch aufholen – noch nicht entschieden');
select tests.login('alice'); select public.cast_vote(tests.var('auto_kino')::uuid, 'no');
select tests.login('carol'); select public.cast_vote(tests.var('auto_kino')::uuid, 'no');
select tests.logout();
select is((select status::text || ' ' || coalesce(winning_option_id::text, '-') from public.polls where id = tests.var('auto')::uuid),
  'closed ' || tests.var('auto_bowling'), 'S5: kann der neue Ort nicht mehr aufholen, entscheidet sich die Abstimmung wie gewohnt');
select is((select to_char(starts_at at time zone 'Europe/Berlin', 'YYYY-MM-DD HH24:MI') from public.plans where poll_id = tests.var('auto')::uuid),
  tests.var('d1') || ' 20:00', 'S5: der Plan steht mit dem gemeinsamen Termin');

-- ---- Rate Limit --------------------------------------------------------------------------------------
select tests.login('alice');
select tests.set_var('many', public.create_poll(tests.var('crew')::uuid, 'Oft?', now() + interval '1 day', '[{"title":"A"},{"title":"B"}]')::text);
select tests.set_var('many2', public.create_poll(tests.var('crew')::uuid, 'Noch öfter?', now() + interval '1 day', '[{"title":"A"},{"title":"B"}]')::text);
select tests.logout();
delete from public.rate_limit_hits where action = 'poll_place_add';
select tests.login('carol');
select public.add_poll_place(tests.var('many')::uuid, null, 'Ort ' || i) from generate_series(1, 8) i;
select public.add_poll_place(tests.var('many2')::uuid, null, 'Ort ' || i) from generate_series(1, 2) i;
select throws_ok(format($$ select public.add_poll_place(%L, null, 'Ort 3') $$, tests.var('many2')), 'P0001', 'rate_limited',
  'höchstens 10 neue Orte je Person und Stunde');

select * from finish();
rollback;
