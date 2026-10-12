-- Abstimmungen: Erstellen, Abstimmen, Ergebnis, Gleichstand/Stichwahl, Fristablauf, Erinnerungen.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');   -- erstellt die Abstimmungen
select tests.make_user('Bob');
select tests.make_user('Carol');
select tests.make_user('Mallory'); -- Außenstehende

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew')::text);
select tests.set_var('token', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob');   select public.accept_crew_invitation(tests.var('token'));
select tests.login('carol'); select public.accept_crew_invitation(tests.var('token'));
-- Bob möchte keine Benachrichtigungen über neue Abstimmungen.
select tests.login('bob');
update public.user_settings set notification_preferences = '{"poll_created": false}' where user_id = tests.uid('bob');
select tests.logout();
select tests.set_var('bowling', (select id::text from public.activities where external_id = 'ber-strike-district'));
select tests.set_var('kino', (select id::text from public.activities where external_id = 'ber-lichtspielhaus-nord'));

-- ---- Erstellen --------------------------------------------------------------------------------------
select tests.login('mallory');
select throws_ok(
  $$ select public.create_poll(tests.var('crew')::uuid, 'Was machen wir?', now() + interval '1 day', '[{"title":"Kino"}]') $$,
  '42501', 'forbidden', 'Außenstehende können keine Abstimmung starten');

select tests.login('alice');
select throws_ok($$ select public.create_poll(tests.var('crew')::uuid, 'Was machen wir?', now() - interval '1 minute', '[{"title":"Kino"}]') $$, 'P0001', 'ends_in_past', 'Ende in der Vergangenheit wird abgelehnt');
select throws_ok($$ select public.create_poll(tests.var('crew')::uuid, 'Was machen wir?', now() + interval '1 day', '[]') $$, 'P0001', 'invalid_options', 'ohne Optionen keine Abstimmung');
select throws_ok($$ select public.create_poll(tests.var('crew')::uuid, 'Was machen wir?', now() + interval '1 day', (select jsonb_agg(jsonb_build_object('title', 'Option ' || g)) from generate_series(1, 11) g)) $$, 'P0001', 'invalid_options', 'höchstens zehn Optionen');
select throws_ok($$ select public.create_poll(tests.var('crew')::uuid, 'Was machen wir?', now() + interval '1 day', jsonb_build_array(jsonb_build_object('activity_id', gen_random_uuid()))) $$, 'P0001', 'unknown_activity', 'unbekannte Aktivität wird abgelehnt');
select throws_ok($$ select public.create_poll(tests.var('crew')::uuid, 'ab', now() + interval '1 day', '[{"title":"Kino"}]') $$, 'P0001', 'invalid_title', 'zu kurzer Titel wird abgelehnt');
select throws_ok($$ select public.create_poll(tests.var('crew')::uuid, 'Was machen wir?', now() + interval '1 day', '[{"title":"Kino"}]', p_budget_cents => -5) $$, '23514', null, 'negatives Budget wird abgelehnt');

select tests.set_var('poll', public.create_poll(
  tests.var('crew')::uuid, 'Was machen wir Samstag?', now() + interval '2 days',
  jsonb_build_array(
    jsonb_build_object('activity_id', tests.var('bowling'), 'proposed_date', '2031-06-14', 'proposed_time', '19:30', 'estimated_price_cents', 1800),
    jsonb_build_object('activity_id', tests.var('kino'), 'proposed_date', '2031-06-14', 'proposed_time', '20:15', 'estimated_price_cents', 1500),
    jsonb_build_object('title', '  Grillen   bei Bob ', 'proposed_date', '2031-06-14')),
  p_budget_cents => 3000, p_min_participants => 2)::text);

select tests.logout();
select is((select count(*)::int from public.poll_options where poll_id = tests.var('poll')::uuid), 3, 'drei Optionen gespeichert');
select is((select title from public.poll_options where poll_id = tests.var('poll')::uuid and position = 1), 'Strike District Bowling', 'Titel wird aus der Aktivität übernommen');
select is((select title from public.poll_options where poll_id = tests.var('poll')::uuid and position = 3), 'Grillen bei Bob', 'eigener Vorschlag wird bereinigt gespeichert');
select is((select count(*)::int from public.notifications where type = 'poll_created' and user_id = tests.uid('carol')), 1, 'Carol wird über die neue Abstimmung informiert');
select is((select count(*)::int from public.notifications where type = 'poll_created' and user_id = tests.uid('alice')), 0, 'wer die Abstimmung startet, bekommt keine Benachrichtigung');
select is((select count(*)::int from public.notifications where type = 'poll_created' and user_id = tests.uid('bob')), 0, 'abgeschaltete Benachrichtigungstypen werden respektiert');
select tests.set_var('opt1', (select id::text from public.poll_options where poll_id = tests.var('poll')::uuid and position = 1));
select tests.set_var('opt2', (select id::text from public.poll_options where poll_id = tests.var('poll')::uuid and position = 2));
select tests.set_var('opt3', (select id::text from public.poll_options where poll_id = tests.var('poll')::uuid and position = 3));

-- ---- Zugriff -----------------------------------------------------------------------------------------
select tests.login('mallory');
select is((select count(*)::int from public.polls), 0, 'Außenstehende sehen keine Abstimmungen');
select is((select count(*)::int from public.poll_options), 0, 'Außenstehende sehen keine Optionen');
select throws_ok($$ select public.cast_vote(tests.var('opt1')::uuid, 'yes') $$, '42501', 'forbidden', 'Außenstehende können nicht abstimmen');
select throws_ok($$ select public.close_poll(tests.var('poll')::uuid) $$, '42501', 'forbidden', 'Außenstehende können nicht beenden');
select throws_ok($$ select public.finalize_due_poll(tests.var('poll')::uuid) $$, '42501', 'forbidden', 'Außenstehende können nicht finalisieren');

-- ---- Abstimmen ---------------------------------------------------------------------------------------
select tests.login('bob');
select lives_ok($$ select public.cast_vote(tests.var('opt1')::uuid, 'yes') $$, 'Bob stimmt für Bowling');
select lives_ok($$ select public.cast_vote(tests.var('opt1')::uuid, 'maybe') $$, 'Bob ändert seine Antwort');
select lives_ok($$ select public.cast_vote(tests.var('opt1')::uuid, 'yes') $$, 'Bob ändert zurück');
select is((select count(*)::int from public.poll_votes where poll_option_id = tests.var('opt1')::uuid and user_id = tests.uid('bob')), 1, 'pro Person und Option existiert genau eine Stimme');
select throws_ok($$ insert into public.poll_votes (poll_id, poll_option_id, user_id, response) values (tests.var('poll')::uuid, tests.var('opt2')::uuid, tests.uid('carol'), 'yes') $$, '42501', null, 'Stimmen lassen sich nicht im Namen anderer einfügen');
select throws_ok($$ update public.poll_votes set response = 'no' $$, '42501', null, 'Stimmen lassen sich nicht direkt ändern');
select throws_ok($$ delete from public.poll_votes $$, '42501', null, 'Stimmen lassen sich nicht direkt löschen');
select throws_ok($$ update public.polls set status = 'closed', closed_at = now() $$, '42501', null, 'Abstimmungen lassen sich nicht direkt manipulieren');
select lives_ok($$ select public.cast_vote(tests.var('opt2')::uuid, 'no') $$, 'Bob lehnt Kino ab');
select lives_ok($$ select public.cast_vote(tests.var('opt3')::uuid, 'maybe') $$, 'Bob: vielleicht Grillen');
select lives_ok($$ select public.retract_vote(tests.var('opt3')::uuid) $$, 'Bob zieht eine Antwort zurück');
select is((select count(*)::int from public.poll_votes where user_id = tests.uid('bob')), 2, 'zurückgezogene Stimme ist entfernt');

select tests.login('carol');
select public.cast_vote(tests.var('opt1')::uuid, 'yes');
select public.cast_vote(tests.var('opt2')::uuid, 'yes');
select tests.login('alice');
select public.cast_vote(tests.var('opt1')::uuid, 'yes');
select is((select count(*)::int from public.poll_votes where poll_id = tests.var('poll')::uuid), 5, 'Mitglieder sehen alle gespeicherten Stimmen');
select is((select count(*)::int from public.notifications where type = 'poll_vote'), 2, 'Erstellerin erhält je abstimmender Person genau einen Hinweis');

-- ---- Erinnerung -----------------------------------------------------------------------------------------
select tests.login('carol');
select throws_ok($$ select public.remind_poll(tests.var('poll')::uuid) $$, '42501', 'forbidden', 'nur Erstellerin oder Admins erinnern');
select tests.login('alice');
select tests.set_var('poll_r', public.create_poll(tests.var('crew')::uuid, 'Sonntag Brunch?', now() + interval '1 day', '[{"title":"Brunch"}]')::text);
select tests.login('carol');
select public.cast_vote((select id from public.poll_options where poll_id = tests.var('poll_r')::uuid), 'yes');
select tests.login('alice');
select is(public.remind_poll(tests.var('poll_r')::uuid), 1, 'erinnert wird nur, wer noch nicht abgestimmt hat (Bob)');
select throws_ok($$ select public.remind_poll(tests.var('poll_r')::uuid) $$, 'P0001', 'reminder_too_soon', 'höchstens eine Erinnerung alle sechs Stunden');
select tests.logout();
select is((select user_id from public.notifications where type = 'poll_reminder' and related_entity_id = tests.var('poll_r')::uuid), tests.uid('bob'), 'die Erinnerung geht an Bob');

-- ---- Beenden und Ergebnis ---------------------------------------------------------------------------------
select tests.login('bob');
select throws_ok($$ select public.close_poll(tests.var('poll')::uuid) $$, '42501', 'forbidden', 'einfache Mitglieder können fremde Abstimmungen nicht beenden');
select is(public.finalize_due_poll(tests.var('poll')::uuid), false, 'vor Fristablauf ändert finalize nichts');
select tests.login('alice');
select throws_ok($$ select public.create_plan_from_poll(tests.var('poll')::uuid, tests.var('opt1')::uuid) $$, 'P0001', 'poll_still_open', 'kein Plan, solange die Abstimmung läuft');
select lives_ok($$ select public.close_poll(tests.var('poll')::uuid) $$, 'Erstellerin beendet die Abstimmung');
select is((select status::text from public.polls where id = tests.var('poll')::uuid), 'closed', 'Status ist closed');
select is((select winning_option_id from public.polls where id = tests.var('poll')::uuid), tests.var('opt1')::uuid, 'Gewinner ist die Option mit den meisten Zusagen (3 vs. 1)');
select is((select is_tie from public.polls where id = tests.var('poll')::uuid), false, 'kein Gleichstand');
select lives_ok($$ select public.close_poll(tests.var('poll')::uuid) $$, 'erneutes Beenden ist folgenlos');
select tests.login('bob');
select throws_ok($$ select public.cast_vote(tests.var('opt2')::uuid, 'yes') $$, 'P0001', 'poll_closed', 'nach dem Ende sind keine Stimmen mehr möglich');
select throws_ok($$ select public.retract_vote(tests.var('opt1')::uuid) $$, 'P0001', 'poll_closed', 'nach dem Ende lässt sich nichts zurückziehen');
select is((select count(*)::int from public.notifications where type = 'poll_result' and user_id = tests.uid('bob')), 1, 'Mitglieder erfahren das Ergebnis');

-- ---- Gleichstand und Stichwahl ---------------------------------------------------------------------------------
select tests.login('alice');
select tests.set_var('poll_t', public.create_poll(tests.var('crew')::uuid, 'Freitagabend', now() + interval '1 day',
  '[{"title":"Bar"},{"title":"Kino"},{"title":"Zuhause"}]')::text);
select tests.set_var('t1', (select id::text from public.poll_options where poll_id = tests.var('poll_t')::uuid and position = 1));
select tests.set_var('t2', (select id::text from public.poll_options where poll_id = tests.var('poll_t')::uuid and position = 2));
select public.cast_vote(tests.var('t1')::uuid, 'yes');
select tests.login('bob');
select public.cast_vote(tests.var('t2')::uuid, 'yes');
select tests.login('alice');
select throws_ok($$ select public.start_runoff_poll(tests.var('poll_t')::uuid, 'Stichwahl: Freitagabend', now() + interval '1 day') $$, 'P0001', 'no_tie', 'Stichwahl nur nach beendeter Abstimmung mit Gleichstand');
select public.close_poll(tests.var('poll_t')::uuid);
select is((select is_tie from public.polls where id = tests.var('poll_t')::uuid), true, 'Gleichstand wird erkannt');
select is((select winning_option_id from public.polls where id = tests.var('poll_t')::uuid), null, 'bei Gleichstand gibt es keinen Gewinner');
select tests.login('bob');
select throws_ok($$ select public.start_runoff_poll(tests.var('poll_t')::uuid, 'Stichwahl: Freitagabend', now() + interval '1 day') $$, '42501', 'forbidden', 'nur Erstellerin oder Admins starten die Stichwahl');
select tests.login('alice');
select tests.set_var('runoff', public.start_runoff_poll(tests.var('poll_t')::uuid, 'Stichwahl: Freitagabend', now() + interval '1 day')::text);
select is((select array_agg(title order by position) from public.poll_options where poll_id = tests.var('runoff')::uuid), array['Bar', 'Kino'], 'die Stichwahl enthält nur die gleichauf liegenden Optionen');
select is((select parent_poll_id from public.polls where id = tests.var('runoff')::uuid), tests.var('poll_t')::uuid, 'die Stichwahl verweist auf die Ursprungsabstimmung');
select throws_ok($$ select public.start_runoff_poll(tests.var('poll_t')::uuid, 'Noch eine', now() + interval '1 day') $$, 'P0001', 'runoff_exists', 'pro Abstimmung nur eine Stichwahl');

-- ---- Keine Zusagen ---------------------------------------------------------------------------------------------
select tests.set_var('poll_n', public.create_poll(tests.var('crew')::uuid, 'Montag?', now() + interval '1 day', '[{"title":"Sauna"},{"title":"Sport"}]')::text);
select public.cast_vote((select id from public.poll_options where poll_id = tests.var('poll_n')::uuid and position = 1), 'maybe');
select public.close_poll(tests.var('poll_n')::uuid);
select is((select winning_option_id from public.polls where id = tests.var('poll_n')::uuid), null, 'ohne Zusagen gibt es keinen Gewinner');
select is((select is_tie from public.polls where id = tests.var('poll_n')::uuid), false, '… und auch keinen Gleichstand ("vielleicht" zählt nicht)');

-- ---- Fristablauf --------------------------------------------------------------------------------------------------
select tests.set_var('poll_d', public.create_poll(tests.var('crew')::uuid, 'Läuft ab', now() + interval '1 hour', '[{"title":"Pizza"}]')::text);
select tests.set_var('d1', (select id::text from public.poll_options where poll_id = tests.var('poll_d')::uuid));
select public.cast_vote(tests.var('d1')::uuid, 'yes');
select tests.logout();
update public.polls set ends_at = now() - interval '1 second' where id = tests.var('poll_d')::uuid;
select tests.login('bob');
select throws_ok($$ select public.cast_vote(tests.var('d1')::uuid, 'yes') $$, 'P0001', 'poll_closed', 'nach Fristablauf zählt keine Stimme mehr, auch wenn der Status noch "open" ist');
select is(public.finalize_due_poll(tests.var('poll_d')::uuid), true, 'jedes Mitglied kann das Ergebnis nach Fristablauf feststellen lassen');
select is((select winning_option_id from public.polls where id = tests.var('poll_d')::uuid), tests.var('d1')::uuid, 'Ergebnis nach Fristablauf steht fest');
select is((select closed_by from public.polls where id = tests.var('poll_d')::uuid), null, 'automatisch geschlossen (kein closed_by)');

-- Cron-Variante
select tests.login('alice');
select tests.set_var('poll_c', public.create_poll(tests.var('crew')::uuid, 'Cron-Test', now() + interval '1 hour', '[{"title":"Eis"}]')::text);
select throws_ok('select app_private.finalize_due_polls()', '42501', null, 'die Cron-Funktion ist für Nutzer gesperrt');
select tests.logout();
update public.polls set ends_at = now() - interval '1 second' where id = tests.var('poll_c')::uuid;
select ok(app_private.finalize_due_polls() >= 1, 'finalize_due_polls schließt fällige Abstimmungen');
select is((select status::text from public.polls where id = tests.var('poll_c')::uuid), 'closed', '… darunter die eben abgelaufene');
select is((select status::text from public.polls where id = tests.var('poll_r')::uuid), 'open', '… laufende Abstimmungen bleiben offen');

-- ---- Austritt entfernt Stimmen in offenen Abstimmungen ----------------------------------------------------------------
select tests.login('bob');
select public.cast_vote((select id from public.poll_options where poll_id = tests.var('runoff')::uuid and position = 1), 'yes');
select public.leave_crew(tests.var('crew')::uuid);
select tests.logout();
select is((select count(*)::int from public.poll_votes v join public.polls p on p.id = v.poll_id where v.user_id = tests.uid('bob') and p.status = 'open'), 0, 'wer austritt, verliert seine Stimmen in offenen Abstimmungen');
select ok((select count(*) from public.poll_votes v join public.polls p on p.id = v.poll_id where v.user_id = tests.uid('bob') and p.status = 'closed') > 0, 'abgeschlossene Ergebnisse bleiben unverändert');

select * from finish();
rollback;
