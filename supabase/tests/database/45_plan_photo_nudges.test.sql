-- P16: Fotos vom Abend einsammeln – ab 10 Uhr am Morgen danach bis 3 Tage nach dem Abend genau einmal an
-- alle, die zugesagt hatten; nicht, wenn schon mehr als ein Foto geteilt ist, nicht an Personen mit eigenem
-- Foto, nicht bei abgesagten Plänen, abschaltbar; die App stößt nur Pläne der eigenen Crews an,
-- Außenstehende, anon und ehemalige Mitglieder bekommen nichts.
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
select tests.login('erik');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Erik tritt bei');
select tests.login('mallory');
select tests.set_var('mallory_crew', public.create_crew('Fremde Crew')::text);

-- Freitag, 6. November 2026, abends (Berliner Winterzeit, UTC+1). Pläne direkt angelegt, damit die
-- Zeiten frei wählbar sind.
select tests.logout();
insert into public.plans (crew_id, created_by, title, starts_at, ends_at, status, created_at) values
  (tests.var('crew')::uuid, tests.uid('alice'), 'Bowling', '2026-11-06 20:00+01', null, 'confirmed', '2026-11-01 12:00+01'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Kino', '2026-11-06 22:00+01', null, 'proposed', '2026-11-01 12:00+01'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Abgesagt', '2026-11-06 20:00+01', null, 'cancelled', '2026-11-01 12:00+01'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Ausflug', '2026-11-06 09:00+01', '2026-11-08 18:00+01', 'confirmed', '2026-11-01 12:00+01'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Morgen', '2026-11-07 20:00+01', null, 'confirmed', '2026-11-01 12:00+01'),
  (tests.var('mallory_crew')::uuid, tests.uid('mallory'), 'Fremder Abend', '2026-11-06 20:00+01', null, 'confirmed', '2026-11-01 12:00+01');
select tests.set_var(lower(title), id::text) from public.plans
  where title in ('Bowling', 'Kino', 'Abgesagt', 'Ausflug', 'Morgen', 'Fremder Abend');
-- Bowling: Alice, Bob, Dave, Erik zugesagt, Carol nur „vielleicht“. Kino: Alice und Bob. Abgesagt,
-- Ausflug, Morgen: Alice und Bob. Mallory hat bei sich zugesagt.
insert into public.plan_participants (plan_id, user_id, attendance_status) values
  (tests.var('bowling')::uuid, tests.uid('alice'), 'going'),
  (tests.var('bowling')::uuid, tests.uid('bob'), 'going'),
  (tests.var('bowling')::uuid, tests.uid('carol'), 'maybe'),
  (tests.var('bowling')::uuid, tests.uid('dave'), 'going'),
  (tests.var('bowling')::uuid, tests.uid('erik'), 'going'),
  (tests.var('kino')::uuid, tests.uid('alice'), 'going'),
  (tests.var('kino')::uuid, tests.uid('bob'), 'going'),
  (tests.var('abgesagt')::uuid, tests.uid('alice'), 'going'),
  (tests.var('abgesagt')::uuid, tests.uid('bob'), 'going'),
  (tests.var('ausflug')::uuid, tests.uid('alice'), 'going'),
  (tests.var('ausflug')::uuid, tests.uid('bob'), 'going'),
  (tests.var('morgen')::uuid, tests.uid('alice'), 'going'),
  (tests.var('morgen')::uuid, tests.uid('bob'), 'going'),
  (tests.var('fremder abend')::uuid, tests.uid('mallory'), 'going');
-- Beim Bowling hat Erik schon ein Foto geteilt (eins – das reicht noch nicht). Beim Kino sind es zwei.
insert into public.plan_photos (id, plan_id, uploaded_by, path, width, height, uploaded_at)
select gen_random_uuid(), x.plan_id, x.user_id,
       tests.var('crew') || '/' || x.plan_id::text || '/' || gen_random_uuid()::text || '.webp', 1200, 900, '2026-11-06 23:00+01'
from (values (tests.var('bowling')::uuid, tests.uid('erik')),
             (tests.var('kino')::uuid, tests.uid('alice')),
             (tests.var('kino')::uuid, tests.uid('alice'))) as x(plan_id, user_id);
delete from public.notifications;

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.send_plan_photo_nudges()', 'execute'), 'anon darf keine Erinnerungen anstoßen');
select ok(has_function_privilege('authenticated', 'public.send_plan_photo_nudges()', 'execute'), 'angemeldete Personen dürfen anstoßen');
select ok(not has_function_privilege('authenticated', 'app_private.send_plan_photo_nudges(uuid, timestamptz)', 'execute'), 'Erinnerungen mit eigener Uhrzeit sind gesperrt');
select ok(not has_function_privilege('authenticated', 'app_private.send_due_plan_photo_nudges()', 'execute'), 'Erinnerungen für alle sind gesperrt');
select ok(not has_table_privilege('authenticated', 'public.plan_photo_nudges', 'select'), 'die Erinnerungsliste ist nicht lesbar');
select ok(not has_table_privilege('authenticated', 'public.plan_photo_nudges', 'insert'), 'die Erinnerungsliste ist nicht beschreibbar');
select ok(not has_table_privilege('anon', 'public.plan_photo_nudges', 'select'), 'anon liest die Erinnerungsliste nicht');
select matches((select pg_get_constraintdef(c.oid) from pg_constraint c where c.conname = 'notifications_type_check'), 'plan_photo_nudge', 'neuer Benachrichtigungstyp erlaubt');
select matches((select pg_get_constraintdef(c.oid) from pg_constraint c where c.conname = 'notifications_type_check'), 'plan_day_reminder.*plan_photo_reported|plan_photo_reported.*plan_day_reminder', 'bisherige Typen bleiben erlaubt');

select tests.login_anon();
select throws_ok($$ select public.send_plan_photo_nudges() $$, '42501', null, 'anon kann nichts anstoßen');

-- ---- Zeitfenster ---------------------------------------------------------------------------------
select tests.logout();
select is(app_private.send_plan_photo_nudges(tests.uid('alice'), '2026-11-06 23:30+01'), 0, 'noch am Abend: nichts');
select is(app_private.send_plan_photo_nudges(tests.uid('alice'), '2026-11-07 09:30+01'), 0, 'am Morgen danach vor 10 Uhr: nichts');

-- Dave hat die Gruppe abgeschaltet.
update public.user_settings set notification_preferences = '{"plan_photo_nudge": false}' where user_id = tests.uid('dave');

-- Mallory stößt an: nur ihre eigene Crew.
select is(app_private.send_plan_photo_nudges(tests.uid('mallory'), '2026-11-07 10:00+01'), 1, 'Mallorys Aufruf erinnert nur ihre eigene Crew');
select is((select count(*)::int from public.notifications n where n.type = 'plan_photo_nudge' and n.crew_id = tests.var('crew')::uuid), 0,
          'Mallory löst nichts in fremden Crews aus');

-- Carol öffnet die App um 10 Uhr: die ganze Crew erfährt es.
select is(app_private.send_plan_photo_nudges(tests.uid('carol'), '2026-11-07 10:00+01'), 3, 'ab 10 Uhr: Bowling an Alice, Bob und Dave');
select is((select array_agg(r.user_id order by r.user_id) from public.plan_photo_nudges r where r.plan_id = tests.var('bowling')::uuid),
          (select array_agg(u order by u) from unnest(array[tests.uid('alice'), tests.uid('bob'), tests.uid('dave')]) u),
          'nur Zusagen ohne eigenes Foto – nicht Carol („vielleicht“), nicht Erik (hat schon geteilt)');
select is((select count(*)::int from public.plan_photo_nudges r where r.plan_id = tests.var('kino')::uuid), 0, 'schon zwei Fotos: keine Erinnerung');
select is((select count(*)::int from public.plan_photo_nudges r where r.plan_id = tests.var('abgesagt')::uuid), 0, 'abgesagter Plan: keine Erinnerung');
select is((select count(*)::int from public.plan_photo_nudges r where r.plan_id = tests.var('ausflug')::uuid), 0, 'mehrtägiger Plan läuft noch: keine Erinnerung');
select is((select count(*)::int from public.plan_photo_nudges r where r.plan_id = tests.var('morgen')::uuid), 0, 'Plan, der erst heute Abend ist: keine Erinnerung');

-- Inhalt
select is((select n.payload ->> 'title' from public.notifications n where n.user_id = tests.uid('bob') and n.type = 'plan_photo_nudge'), 'Bowling', 'mit dem Titel des Plans');
select is((select n.payload ->> 'yesterday' from public.notifications n where n.user_id = tests.uid('bob') and n.type = 'plan_photo_nudge'), 'true', 'als „gestern“ gekennzeichnet');
select is((select (n.payload ->> 'starts_at')::timestamptz from public.notifications n where n.user_id = tests.uid('bob') and n.type = 'plan_photo_nudge'),
          '2026-11-06 20:00+01'::timestamptz, 'mit dem Beginn');
select is((select n.entity_type || ':' || (n.related_entity_id = tests.var('bowling')::uuid) || ':' || (n.actor_id is null) || ':' || (n.crew_id = tests.var('crew')::uuid)
           from public.notifications n where n.user_id = tests.uid('bob') and n.type = 'plan_photo_nudge'), 'plan:true:true:true', 'führt zum Plan, ohne auslösende Person');
select is((select count(*)::int from public.notifications n where n.user_id = tests.uid('dave') and n.type = 'plan_photo_nudge'), 0, 'Dave hat abgeschaltet und bekommt nichts');
select is((select count(*)::int from public.notifications n where n.user_id in (tests.uid('carol'), tests.uid('erik')) and n.type = 'plan_photo_nudge'), 0, 'Carol und Erik bekommen nichts');
select is((select count(*)::int from public.notifications n where n.user_id = tests.uid('mallory') and n.crew_id = tests.var('crew')::uuid), 0, 'Mallory bekommt nichts aus fremden Crews');

-- Genau einmal – auch wenn die Benachrichtigung gelöscht wird.
select is(app_private.send_plan_photo_nudges(tests.uid('bob'), '2026-11-07 12:00+01'), 0, 'ein zweiter Aufruf erinnert nicht noch einmal');
delete from public.notifications n where n.user_id = tests.uid('bob') and n.type = 'plan_photo_nudge';
select is(app_private.send_plan_photo_nudges(tests.uid('bob'), '2026-11-07 13:00+01'), 0, 'gelöschte Erinnerung kommt nicht wieder');

-- ---- Später, mehrtägig, Fenster zu, ehemalige Mitglieder -----------------------------------------
-- Der Ausflug endet am Sonntag um 18 Uhr; danach ist er dran – nicht mehr „gestern“. Dave verlässt
-- vorher die Crew. Kino bekommt ein Foto weniger und ist damit wieder dran.
select tests.login('dave');
select lives_ok($$ select public.leave_crew(tests.var('crew')::uuid) $$, 'Dave verlässt die Crew');
select tests.logout();
insert into public.plan_participants (plan_id, user_id, attendance_status) values (tests.var('ausflug')::uuid, tests.uid('dave'), 'going')
  on conflict (plan_id, user_id) do update set attendance_status = 'going';
select is(app_private.send_plan_photo_nudges(tests.uid('alice'), '2026-11-08 17:00+01'), 2, 'Sonntag 17 Uhr: „Morgen“ vom Samstag an Alice und Bob');
select is((select count(*)::int from public.plan_photo_nudges r where r.plan_id = tests.var('ausflug')::uuid), 0, 'Ausflug läuft noch bis 18 Uhr');
-- Cron für alle: gezählt nur in dieser Crew (der Seed kann eigene Pläne haben).
select lives_ok($$ select app_private.send_plan_photo_nudges(null, '2026-11-08 18:30+01') $$, 'Cron nach dem Ausflug läuft');
select is((select count(*)::int from public.plan_photo_nudges r where r.plan_id = tests.var('ausflug')::uuid), 2, 'Ausflug: Alice und Bob');
select is((select count(*)::int from public.plan_photo_nudges r where r.plan_id = tests.var('ausflug')::uuid and r.user_id = tests.uid('dave')), 0, 'ehemalige Mitglieder werden nicht erinnert');
select is((select n.payload ->> 'yesterday' from public.notifications n where n.user_id = tests.uid('alice') and n.type = 'plan_photo_nudge' and n.related_entity_id = tests.var('ausflug')::uuid),
          'false', 'mehrtägig: nicht „gestern“');
select is(app_private.send_plan_photo_nudges(tests.uid('alice'), '2026-11-08 19:00+01'), 0, 'nach dem Cron ist nichts mehr offen');

delete from public.plan_photos where id = (select id from public.plan_photos where plan_id = tests.var('kino')::uuid limit 1);
select is(app_private.send_plan_photo_nudges(tests.uid('alice'), '2026-11-09 23:30+01'), 0, 'drei Tage nach dem Kino ist das Fenster zu');

select lives_ok($$ select app_private.send_due_plan_photo_nudges() $$, 'Cron mit echter Uhrzeit läuft');

-- ---- Aufruf aus der App und Rate Limit -----------------------------------------------------------
select tests.login('mallory');
select is((select count(public.send_plan_photo_nudges())::int from generate_series(1, 120)), 120, '120 Aufrufe je Stunde gehen');
select throws_ok($$ select public.send_plan_photo_nudges() $$, 'P0001', 'rate_limited', 'mehr als 120 Aufrufe je Stunde werden abgewiesen');

-- ---- Kontolöschung -------------------------------------------------------------------------------
select tests.logout();
delete from auth.users where id = tests.uid('bob');
select is((select count(*)::int from public.plan_photo_nudges r where r.user_id = tests.uid('bob')), 0, 'Kontolöschung entfernt die Erinnerungsliste');

select * from finish();
rollback;
