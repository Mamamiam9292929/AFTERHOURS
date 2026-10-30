-- P15: Endspurt-Erinnerung – in den letzten 3 Stunden einer laufenden Abstimmung genau einmal an alle
-- Mitglieder ohne Stimme; nicht bei kurzen Abstimmungen (unter 6 Stunden), nicht kurz nach einer
-- Erinnerung von Hand, nicht nach dem Ende oder bei entschiedenen Abstimmungen, abschaltbar; die App
-- stößt nur Abstimmungen der eigenen Crews an, Außenstehende, anon und ehemalige Mitglieder bekommen nichts.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Carol');
select tests.make_user('Dave');
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
select tests.login('mallory');
select tests.set_var('mallory_crew', public.create_crew('Fremde Crew')::text);

-- Freitag, 6. November 2026 (Berliner Winterzeit, UTC+1). Abstimmungen direkt angelegt, damit
-- Laufzeit und Ende frei wählbar sind.
select tests.logout();
insert into public.polls (crew_id, created_by, title, ends_at, created_at) values
  (tests.var('crew')::uuid, tests.uid('alice'), 'Was machen wir am Samstag?', '2026-11-06 20:00+01', '2026-11-04 12:00+01'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Kurz gefragt', '2026-11-06 20:00+01', '2026-11-06 16:00+01'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Schon erinnert', '2026-11-06 20:00+01', '2026-11-04 12:00+01'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Später', '2026-11-07 12:00+01', '2026-11-04 12:00+01'),
  (tests.var('mallory_crew')::uuid, tests.uid('mallory'), 'Fremde Frage', '2026-11-06 20:00+01', '2026-11-04 12:00+01');
select tests.set_var(case title when 'Was machen wir am Samstag?' then 'samstag' when 'Kurz gefragt' then 'kurz'
                     when 'Schon erinnert' then 'erinnert' when 'Später' then 'spaeter' else 'fremd' end, id::text)
  from public.polls where title in ('Was machen wir am Samstag?', 'Kurz gefragt', 'Schon erinnert', 'Später', 'Fremde Frage');
update public.polls set last_reminded_at = '2026-11-06 16:30+01' where id = tests.var('erinnert')::uuid;
insert into public.poll_options (poll_id, title, position) values
  (tests.var('samstag')::uuid, 'Bowling', 0), (tests.var('samstag')::uuid, 'Kino', 1),
  (tests.var('kurz')::uuid, 'Bar', 0), (tests.var('erinnert')::uuid, 'Pizza', 0),
  (tests.var('spaeter')::uuid, 'Brunch', 0), (tests.var('fremd')::uuid, 'Irgendwas', 0);
select tests.set_var('bowling', (select id::text from public.poll_options where poll_id = tests.var('samstag')::uuid and title = 'Bowling'));
select tests.set_var('kino', (select id::text from public.poll_options where poll_id = tests.var('samstag')::uuid and title = 'Kino'));
-- Alice hat zugesagt, Bob nur bei einem Vorschlag „nein“ gesagt – beide haben abgestimmt.
insert into public.poll_votes (poll_id, poll_option_id, user_id, response) values
  (tests.var('samstag')::uuid, tests.var('bowling')::uuid, tests.uid('alice'), 'yes'),
  (tests.var('samstag')::uuid, tests.var('kino')::uuid, tests.uid('bob'), 'no');
delete from public.notifications;

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.send_poll_closing_reminders()', 'execute'), 'anon darf keine Erinnerungen anstoßen');
select ok(has_function_privilege('authenticated', 'public.send_poll_closing_reminders()', 'execute'), 'angemeldete Personen dürfen anstoßen');
select ok(not has_function_privilege('authenticated', 'app_private.send_poll_closing_reminders(uuid, timestamptz)', 'execute'), 'Erinnerungen mit eigener Uhrzeit sind gesperrt');
select ok(not has_function_privilege('authenticated', 'app_private.send_due_poll_closing_reminders()', 'execute'), 'Erinnerungen für alle sind gesperrt');
select ok(not has_table_privilege('authenticated', 'public.poll_closing_reminders', 'select'), 'die Erinnerungsliste ist nicht lesbar');
select ok(not has_table_privilege('authenticated', 'public.poll_closing_reminders', 'insert'), 'die Erinnerungsliste ist nicht beschreibbar');
select ok(not has_table_privilege('anon', 'public.poll_closing_reminders', 'select'), 'anon liest die Erinnerungsliste nicht');

select tests.login_anon();
select throws_ok($$ select public.send_poll_closing_reminders() $$, '42501', null, 'anon kann nichts anstoßen');

-- ---- Zeitfenster ---------------------------------------------------------------------------------
select tests.logout();
select is(app_private.send_poll_closing_reminders(tests.uid('carol'), '2026-11-06 16:30+01'), 0, '3,5 Stunden vor dem Ende ist noch nichts fällig');

-- Dave hat „Erinnerungen“ abgeschaltet.
update public.user_settings set notification_preferences = '{"poll_reminder": false}' where user_id = tests.uid('dave');

-- Mallory stößt an: nur ihre eigene Crew (sie selbst hat nicht abgestimmt).
select is(app_private.send_poll_closing_reminders(tests.uid('mallory'), '2026-11-06 17:00+01'), 1, 'Mallorys Aufruf erinnert nur ihre eigene Crew');
select is((select count(*)::int from public.notifications n where n.related_entity_id = tests.var('samstag')::uuid), 0,
          'Mallory löst nichts in fremden Crews aus');

-- Carol öffnet die App um 17 Uhr: die ganze Crew erfährt es.
select is(app_private.send_poll_closing_reminders(tests.uid('carol'), '2026-11-06 17:00+01'), 2, 'drei Stunden vorher: Carol und Dave in der Samstags-Abstimmung');
select is((select array_agg(r.user_id order by r.user_id) from public.poll_closing_reminders r where r.poll_id = tests.var('samstag')::uuid),
          (select array_agg(u order by u) from unnest(array[tests.uid('carol'), tests.uid('dave')]) u),
          'nur wer noch keine Stimme hat – auch ein „nein“ zählt als Stimme');
select is((select count(*)::int from public.poll_closing_reminders r where r.poll_id = tests.var('kurz')::uuid), 0,
          'kurze Abstimmung (4 Stunden Laufzeit): keine Erinnerung');
select is((select count(*)::int from public.poll_closing_reminders r where r.poll_id = tests.var('erinnert')::uuid), 0,
          'vor einer halben Stunde von Hand erinnert: keine zweite Erinnerung');
select is((select count(*)::int from public.poll_closing_reminders r where r.poll_id = tests.var('spaeter')::uuid), 0,
          'Abstimmung, die erst morgen endet: noch nichts');

select is((select count(*)::int from public.notifications n where n.user_id = tests.uid('carol') and n.type = 'poll_reminder'), 1, 'Carol bekommt eine Erinnerung');
select is((select n.actor_id from public.notifications n where n.user_id = tests.uid('carol') and n.type = 'poll_reminder'), null::uuid, 'ohne auslösende Person');
select is((select n.payload ->> 'closing' from public.notifications n where n.user_id = tests.uid('carol') and n.type = 'poll_reminder'), 'true', 'als Endspurt gekennzeichnet');
select is((select (n.payload ->> 'ends_at')::timestamptz from public.notifications n where n.user_id = tests.uid('carol') and n.type = 'poll_reminder'),
          '2026-11-06 20:00+01'::timestamptz, 'mit dem Ende der Abstimmung');
select is((select n.payload ->> 'title' from public.notifications n where n.user_id = tests.uid('carol') and n.type = 'poll_reminder'),
          'Was machen wir am Samstag?', 'mit der Frage');
select is((select count(*)::int from public.notifications n where n.user_id = tests.uid('dave')), 0, 'Dave hat abgeschaltet – keine Benachrichtigung');
select is((select count(*)::int from public.notifications n where n.user_id in (tests.uid('alice'), tests.uid('bob'))), 0, 'Alice und Bob haben abgestimmt – nichts');

-- Genau einmal.
select is(app_private.send_poll_closing_reminders(tests.uid('bob'), '2026-11-06 18:00+01'), 0, 'der zweite Aufruf erinnert niemanden doppelt');

-- Zum Ende der Abstimmung ist nichts mehr fällig.
select is(app_private.send_poll_closing_reminders(tests.uid('bob'), '2026-11-06 20:00+01'), 0, 'zum Ende: nichts mehr');

-- Ein neues Mitglied nach der ersten Runde bekommt seine eigene Erinnerung; entschiedene Abstimmungen nicht.
update public.polls set ends_at = '2026-11-06 22:00+01' where id = tests.var('erinnert')::uuid;
select is(app_private.send_poll_closing_reminders(tests.uid('bob'), '2026-11-06 20:45+01'), 4,
          'drei Stunden nach der Erinnerung von Hand: alle vier ohne Stimme (Dave stumm, aber erinnert)');
select is((select count(*)::int from public.notifications n where n.related_entity_id = tests.var('erinnert')::uuid), 3, 'Dave bekommt trotzdem nichts');

update public.polls set ends_at = '2026-11-07 10:00+01', status = 'closed', closed_at = '2026-11-06 21:00+01' where id = tests.var('spaeter')::uuid;
select is(app_private.send_poll_closing_reminders(tests.uid('bob'), '2026-11-07 08:00+01'), 0, 'geschlossene Abstimmung: keine Erinnerung');

-- ---- Öffentlicher Weg ----------------------------------------------------------------------------
-- Mit now() liegt nichts im Fenster; der Aufruf läuft durch und zählt fürs Rate Limit.
select tests.login('carol');
select is(public.send_poll_closing_reminders(), 0, 'Carol stößt an – gerade nichts fällig');
select tests.login('mallory');
select is(public.send_poll_closing_reminders(), 0, 'Mallory stößt an – erreicht keine fremde Crew');

-- Wer die Crew verlassen hat, wird nicht mehr erinnert.
select tests.logout();
delete from public.crew_members where crew_id = tests.var('crew')::uuid and user_id = tests.uid('carol');
update public.polls set ends_at = '2026-11-08 20:00+01', last_reminded_at = null where id = tests.var('kurz')::uuid;
update public.polls set created_at = '2026-11-01 12:00+01' where id = tests.var('kurz')::uuid;
select is(app_private.send_poll_closing_reminders(tests.uid('bob'), '2026-11-08 18:00+01'), 3, 'Kurz gefragt (jetzt lang): Alice, Bob, Dave – Carol ist raus');
select is((select count(*)::int from public.poll_closing_reminders r where r.poll_id = tests.var('kurz')::uuid and r.user_id = tests.uid('carol')), 0,
          'ehemaliges Mitglied: keine Erinnerung');
select is(app_private.send_poll_closing_reminders(tests.uid('carol'), '2026-11-08 18:30+01'), 0, 'ehemaliges Mitglied stößt nichts in der alten Crew an');

select * from finish();
rollback;
