-- P46 Etappe 2: Antwortfrist – am letzten Tag vor Ablauf genau eine Erinnerung an alle Mitglieder ohne Antwort,
-- nach Ablauf genau einmal der Stand an die Person, die den Plan angelegt hat. Nicht kurz nach einer Nachfrage
-- von Hand, nicht nach Beginn, nicht bei abgesagten/abgeschlossenen Plänen, abschaltbar; die App stößt nur Pläne
-- der eigenen Crews an; Außenstehende, anon und ehemalige Mitglieder bekommen nichts; Verschieben schickt nichts doppelt.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Carol');
select tests.make_user('Dave');
select tests.make_user('Erin');
select tests.make_user('Mallory');

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew', '🎳')::text);
select tests.set_var('invite', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob');
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('carol');
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('dave');
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('erin');
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('mallory');
select tests.set_var('mallory_crew', public.create_crew('Fremde Crew')::text);
select tests.set_var('fremd', public.create_plan(tests.var('mallory_crew')::uuid, 'Fremder Abend', now() + interval '3 days', p_confirmed => true)::text);

-- Bob organisiert drei Pläne; alle in der Crew sind eingeladen, Bob ist dabei.
select tests.login('bob');
select tests.set_var('bowling', public.create_plan(tests.var('crew')::uuid, 'Bowling', now() + interval '3 days', p_confirmed => true)::text);
select tests.set_var('kino', public.create_plan(tests.var('crew')::uuid, 'Kino', now() + interval '5 days', p_confirmed => true)::text);
select tests.set_var('abgesagt', public.create_plan(tests.var('crew')::uuid, 'Pizza', now() + interval '3 days', p_confirmed => true)::text);
select public.set_plan_answer_by(tests.var('bowling')::uuid, now() + interval '2 days');
select public.set_plan_answer_by(tests.var('kino')::uuid, now() + interval '2 days');
select public.set_plan_answer_by(tests.var('abgesagt')::uuid, now() + interval '2 days');
select tests.login('mallory');
select public.set_plan_answer_by(tests.var('fremd')::uuid, now() + interval '2 days');

-- Alice sagt zu, Carol sagt „vielleicht“ – beide haben geantwortet. Dave und Erin fehlen.
select tests.login('alice');
select public.set_attendance(tests.var('bowling')::uuid, 'going');
select tests.login('carol');
select public.set_attendance(tests.var('bowling')::uuid, 'maybe');
select tests.logout();
update public.plans set status = 'cancelled' where id = tests.var('abgesagt')::uuid;
-- Für „Kino“ hat Bob vor einer Stunde (vom Prüfzeitpunkt aus) schon von Hand nachgefragt.
insert into public.plan_reminders (plan_id, last_sent_at) values (tests.var('kino')::uuid, now() + interval '1 day 5 hours');
-- Erin hat „Nachfragen zu Plänen“ abgeschaltet.
update public.user_settings set notification_preferences = '{"plan_reminder": false}' where user_id = tests.uid('erin');
delete from public.notifications;

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.send_plan_answer_by_reminders()', 'execute'), 'anon darf nichts anstoßen');
select ok(has_function_privilege('authenticated', 'public.send_plan_answer_by_reminders()', 'execute'), 'angemeldete Personen dürfen anstoßen');
select ok(not has_function_privilege('authenticated', 'app_private.send_plan_answer_by_reminders(uuid, timestamptz)', 'execute'), 'mit eigener Uhrzeit gesperrt');
select ok(not has_function_privilege('authenticated', 'app_private.send_due_plan_answer_by_reminders()', 'execute'), 'für alle gesperrt');
select ok(not has_table_privilege('authenticated', 'public.plan_answer_by_notices', 'select'), 'die Liste ist nicht lesbar');
select ok(not has_table_privilege('authenticated', 'public.plan_answer_by_notices', 'insert'), 'die Liste ist nicht beschreibbar');
select ok(not has_table_privilege('anon', 'public.plan_answer_by_notices', 'select'), 'anon liest die Liste nicht');

select tests.login_anon();
select throws_ok($$ select public.send_plan_answer_by_reminders() $$, '42501', null, 'ohne Konto: verboten');

-- ---- Zeitfenster ---------------------------------------------------------------------------------
select tests.logout();
select is(app_private.send_plan_answer_by_reminders(tests.uid('carol'), now() + interval '20 hours'), 0,
          'mehr als 24 Stunden vor Ablauf ist noch nichts fällig');
select is(app_private.send_plan_answer_by_reminders(null, null), 0, 'ohne Zeitpunkt nichts');

-- Mallory stößt an: nur ihre eigene Crew (dort ist niemand außer ihr, und sie ist dabei).
select is(app_private.send_plan_answer_by_reminders(tests.uid('mallory'), now() + interval '1 day 6 hours'), 0,
          'Mallorys Aufruf erinnert niemanden in fremden Crews');
select is((select count(*)::int from public.notifications n where n.related_entity_id = tests.var('bowling')::uuid), 0,
          'Mallory löst nichts in fremden Crews aus');

-- Carol öffnet die App 18 Stunden vor Ablauf: Dave und Erin fehlen bei „Bowling“.
select is(app_private.send_plan_answer_by_reminders(tests.uid('carol'), now() + interval '1 day 6 hours'), 2,
          '18 Stunden vorher: Dave und Erin bei „Bowling“ (Kino: gerade erst nachgefragt, Pizza: abgesagt)');
select is((select array_agg(n.user_id order by n.user_id) from public.plan_answer_by_notices n
           where n.plan_id = tests.var('bowling')::uuid and n.kind = 'reminder'),
          (select array_agg(u order by u) from unnest(array[tests.uid('dave'), tests.uid('erin')]) u),
          'nur wer noch „eingeladen“ ist – „vielleicht“ zählt als Antwort');
select is((select count(*)::int from public.notifications n where n.user_id = tests.uid('dave') and n.type = 'plan_reminder'
             and n.related_entity_id = tests.var('bowling')::uuid and n.actor_id is null
             and (n.payload ->> 'deadline')::boolean and n.payload ? 'answer_by' and n.payload ->> 'title' = 'Bowling'), 1,
          'Dave bekommt die Erinnerung mit Frist und ohne auslösende Person');
select is((select count(*)::int from public.notifications n where n.user_id = tests.uid('erin')), 0,
          'Erin hat die Gruppe abgeschaltet – keine Benachrichtigung');
select is((select count(*)::int from public.notifications n where n.related_entity_id = tests.var('kino')::uuid), 0,
          'kurz nach einer Nachfrage von Hand keine zweite');
select is((select count(*)::int from public.notifications n where n.related_entity_id = tests.var('abgesagt')::uuid), 0,
          'abgesagte Pläne erinnern nicht');

select is(app_private.send_plan_answer_by_reminders(tests.uid('dave'), now() + interval '1 day 7 hours'), 0,
          'zweiter Anstoß: niemand doppelt');

-- Sechs Stunden nach der Nachfrage von Hand ist „Kino“ dran (Dave, Erin, Carol, Alice – nur Bob ist dabei).
select is(app_private.send_plan_answer_by_reminders(tests.uid('alice'), now() + interval '1 day 12 hours'), 4,
          'nach den 6 Stunden erinnert auch „Kino“');

-- ---- Frist verschieben: niemand wird doppelt erinnert -----------------------------------------------------
select tests.login('bob');
select public.set_plan_answer_by(tests.var('bowling')::uuid, now() + interval '2 days 3 hours');
select tests.logout();
select is(app_private.send_plan_answer_by_reminders(tests.uid('alice'), now() + interval '1 day 23 hours'), 0,
          'nach dem Verschieben keine zweite Erinnerung');

-- ---- Nach Ablauf: der Stand an Bob ---------------------------------------------------------------
select is(app_private.send_plan_answer_by_reminders(tests.uid('alice'), now() + interval '2 days 4 hours'), 2,
          'nach Ablauf: der Stand für „Bowling“ und „Kino“ an Bob');
select is((select (n.payload ->> 'going')::int || '/' || (n.payload ->> 'unsure')::int || '/' || (n.payload ->> 'open')::int
           from public.notifications n where n.user_id = tests.uid('bob') and n.related_entity_id = tests.var('bowling')::uuid
             and (n.payload ->> 'deadline_over')::boolean and n.actor_id is null),
          '2/1/2', 'Bowling: 2 dabei (Bob, Alice), 1 vielleicht (Carol), 2 offen (Dave, Erin)');
select is((select count(*)::int from public.notifications n where n.user_id <> tests.uid('bob') and (n.payload ->> 'deadline_over')::boolean), 0,
          'den Stand bekommt nur, wer den Plan angelegt hat');
select is(app_private.send_plan_answer_by_reminders(tests.uid('alice'), now() + interval '2 days 5 hours'), 0, 'den Stand gibt es nur einmal');
select is((select count(*)::int from public.notifications n where n.related_entity_id = tests.var('abgesagt')::uuid), 0,
          'abgesagt: auch kein Stand');

-- ---- Nach Beginn nichts mehr; Austritt; pg_cron ----------------------------------------------------------------
select is(app_private.send_plan_answer_by_reminders(null, now() + interval '4 days'), 0,
          'nach Beginn nichts mehr (Bowling und Mallorys Abend begannen nach 3 Tagen)');

-- Erin legt einen Plan mit Frist an und verlässt danach die Crew: Sie bekommt keinen Stand mehr.
select tests.login('erin');
select tests.set_var('erin_plan', public.create_plan(tests.var('crew')::uuid, 'Erins Abend', now() + interval '10 days', p_confirmed => true)::text);
select public.set_plan_answer_by(tests.var('erin_plan')::uuid, now() + interval '9 days');
select tests.logout();
delete from public.crew_members where crew_id = tests.var('crew')::uuid and user_id = tests.uid('erin');
select is(app_private.send_plan_answer_by_reminders(tests.uid('alice'), now() + interval '9 days 1 hour'), 0,
          'wer nicht mehr in der Crew ist, bekommt keinen Stand');
select is((select count(*)::int from public.plan_answer_by_notices n where n.user_id = tests.uid('erin') and n.plan_id = tests.var('erin_plan')::uuid), 0,
          'auch nicht als verschickt vermerkt');
select is(app_private.send_due_plan_answer_by_reminders(), 0, 'pg_cron-Variante läuft (jetzt ist nichts fällig)');

-- Die App-Variante: angemeldet, mit Rate Limit.
select tests.login('carol');
select lives_ok($$ select public.send_plan_answer_by_reminders() $$, 'Mitglieder stoßen an');

select * from finish();
rollback;
