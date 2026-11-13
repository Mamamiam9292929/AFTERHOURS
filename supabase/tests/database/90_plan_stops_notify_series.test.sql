-- P50 Etappe 2a: Stationen – am Abend Bescheid an alle mit Zusage (nicht an „Vielleicht“, nicht an die eintragende
-- Person, nicht Tage vorher, je Station einmal), und die nächste Runde einer Serie übernimmt die Stationen
-- (Uhrzeit in Berliner Ortszeit, passt sie nicht mehr: ohne Uhrzeit). Außenstehende bekommen nichts.
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
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('carol');
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('dave');
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('mallory');
select public.create_crew('Fremde Crew');

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'app_private.plan_stop_notify_due(timestamptz, timestamptz)', 'execute'), 'Zeitfenster bleibt intern');
select ok(not has_function_privilege('authenticated', 'app_private.plan_series_stop_at(timestamptz, timestamptz, timestamptz)', 'execute'), 'Rechenfunktion bleibt intern');
select ok(not has_function_privilege('authenticated', 'app_private.plan_series_stops_inherit()', 'execute'), 'Trigger-Funktion bleibt intern');
select ok(not has_function_privilege('anon', 'public.add_plan_stop(uuid, text, timestamptz, text)', 'execute'), 'anon hängt weiterhin keine Station an');
select ok(has_function_privilege('authenticated', 'public.add_plan_stop(uuid, text, timestamptz, text)', 'execute'), 'angemeldete Personen dürfen aufrufen (Prüfung in der Funktion)');

-- ---- Zeitfenster „am Abend“ ------------------------------------------------------------------------
select tests.logout();
select ok(app_private.plan_stop_notify_due('2026-11-20 20:00+01', '2026-11-20 17:00+01'), 'genau 3 h vorher: Bescheid');
select ok(not app_private.plan_stop_notify_due('2026-11-20 20:00+01', '2026-11-20 16:59+01'), 'früher: kein Bescheid');
select ok(app_private.plan_stop_notify_due('2026-11-20 20:00+01', '2026-11-21 14:00+01'), 'bis 18 h danach: Bescheid');
select ok(not app_private.plan_stop_notify_due('2026-11-20 20:00+01', '2026-11-21 14:01+01'), 'später: kein Bescheid');

-- ---- Bescheid am Abend --------------------------------------------------------------------------
-- Bob organisiert „Heute“ (Beginn in 1 h) und „Später“ (in 3 Tagen). Alice und Dave sind dabei, Carol vielleicht.
insert into public.plans (crew_id, created_by, title, starts_at, status) values
  (tests.var('crew')::uuid, tests.uid('bob'), 'Heute', date_trunc('minute', now()) + interval '1 hour', 'confirmed'),
  (tests.var('crew')::uuid, tests.uid('bob'), 'Später', date_trunc('minute', now()) + interval '3 days', 'confirmed');
select tests.set_var('tonight', (select id::text from public.plans where title = 'Heute'));
select tests.set_var('later', (select id::text from public.plans where title = 'Später'));
insert into public.plan_participants (plan_id, user_id, attendance_status)
select p.id, u.uid, u.status::public.attendance_status
from public.plans p
cross join (values (tests.uid('alice'), 'going'), (tests.uid('bob'), 'going'), (tests.uid('carol'), 'maybe'), (tests.uid('dave'), 'going')) as u (uid, status)
where p.id in (tests.var('tonight')::uuid, tests.var('later')::uuid);
delete from public.notifications;

select tests.login('bob');
select tests.set_var('bar', public.add_plan_stop(tests.var('tonight')::uuid, 'Bar Raval',
  (select starts_at from public.plans where id = tests.var('tonight')::uuid) + interval '2 hours 30 minutes', 'Muskauer Str. 9')::text);
select tests.logout();
select is((select count(*)::int from public.notifications where user_id = tests.uid('alice') and type = 'plan_changed'), 1, 'Alice (dabei) bekommt Bescheid');
select is((select count(*)::int from public.notifications where user_id = tests.uid('dave') and type = 'plan_changed'), 1, 'Dave (dabei) bekommt Bescheid');
select is((select count(*)::int from public.notifications where user_id = tests.uid('carol')), 0, 'Carol (vielleicht) bekommt nichts');
select is((select count(*)::int from public.notifications where user_id = tests.uid('bob')), 0, 'Bob trägt ein und bekommt nichts');
select is((select count(*)::int from public.notifications where user_id = tests.uid('mallory')), 0, 'Außenstehende bekommen nichts');
select is((select payload ->> 'stop' from public.notifications where user_id = tests.uid('alice')), 'Bar Raval', 'Name der Station im Hinweis');
select is((select (payload ->> 'stop_at')::timestamptz from public.notifications where user_id = tests.uid('alice')),
  (select at from public.plan_stops where id = tests.var('bar')::uuid), 'Uhrzeit der Station im Hinweis');
select is((select payload -> 'changed' from public.notifications where user_id = tests.uid('alice')), '["stops"]'::jsonb, 'als Planänderung „Danach“');
select is((select actor_id from public.notifications where user_id = tests.uid('alice')), tests.uid('bob'), 'Bob als auslösende Person');
select is((select related_entity_id from public.notifications where user_id = tests.uid('alice')), tests.var('tonight')::uuid, 'führt zum Plan');
select is((select dedupe_key from public.notifications where user_id = tests.uid('alice')), 'plan_stop:' || tests.var('bar'), 'ein Hinweis je Station');

-- Owner Alice hängt eine zweite Station an (ohne Uhrzeit): Bob und Dave bekommen Bescheid, Alice nicht.
select tests.login('alice');
select public.add_plan_stop(tests.var('tonight')::uuid, 'Tanzen');
select tests.logout();
select is((select count(*)::int from public.notifications where user_id = tests.uid('bob') and payload ->> 'stop' = 'Tanzen'), 1, 'Bob (dabei) bekommt Bescheid vom Owner');
select is((select count(*)::int from public.notifications where user_id = tests.uid('alice') and payload ->> 'stop' = 'Tanzen'), 0, 'Alice nicht über die eigene Station');
select ok((select payload ->> 'stop_at' is null from public.notifications where user_id = tests.uid('dave') and payload ->> 'stop' = 'Tanzen'), 'ohne Uhrzeit: keine Uhrzeit im Hinweis');

-- Wer den Hinweis für Planänderungen abgeschaltet hat, bekommt keinen.
update public.user_settings set notification_preferences = coalesce(notification_preferences, '{}'::jsonb) || '{"plan_changed": false}'::jsonb
where user_id = tests.uid('dave');
select tests.login('bob');
select public.add_plan_stop(tests.var('tonight')::uuid, 'Döner');
select tests.logout();
select is((select count(*)::int from public.notifications where user_id = tests.uid('dave') and payload ->> 'stop' = 'Döner'), 0, 'abgeschaltet: kein Hinweis');
select is((select count(*)::int from public.notifications where user_id = tests.uid('alice') and payload ->> 'stop' = 'Döner'), 1, '… die anderen schon');

-- Tage vorher: geplant wird still.
select tests.login('bob');
select public.add_plan_stop(tests.var('later')::uuid, 'Bar Raval');
select tests.logout();
select is((select count(*)::int from public.notifications where related_entity_id = tests.var('later')::uuid), 0, 'Tage vorher: kein Hinweis');

-- Angriffe wie in Etappe 1: einfaches Mitglied und Außenstehende hängen nichts an, es entsteht kein Hinweis.
select tests.login('carol');
select throws_ok($$ select public.add_plan_stop(tests.var('tonight')::uuid, 'Meine Bar') $$, '42501', null, 'einfaches Mitglied hängt nichts an');
select tests.login('mallory');
select throws_ok($$ select public.add_plan_stop(tests.var('tonight')::uuid, 'Fremde Bar') $$, '42501', null, 'Außenstehende hängen nichts an');
select tests.login_anon();
select throws_ok($$ select public.add_plan_stop(tests.var('tonight')::uuid, 'Bar') $$, '42501', null, 'anon hängt nichts an');
select tests.logout();
select is((select count(*)::int from public.notifications where payload ->> 'stop' in ('Meine Bar', 'Fremde Bar')), 0, 'kein Hinweis aus Angriffen');

-- ---- Uhrzeit in der nächsten Runde (Berliner Ortszeit) ---------------------------------------------
select is(app_private.plan_series_stop_at('2026-10-24 20:00 Europe/Berlin', '2026-10-24 22:30 Europe/Berlin', '2026-10-31 20:00 Europe/Berlin'),
  '2026-10-31 22:30 Europe/Berlin'::timestamptz, 'über die Zeitumstellung: 22:30 bleibt 22:30');
select is(app_private.plan_series_stop_at('2026-10-17 20:00 Europe/Berlin', '2026-10-18 01:00 Europe/Berlin', '2026-10-24 20:00 Europe/Berlin'),
  '2026-10-25 01:00 Europe/Berlin'::timestamptz, 'nach Mitternacht: nächster Tag, gleiche Uhrzeit');
select is(app_private.plan_series_stop_at('2026-10-17 20:00 Europe/Berlin', '2026-10-18 13:30 Europe/Berlin', '2026-10-24 20:00 Europe/Berlin'),
  null, 'mehr als 18 h nach Beginn durch die Zeitumstellung: ohne Uhrzeit');
select is(app_private.plan_series_stop_at('2026-10-17 20:00 Europe/Berlin', null, '2026-10-24 20:00 Europe/Berlin'),
  null, 'ohne Uhrzeit bleibt ohne Uhrzeit');

-- ---- Serie übernimmt die Stationen ----------------------------------------------------------------
select tests.set_var('today', ((now() at time zone 'Europe/Berlin')::date)::text);
insert into public.plans (crew_id, created_by, title, starts_at, ends_at, status) values
  (tests.var('crew')::uuid, tests.uid('alice'), 'Stammtisch',
   ((tests.var('today')::date - 2) + time '19:00') at time zone 'Europe/Berlin',
   ((tests.var('today')::date - 2) + time '23:00') at time zone 'Europe/Berlin', 'confirmed'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Ohne Stationen',
   ((tests.var('today')::date - 3) + time '19:00') at time zone 'Europe/Berlin', null, 'confirmed');
select tests.set_var('first', (select id::text from public.plans where title = 'Stammtisch'));
select tests.set_var('plain', (select id::text from public.plans where title = 'Ohne Stationen'));
insert into public.plan_participants (plan_id, user_id)
select p.id, m.user_id from public.plans p join public.crew_members m on m.crew_id = p.crew_id
where p.id in (tests.var('first')::uuid, tests.var('plain')::uuid);
insert into public.plan_stops (plan_id, title, at, address, created_at) values
  (tests.var('first')::uuid, 'Kneipe', ((tests.var('today')::date - 2) + time '22:30') at time zone 'Europe/Berlin', 'Weserstr. 1', now() - interval '3 minutes'),
  (tests.var('first')::uuid, 'Döner', null, null, now() - interval '2 minutes'),
  (tests.var('first')::uuid, 'Späti', null, null, now() - interval '1 minute');
delete from public.notifications;

select tests.login('alice');
select public.set_plan_repeat(tests.var('first')::uuid, 'weekly');
select public.set_plan_repeat(tests.var('plain')::uuid, 'weekly');
select tests.logout();
select tests.set_var('series', (select series_id::text from public.plans where id = tests.var('first')::uuid));
select tests.set_var('second', (select id::text from public.plans where series_id = tests.var('series')::uuid and id <> tests.var('first')::uuid));
select isnt(tests.var('second'), null, 'nächste Runde angelegt');
select is((select count(*)::int from public.plan_stops where plan_id = tests.var('second')::uuid), 3, 'nächste Runde übernimmt alle Stationen');
select is((select at from public.plan_stops where plan_id = tests.var('second')::uuid and title = 'Kneipe'),
  ((tests.var('today')::date + 5) + time '22:30') at time zone 'Europe/Berlin', 'Uhrzeit 22:30 am neuen Tag');
select is((select address from public.plan_stops where plan_id = tests.var('second')::uuid and title = 'Kneipe'), 'Weserstr. 1', 'Adresse kommt mit');
select is((select array_agg(title order by at nulls last, created_at) from public.plan_stops where plan_id = tests.var('second')::uuid),
  array['Kneipe', 'Döner', 'Späti'], 'Reihenfolge bleibt');
select is((select count(*)::int from public.plan_stops where plan_id = tests.var('first')::uuid), 3, 'vorige Runde behält ihre Stationen');
select is((select count(*)::int from public.notifications where payload ? 'stop'), 0, 'Kopieren löst keinen Hinweis aus');
select is((select count(*)::int from public.plan_stops s join public.plans p on p.id = s.plan_id
           where p.series_id = (select series_id from public.plans where id = tests.var('plain')::uuid)), 0, 'Serie ohne Stationen: keine Stationen');

-- Aussetzen: die übernächste Runde bekommt die Stationen der ausgesetzten.
select tests.login('alice');
select public.remove_plan_stop((select id from public.plan_stops where plan_id = tests.var('second')::uuid and title = 'Späti'));
select tests.set_var('skip', public.skip_plan_occurrence(tests.var('second')::uuid)::text);
select tests.logout();
select tests.set_var('third', tests.var('skip')::jsonb ->> 'next_plan_id');
select is((select array_agg(title order by at nulls last, created_at) from public.plan_stops where plan_id = tests.var('third')::uuid),
  array['Kneipe', 'Döner'], 'ausgesetzt: nächste Runde mit den Stationen der ausgesetzten');

-- Plan ohne Serie: der Trigger tut nichts.
insert into public.plans (crew_id, created_by, title, starts_at, status) values
  (tests.var('crew')::uuid, tests.uid('alice'), 'Einzeln', now() + interval '10 days', 'proposed');
select is((select count(*)::int from public.plan_stops s join public.plans p on p.id = s.plan_id where p.title = 'Einzeln'), 0, 'Plan ohne Serie: keine Stationen');

-- Außenstehende sehen die kopierten Stationen nicht.
select tests.login('mallory');
select is((select count(*)::int from public.plan_stops where plan_id = tests.var('third')::uuid), 0, 'Außenstehende sehen keine Stationen');

select * from finish();
rollback;
