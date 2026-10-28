-- P4 Etappe 2: Erinnerung am Tag des Plans – ab 9 Uhr (bei frühen Plänen 3 Stunden vorher) bis zum
-- Beginn, genau einmal je Person und Plan, nicht nach Absage, nicht für am selben Tag angelegte,
-- abgesagte, morgige oder gestrige Pläne, abschaltbar; die App stößt nur Pläne der eigenen Crews an,
-- Außenstehende, anon und ehemalige Mitglieder bekommen nichts.
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

-- Freitag, 6. November 2026 (Berliner Winterzeit, UTC+1).
select tests.logout();
insert into public.plans (crew_id, created_by, title, starts_at, status, created_at) values
  (tests.var('crew')::uuid, tests.uid('alice'), 'Bowling', '2026-11-06 20:00+01', 'confirmed', '2026-11-01 12:00+01'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Frühstück', '2026-11-06 10:00+01', 'proposed', '2026-11-02 12:00+01'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Spontan', '2026-11-06 21:00+01', 'confirmed', '2026-11-06 08:00+01'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Abgesagt', '2026-11-06 20:00+01', 'cancelled', '2026-11-01 12:00+01'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Morgen', '2026-11-07 20:00+01', 'confirmed', '2026-11-01 12:00+01'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Gestern', '2026-11-05 20:00+01', 'confirmed', '2026-11-01 12:00+01'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Kino', '2026-11-06 22:00+01', 'proposed', '2026-11-01 12:00+01'),
  (tests.var('mallory_crew')::uuid, tests.uid('mallory'), 'Fremder Abend', '2026-11-06 20:00+01', 'confirmed', '2026-11-01 12:00+01');
select tests.set_var(lower(title), id::text) from public.plans
  where title in ('Bowling', 'Frühstück', 'Spontan', 'Abgesagt', 'Morgen', 'Gestern', 'Kino', 'Fremder Abend');
insert into public.plan_participants (plan_id, user_id, attendance_status) values
  (tests.var('bowling')::uuid, tests.uid('alice'), 'going'),
  (tests.var('bowling')::uuid, tests.uid('bob'), 'maybe'),
  (tests.var('bowling')::uuid, tests.uid('carol'), 'declined');
delete from public.notifications;

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.send_plan_day_reminders()', 'execute'), 'anon darf keine Erinnerungen anstoßen');
select ok(has_function_privilege('authenticated', 'public.send_plan_day_reminders()', 'execute'), 'angemeldete Personen dürfen anstoßen');
select ok(not has_function_privilege('authenticated', 'app_private.send_plan_day_reminders(uuid, timestamptz)', 'execute'), 'Erinnerungen mit eigener Uhrzeit sind gesperrt');
select ok(not has_function_privilege('authenticated', 'app_private.send_due_plan_day_reminders()', 'execute'), 'Erinnerungen für alle sind gesperrt');
select ok(not has_table_privilege('authenticated', 'public.plan_day_reminders', 'select'), 'die Erinnerungsliste ist nicht lesbar');
select ok(not has_table_privilege('authenticated', 'public.plan_day_reminders', 'insert'), 'die Erinnerungsliste ist nicht beschreibbar');
select ok(not has_table_privilege('anon', 'public.plan_day_reminders', 'select'), 'anon liest die Erinnerungsliste nicht');
select matches((select pg_get_constraintdef(c.oid) from pg_constraint c where c.conname = 'notifications_type_check'), 'plan_day_reminder', 'neuer Benachrichtigungstyp erlaubt');
select matches((select pg_get_constraintdef(c.oid) from pg_constraint c where c.conname = 'notifications_type_check'), 'plan_expense_reminder.*reward_earned|reward_earned.*plan_expense_reminder', 'bisherige Typen bleiben erlaubt');

select tests.login_anon();
select throws_ok($$ select public.send_plan_day_reminders() $$, '42501', null, 'anon kann nichts anstoßen');

-- ---- Zeitfenster ---------------------------------------------------------------------------------
select tests.logout();
select is(app_private.send_plan_day_reminders(tests.uid('alice'), '2026-11-06 06:30+01'), 0, 'um 6:30 ist noch nichts fällig');
select is(app_private.send_plan_day_reminders(tests.uid('alice'), '2026-11-06 07:30+01'), 4, 'Frühstück um 10 Uhr: drei Stunden vorher an alle vier');
select is((select count(*)::int from public.notifications n where n.type = 'plan_day_reminder' and n.related_entity_id = tests.var('bowling')::uuid), 0,
          'der Abend um 20 Uhr ist um 7:30 noch nicht dran');

-- Dave hat die Gruppe abgeschaltet.
update public.user_settings set notification_preferences = '{"plan_day_reminder": false}' where user_id = tests.uid('dave');

-- Mallory stößt an: nur ihre eigene Crew.
select is(app_private.send_plan_day_reminders(tests.uid('mallory'), '2026-11-06 09:00+01'), 1, 'Mallorys Aufruf erinnert nur ihre eigene Crew');
select is((select count(*)::int from public.notifications n where n.type = 'plan_day_reminder' and n.related_entity_id = tests.var('bowling')::uuid), 0,
          'Mallory löst nichts in fremden Crews aus');

-- Bob öffnet die App um 9 Uhr: die ganze Crew erfährt es.
select is(app_private.send_plan_day_reminders(tests.uid('bob'), '2026-11-06 09:00+01'), 7, 'ab 9 Uhr: Bowling (3) und Kino (4)');
select is((select count(*)::int from public.plan_day_reminders r where r.plan_id = tests.var('bowling')::uuid), 3, 'Bowling: Alice, Bob und Dave – nicht Carol, die abgesagt hat');
select is((select count(*)::int from public.plan_day_reminders r where r.plan_id = tests.var('kino')::uuid), 4, 'Kino ohne Antworten: alle vier');
select is((select count(*)::int from public.plan_day_reminders r
           where r.plan_id in (tests.var('spontan')::uuid, tests.var('abgesagt')::uuid, tests.var('morgen')::uuid, tests.var('gestern')::uuid)), 0,
          'nichts für heute angelegte, abgesagte, morgige und gestrige Pläne');
select is(app_private.send_plan_day_reminders(tests.uid('alice'), '2026-11-06 12:00+01'), 0, 'ein zweiter Aufruf erinnert nicht noch einmal');

-- Inhalt
select is((select n.payload ->> 'attendance' from public.notifications n where n.user_id = tests.uid('alice') and n.type = 'plan_day_reminder' and n.related_entity_id = tests.var('bowling')::uuid), 'going', 'Alice ist dabei');
select is((select n.payload ->> 'attendance' from public.notifications n where n.user_id = tests.uid('bob') and n.type = 'plan_day_reminder' and n.related_entity_id = tests.var('bowling')::uuid), 'maybe', 'Bob hat „vielleicht“ gesagt');
select is((select n.payload ->> 'title' from public.notifications n where n.user_id = tests.uid('bob') and n.type = 'plan_day_reminder' and n.related_entity_id = tests.var('bowling')::uuid), 'Bowling', 'mit dem Titel des Plans');
select is((select (n.payload ->> 'starts_at')::timestamptz from public.notifications n where n.user_id = tests.uid('bob') and n.type = 'plan_day_reminder' and n.related_entity_id = tests.var('bowling')::uuid),
          '2026-11-06 20:00+01'::timestamptz, 'mit dem Beginn');
select is((select n.entity_type || ':' || (n.actor_id is null) || ':' || (n.crew_id = tests.var('crew')::uuid) from public.notifications n
           where n.user_id = tests.uid('bob') and n.type = 'plan_day_reminder' and n.related_entity_id = tests.var('bowling')::uuid), 'plan:true:true', 'führt zum Plan, ohne auslösende Person');
select is((select count(*)::int from public.notifications n where n.user_id = tests.uid('carol') and n.related_entity_id = tests.var('bowling')::uuid), 0, 'Carol hat abgesagt und bekommt nichts');
select is((select count(*)::int from public.notifications n where n.user_id = tests.uid('dave') and n.type = 'plan_day_reminder' and n.related_entity_id = tests.var('bowling')::uuid), 0, 'Dave hat abgeschaltet und bekommt nichts');
select is((select count(*)::int from public.notifications n where n.user_id = tests.uid('mallory') and n.crew_id = tests.var('crew')::uuid), 0, 'Mallory bekommt nichts aus fremden Crews');

-- Gelöschte Benachrichtigung kommt nicht wieder.
delete from public.notifications n where n.user_id = tests.uid('bob') and n.type = 'plan_day_reminder';
select is(app_private.send_plan_day_reminders(tests.uid('bob'), '2026-11-06 13:00+01'), 0, 'gelöschte Erinnerung kommt nicht wieder');

-- ---- Cron, Beginn vorbei, ehemalige Mitglieder ---------------------------------------------------
insert into public.plans (crew_id, created_by, title, starts_at, status, created_at) values
  (tests.var('crew')::uuid, tests.uid('alice'), 'Vorbei', '2026-11-06 11:00+01', 'confirmed', '2026-11-01 12:00+01'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Danach', '2026-11-06 23:00+01', 'confirmed', '2026-11-01 12:00+01');
select tests.set_var(lower(title), id::text) from public.plans where title in ('Vorbei', 'Danach');
select tests.login('dave');
select lives_ok($$ select public.leave_crew(tests.var('crew')::uuid) $$, 'Dave verlässt die Crew');
select tests.logout();
-- Cron für alle: gezählt nur in dieser Crew (der Seed kann eigene Pläne an diesem Tag haben).
select lives_ok($$ select app_private.send_plan_day_reminders(null, '2026-11-06 12:00+01') $$, 'Cron um 12 Uhr läuft');
select is((select count(*)::int from public.plan_day_reminders r where r.plan_id = tests.var('danach')::uuid), 3, 'Cron: „Danach“ an Alice, Bob und Carol');
select is((select count(*)::int from public.plan_day_reminders r where r.plan_id = tests.var('vorbei')::uuid), 0, 'nach Beginn keine Erinnerung mehr');
select is((select count(*)::int from public.plan_day_reminders r where r.plan_id = tests.var('danach')::uuid and r.user_id = tests.uid('dave')), 0, 'ehemalige Mitglieder werden nicht erinnert');
select lives_ok($$ select app_private.send_due_plan_day_reminders() $$, 'Cron mit echter Uhrzeit läuft');

-- ---- Aufruf aus der App und Rate Limit -----------------------------------------------------------
select tests.login('mallory');
select is((select count(public.send_plan_day_reminders())::int from generate_series(1, 120)), 120, '120 Aufrufe je Stunde gehen');
select throws_ok($$ select public.send_plan_day_reminders() $$, 'P0001', 'rate_limited', 'mehr als 120 Aufrufe je Stunde werden abgewiesen');

-- ---- Kontolöschung -------------------------------------------------------------------------------
select tests.logout();
delete from auth.users where id = tests.uid('carol');
select is((select count(*)::int from public.plan_day_reminders r where r.user_id = tests.uid('carol')), 0, 'Kontolöschung entfernt die Erinnerungsliste');

select * from finish();
rollback;
