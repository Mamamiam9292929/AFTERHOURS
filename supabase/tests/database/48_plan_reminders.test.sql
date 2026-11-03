-- P19: Nachfragen beim Plan – Organisator:in, Owner und Admins fragen alle ohne Antwort, höchstens alle
-- 6 Stunden je Plan, nicht nach Beginn, nicht bei abgeschlossenen/abgesagten Plänen; wer geantwortet hat,
-- wer ausgetreten ist oder die Gruppe abgeschaltet hat, bekommt nichts; Außenstehende, anon und einfache
-- Mitglieder können nicht nachfragen.
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

-- Pläne direkt angelegt, damit Zeiten und Status frei wählbar sind (Teilnehmende wie bei create_plan).
select tests.logout();
insert into public.plans (crew_id, created_by, title, starts_at, status) values
  (tests.var('crew')::uuid, tests.uid('bob'), 'Bowling', now() + interval '2 days', 'confirmed'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Alle da', now() + interval '2 days', 'proposed'),
  (tests.var('crew')::uuid, tests.uid('bob'), 'Gestartet', now() - interval '10 minutes', 'confirmed'),
  (tests.var('crew')::uuid, tests.uid('bob'), 'Abgesagt', now() + interval '2 days', 'cancelled');
select tests.set_var(lower(replace(title, ' ', '_')), id::text) from public.plans
  where title in ('Bowling', 'Alle da', 'Gestartet', 'Abgesagt');
-- Bowling: Bob organisiert und ist dabei, Carol „vielleicht“, Dave und Erik noch ohne Antwort, Alice abgesagt.
insert into public.plan_participants (plan_id, user_id, attendance_status) values
  (tests.var('bowling')::uuid, tests.uid('bob'), 'going'),
  (tests.var('bowling')::uuid, tests.uid('carol'), 'maybe'),
  (tests.var('bowling')::uuid, tests.uid('dave'), 'invited'),
  (tests.var('bowling')::uuid, tests.uid('erik'), 'invited'),
  (tests.var('bowling')::uuid, tests.uid('alice'), 'declined'),
  (tests.var('alle_da')::uuid, tests.uid('alice'), 'going'),
  (tests.var('alle_da')::uuid, tests.uid('bob'), 'going'),
  (tests.var('gestartet')::uuid, tests.uid('bob'), 'going'),
  (tests.var('gestartet')::uuid, tests.uid('dave'), 'invited'),
  (tests.var('abgesagt')::uuid, tests.uid('bob'), 'going'),
  (tests.var('abgesagt')::uuid, tests.uid('dave'), 'invited');
delete from public.notifications;

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.remind_plan(uuid)', 'execute'), 'anon darf nicht nachfragen');
select ok(has_function_privilege('authenticated', 'public.remind_plan(uuid)', 'execute'), 'angemeldete Personen dürfen die Funktion aufrufen');
select ok(not has_table_privilege('authenticated', 'public.plan_reminders', 'select'), 'die Nachfrage-Liste ist nicht lesbar');
select ok(not has_table_privilege('authenticated', 'public.plan_reminders', 'update'), 'die Nachfrage-Liste ist nicht beschreibbar');
select ok(not has_table_privilege('anon', 'public.plan_reminders', 'select'), 'anon liest die Nachfrage-Liste nicht');
select matches((select pg_get_constraintdef(c.oid) from pg_constraint c where c.conname = 'notifications_type_check'), 'plan_reminder', 'neuer Benachrichtigungstyp erlaubt');
select matches((select pg_get_constraintdef(c.oid) from pg_constraint c where c.conname = 'notifications_type_check'), 'plan_photo_nudge', 'bisherige Typen bleiben erlaubt');

-- ---- Angriffe ----------------------------------------------------------------------------------
select tests.login_anon();
select throws_ok($$ select public.remind_plan(tests.var('bowling')::uuid) $$, '42501', null, 'anon kann nicht nachfragen');

select tests.login('mallory');
select throws_ok($$ select public.remind_plan(tests.var('bowling')::uuid) $$, '42501', 'forbidden', 'Außenstehende können nicht nachfragen');
select throws_ok($$ select public.remind_plan(gen_random_uuid()) $$, '42501', 'forbidden', 'unbekannter Plan verrät nichts');

select tests.login('carol');
select throws_ok($$ select public.remind_plan(tests.var('bowling')::uuid) $$, '42501', 'forbidden', 'einfache Mitglieder fragen bei fremden Plänen nicht nach');
select is((select count(*)::int from public.notifications), 0, 'keine Benachrichtigung nach den Angriffen');

-- ---- Ablauf ------------------------------------------------------------------------------------
-- Dave hat die Gruppe „Nachfragen zu Plänen“ abgeschaltet? Erst später – zuerst bekommen beide etwas.
select tests.login('bob');
select is(public.remind_plan(tests.var('bowling')::uuid), 2, 'Bob fragt Dave und Erik (ohne Antwort)');
select tests.logout();
select is((select array_agg(n.user_id order by n.user_id) from public.notifications n where n.type = 'plan_reminder'),
          (select array_agg(u order by u) from unnest(array[tests.uid('dave'), tests.uid('erik')]) u),
          'nur Dave und Erik bekommen die Nachfrage – nicht Carol („vielleicht“), Alice (abgesagt), Bob selbst');
select is((select n.actor_id from public.notifications n where n.type = 'plan_reminder' limit 1), tests.uid('bob'), 'Bob steht als fragende Person drin');
select is((select n.payload ->> 'title' from public.notifications n where n.type = 'plan_reminder' limit 1), 'Bowling', 'Titel im Payload');
select ok((select n.payload ? 'starts_at' from public.notifications n where n.type = 'plan_reminder' limit 1), 'Beginn im Payload');
select is((select n.entity_type || ':' || n.related_entity_id::text from public.notifications n where n.type = 'plan_reminder' limit 1),
          'plan:' || tests.var('bowling'), 'Antippen führt zum Plan');

select tests.login('bob');
select throws_ok($$ select public.remind_plan(tests.var('bowling')::uuid) $$, 'P0001', 'reminder_too_soon', 'höchstens eine Nachfrage alle sechs Stunden');
-- Auch Alice als Owner fragt in derselben Frist nicht noch einmal.
select tests.login('alice');
select throws_ok($$ select public.remind_plan(tests.var('bowling')::uuid) $$, 'P0001', 'reminder_too_soon', 'die Frist gilt je Plan, nicht je Person');

-- Nach sechs Stunden: Erik hat inzwischen zugesagt, Dave hat die Gruppe abgeschaltet.
select tests.logout();
update public.plan_reminders set last_sent_at = now() - interval '6 hours 1 minute' where plan_id = tests.var('bowling')::uuid;
update public.plan_participants set attendance_status = 'going', responded_at = now()
  where plan_id = tests.var('bowling')::uuid and user_id = tests.uid('erik');
update public.user_settings set notification_preferences = notification_preferences || '{"plan_reminder": false}'::jsonb
  where user_id = tests.uid('dave');
delete from public.notifications;
select tests.login('alice');
select is(public.remind_plan(tests.var('bowling')::uuid), 1, 'Owner Alice darf nachfragen; gezählt wird Dave');
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'plan_reminder'), 0, 'Dave hat die Gruppe abgeschaltet – keine Benachrichtigung');

-- Ehemalige Mitglieder werden nicht gefragt, auch wenn ihr Eintrag noch „eingeladen“ ist.
update public.plan_reminders set last_sent_at = now() - interval '7 hours' where plan_id = tests.var('bowling')::uuid;
update public.user_settings set notification_preferences = notification_preferences - 'plan_reminder'
  where user_id = tests.uid('dave');
delete from public.crew_members where crew_id = tests.var('crew')::uuid and user_id = tests.uid('dave');
insert into public.plan_participants (plan_id, user_id, attendance_status) values (tests.var('bowling')::uuid, tests.uid('dave'), 'invited')
  on conflict (plan_id, user_id) do update set attendance_status = 'invited';
select tests.login('bob');
select is(public.remind_plan(tests.var('bowling')::uuid), 0, 'ehemalige Mitglieder werden nicht gefragt');

-- Alle haben geantwortet: 0, und das zählt nicht als Nachfrage.
select tests.login('alice');
select is(public.remind_plan(tests.var('alle_da')::uuid), 0, 'alle haben geantwortet – niemand wird gefragt');
select tests.logout();
select is((select count(*)::int from public.plan_reminders where plan_id = tests.var('alle_da')::uuid and last_sent_at > now() - interval '6 hours'), 0,
          'ohne gefragte Person beginnt keine Frist');

-- Begonnen, abgesagt.
select tests.login('bob');
select throws_ok($$ select public.remind_plan(tests.var('gestartet')::uuid) $$, 'P0001', 'plan_already_started', 'nach Beginn wird nicht mehr nachgefragt');
select throws_ok($$ select public.remind_plan(tests.var('abgesagt')::uuid) $$, 'P0001', 'plan_locked', 'abgesagte Pläne: keine Nachfrage');
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'plan_reminder'), 0, 'begonnene und abgesagte Pläne lösen nichts aus');

select * from finish();
rollback;
