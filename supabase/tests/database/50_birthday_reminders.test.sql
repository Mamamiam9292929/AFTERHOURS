-- P20 Etappe 2: Geburtstags-Erinnerung – 1 bis 7 Tage vorher (Berliner Zeit) genau einmal an die anderen
-- Mitglieder der Crews, nicht an das Geburtstagskind, nur eine bei mehreren gemeinsamen Crews, abschaltbar;
-- 29. Februar in Jahren ohne Schalttag am 28.; die App stößt nur die eigenen Crews an; Außenstehende, anon
-- und ehemalige Mitglieder bekommen nichts. Dazu `my_crew_birthdays` für Home.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Carol');
select tests.make_user('Dave');
select tests.make_user('Erik');
select tests.make_user('Mallory');

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew', '🎳')::text);
select tests.set_var('invite', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Bob tritt bei');
select tests.login('carol');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Carol tritt bei');
select tests.login('dave');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Dave tritt bei');
-- Alice und Bob sind zusätzlich in einer zweiten, jüngeren Crew.
select tests.login('alice');
select tests.set_var('crew2', public.create_crew('Zweite Crew', '🍕')::text);
select tests.set_var('invite2', (select token from public.create_crew_invitation(tests.var('crew2')::uuid)));
select tests.login('bob');
select is(public.accept_crew_invitation(tests.var('invite2')) ->> 'status', 'joined', 'Bob tritt der zweiten Crew bei');
select tests.logout();
update public.crews set created_at = now() - interval '30 days' where id = tests.var('crew')::uuid;
select tests.login('mallory');
select tests.set_var('mallory_crew', public.create_crew('Fremde Crew')::text);

-- Geburtstage: Bob 14. November, Carol 29. Februar, Alice 1. Juni (weit weg), Mallory 15. November.
select tests.login('bob');
select lives_ok($$ select public.set_my_birthday(11, 14) $$, 'Bob trägt den 14. November ein');
select tests.login('carol');
select lives_ok($$ select public.set_my_birthday(2, 29) $$, 'Carol trägt den 29. Februar ein');
select tests.login('alice');
select lives_ok($$ select public.set_my_birthday(6, 1) $$, 'Alice trägt den 1. Juni ein');
select tests.login('mallory');
select lives_ok($$ select public.set_my_birthday(11, 15) $$, 'Mallory trägt den 15. November ein');
select tests.logout();
delete from public.notifications;

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.send_birthday_reminders()', 'execute'), 'anon darf keine Erinnerungen anstoßen');
select ok(has_function_privilege('authenticated', 'public.send_birthday_reminders()', 'execute'), 'angemeldete Personen dürfen anstoßen');
select ok(not has_function_privilege('authenticated', 'app_private.send_birthday_reminders(uuid, timestamptz)', 'execute'), 'Erinnerungen mit eigener Uhrzeit sind gesperrt');
select ok(not has_function_privilege('authenticated', 'app_private.send_due_birthday_reminders()', 'execute'), 'Erinnerungen für alle sind gesperrt');
select ok(not has_function_privilege('anon', 'public.my_crew_birthdays()', 'execute'), 'anon liest keine Geburtstage der Crews');
select ok(has_function_privilege('authenticated', 'public.my_crew_birthdays()', 'execute'), 'angemeldete Personen lesen die Geburtstage ihrer Crews');
select ok(not has_table_privilege('authenticated', 'public.birthday_reminders', 'select'), 'die Erinnerungsliste ist nicht lesbar');
select ok(not has_table_privilege('authenticated', 'public.birthday_reminders', 'insert'), 'die Erinnerungsliste ist nicht beschreibbar');
select ok(not has_table_privilege('anon', 'public.birthday_reminders', 'select'), 'anon liest die Erinnerungsliste nicht');
select matches((select pg_get_constraintdef(c.oid) from pg_constraint c where c.conname = 'notifications_type_check'), 'birthday_reminder', 'neuer Benachrichtigungstyp erlaubt');
select matches((select pg_get_constraintdef(c.oid) from pg_constraint c where c.conname = 'notifications_type_check'), 'plan_photo_nudge.*plan_reminder|plan_reminder.*plan_photo_nudge', 'bisherige Typen bleiben erlaubt');

select tests.login_anon();
select throws_ok($$ select public.send_birthday_reminders() $$, '42501', null, 'anon kann nichts anstoßen');
select throws_ok($$ select * from public.my_crew_birthdays() $$, '42501', null, 'anon liest nichts');

-- ---- Datumsrechnung ------------------------------------------------------------------------------
select tests.logout();
select is(app_private.next_birthday(11, 14, '2026-11-04'), '2026-11-14'::date, 'nächster Geburtstag noch in diesem Jahr');
select is(app_private.next_birthday(11, 14, '2026-11-14'), '2026-11-14'::date, 'heute zählt');
select is(app_private.next_birthday(1, 2, '2026-12-30'), '2027-01-02'::date, 'über den Jahreswechsel');
select is(app_private.next_birthday(2, 29, '2027-01-10'), '2027-02-28'::date, '29. Februar ohne Schalttag am 28.');
select is(app_private.next_birthday(2, 29, '2028-01-10'), '2028-02-29'::date, '29. Februar im Schaltjahr');
select is(app_private.next_birthday(2, 29, '2027-03-01'), '2028-02-29'::date, 'nach dem 28. Februar: nächstes Schaltjahr');

-- ---- Home: Geburtstage der eigenen Crews ------------------------------------------------------------
select tests.login('alice');
select is((select count(*)::int from public.my_crew_birthdays() where user_id = tests.uid('alice')), 0, 'Alice sieht sich selbst nicht');
select is((select count(*)::int from public.my_crew_birthdays() where user_id = tests.uid('bob')), 2, 'Bob einmal je gemeinsamer Crew');
select is((select array[month, day] from public.my_crew_birthdays() where user_id = tests.uid('carol')), array[2, 29], 'Carol mit Tag und Monat');
select is((select count(*)::int from public.my_crew_birthdays() where user_id = tests.uid('mallory')), 0, 'Mallory (andere Crew) taucht nicht auf');
select tests.login('mallory');
select is((select count(*)::int from public.my_crew_birthdays()), 0, 'Mallory sieht keine fremden Geburtstage');

-- ---- Zeitfenster ---------------------------------------------------------------------------------
select tests.logout();
-- Dave hat die Gruppe abgeschaltet.
update public.user_settings set notification_preferences = '{"birthday_reminder": false}' where user_id = tests.uid('dave');

select is(app_private.send_birthday_reminders(tests.uid('carol'), '2026-11-06 23:30+01'), 0, '8 Tage vorher: nichts');
select is(app_private.send_birthday_reminders(tests.uid('mallory'), '2026-11-07 00:30+01'), 0, 'Mallory ist allein in ihrer Crew – nichts, und nichts in fremden Crews');
select is((select count(*)::int from public.notifications n where n.type = 'birthday_reminder'), 0, 'Mallory löst nichts aus');

-- Kurz nach Mitternacht Berliner Zeit (in UTC noch der 6.) sind es 7 Tage.
select is(app_private.send_birthday_reminders(tests.uid('carol'), '2026-11-06 23:30:00+00'), 3, '7 Tage vorher: Bobs Geburtstag an Alice, Carol und Dave');
select is((select array_agg(r.user_id order by r.user_id) from public.birthday_reminders r where r.birthday_user_id = tests.uid('bob')),
          (select array_agg(u order by u) from unnest(array[tests.uid('alice'), tests.uid('carol'), tests.uid('dave')]) u),
          'je Person einmal, nicht an Bob selbst');
select is((select count(*)::int from public.notifications n where n.user_id = tests.uid('alice') and n.type = 'birthday_reminder'), 1,
          'Alice bekommt nur eine, obwohl sie mit Bob in zwei Crews ist');
select is((select n.crew_id from public.notifications n where n.user_id = tests.uid('alice') and n.type = 'birthday_reminder'), tests.var('crew')::uuid,
          'über die ältere gemeinsame Crew');
select is((select n.payload ->> 'date' from public.notifications n where n.user_id = tests.uid('carol') and n.type = 'birthday_reminder'), '2026-11-14', 'mit dem Datum');
select is((select n.payload ->> 'crew_name' from public.notifications n where n.user_id = tests.uid('carol') and n.type = 'birthday_reminder'), 'Weekend Crew', 'mit dem Namen der Crew');
select is((select n.entity_type || ':' || (n.related_entity_id = tests.var('crew')::uuid) || ':' || (n.actor_id = tests.uid('bob'))
           from public.notifications n where n.user_id = tests.uid('carol') and n.type = 'birthday_reminder'), 'crew:true:true', 'führt zur Crew, Bob als Person');
select is((select count(*)::int from public.notifications n where n.user_id = tests.uid('bob') and n.type = 'birthday_reminder'), 0, 'das Geburtstagskind bekommt nichts');
select is((select count(*)::int from public.notifications n where n.user_id = tests.uid('dave') and n.type = 'birthday_reminder'), 0, 'Dave hat abgeschaltet und bekommt nichts');
select is((select count(*)::int from public.notifications n where n.user_id = tests.uid('mallory') and n.type = 'birthday_reminder'), 0, 'Mallory bekommt nichts aus fremden Crews');
select is((select count(*)::int from public.birthday_reminders r where r.birthday_user_id = tests.uid('mallory')), 0, 'Mallorys Geburtstag geht an niemanden (allein in ihrer Crew)');

-- Genau einmal – auch wenn die Benachrichtigung gelöscht wird.
select is(app_private.send_birthday_reminders(tests.uid('alice'), '2026-11-08 12:00+01'), 0, 'ein zweiter Aufruf erinnert nicht noch einmal');
delete from public.notifications n where n.user_id = tests.uid('carol') and n.type = 'birthday_reminder';
select is(app_private.send_birthday_reminders(tests.uid('carol'), '2026-11-09 12:00+01'), 0, 'gelöschte Erinnerung kommt nicht wieder');

-- Wer kurz vorher dazukommt, wird noch erinnert; am Tag selbst nicht mehr.
select tests.login('erik');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Erik tritt bei');
select tests.logout();
select is(app_private.send_birthday_reminders(tests.uid('erik'), '2026-11-14 10:00+01'), 0, 'am Geburtstag selbst: keine Erinnerung mehr');
select is(app_private.send_birthday_reminders(tests.uid('erik'), '2026-11-13 10:00+01'), 1, 'einen Tag vorher: Erik wird noch erinnert');

-- ---- 29. Februar, ehemalige Mitglieder, Aufräumen, Cron -----------------------------------------------
select tests.login('dave');
select lives_ok($$ select public.leave_crew(tests.var('crew')::uuid) $$, 'Dave verlässt die Crew');
select tests.logout();
select lives_ok($$ select app_private.send_birthday_reminders(null, '2027-02-21 10:00+01') $$, 'Cron am 21. Februar 2027 läuft');
select is((select array_agg(r.user_id order by r.user_id) from public.birthday_reminders r where r.birthday_user_id = tests.uid('carol')),
          (select array_agg(u order by u) from unnest(array[tests.uid('alice'), tests.uid('bob'), tests.uid('erik')]) u),
          'Carols Geburtstag an Alice, Bob und Erik – nicht an Dave (ehemaliges Mitglied)');
select is((select distinct r.birthday from public.birthday_reminders r where r.birthday_user_id = tests.uid('carol')), '2027-02-28'::date,
          '2027 ohne Schalttag: am 28. Februar');
select is((select count(*)::int from public.birthday_reminders r where r.birthday = '2026-11-14'), 0, 'alte Einträge sind aufgeräumt');
select lives_ok($$ select app_private.send_due_birthday_reminders() $$, 'Cron mit echter Uhrzeit läuft');

-- ---- Aufruf aus der App und Rate Limit -----------------------------------------------------------
select tests.login('mallory');
select is((select count(public.send_birthday_reminders())::int from generate_series(1, 120)), 120, '120 Aufrufe je Stunde gehen');
select throws_ok($$ select public.send_birthday_reminders() $$, 'P0001', 'rate_limited', 'mehr als 120 Aufrufe je Stunde werden abgewiesen');

-- ---- Kontolöschung -------------------------------------------------------------------------------
select tests.logout();
delete from auth.users where id = tests.uid('carol');
select is((select count(*)::int from public.birthday_reminders r where r.birthday_user_id = tests.uid('carol') or r.user_id = tests.uid('carol')), 0,
          'Kontolöschung entfernt die Erinnerungsliste');

select * from finish();
rollback;
