-- P53 Etappe 2a: Nachfragen bei „noch ohne Ticket“ – Organisator:in, Owner und Admins fragen alle mit Zusage, aber
-- ohne Ticket, höchstens alle 6 Stunden je Plan (eigene Frist neben P19/P45), nur bei eingeschaltetem Ticket-Check,
-- nicht nach Beginn, nicht bei abgeschlossenen/abgesagten Plänen; wer schon ein Ticket hat, „vielleicht“ oder nichts
-- gesagt hat, abgesagt hat, ausgetreten ist oder die Gruppe abgeschaltet hat, bekommt nichts; Außenstehende, anon und
-- einfache Mitglieder können nicht fragen.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Carol');
select tests.make_user('Dave');
select tests.make_user('Erik');
select tests.make_user('Fiona');
select tests.make_user('Mallory');

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Konzert Crew', '🎸')::text);
select tests.set_var('invite', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Bob tritt bei');
select tests.login('carol');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Carol tritt bei');
select tests.login('dave');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Dave tritt bei');
select tests.login('erik');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Erik tritt bei');
select tests.login('fiona');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Fiona tritt bei');
select tests.login('mallory');
select tests.set_var('mallory_crew', public.create_crew('Fremde Crew')::text);

-- Pläne direkt angelegt, damit Zeiten, Status und Ticket-Check frei wählbar sind.
select tests.logout();
insert into public.plans (crew_id, created_by, title, starts_at, status, tickets_needed) values
  (tests.var('crew')::uuid, tests.uid('bob'), 'Konzert', now() + interval '10 days', 'confirmed', true),
  (tests.var('crew')::uuid, tests.uid('bob'), 'Ohne Check', now() + interval '10 days', 'confirmed', false),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Alle haben', now() + interval '10 days', 'confirmed', true),
  (tests.var('crew')::uuid, tests.uid('bob'), 'Gestartet', now() - interval '10 minutes', 'confirmed', true),
  (tests.var('crew')::uuid, tests.uid('bob'), 'Abgesagt', now() + interval '2 days', 'cancelled', true),
  (tests.var('crew')::uuid, tests.uid('bob'), 'Vorbei', now() + interval '2 days', 'completed', true);
select tests.set_var(lower(replace(title, ' ', '_')), id::text) from public.plans
  where title in ('Konzert', 'Ohne Check', 'Alle haben', 'Gestartet', 'Abgesagt', 'Vorbei');
-- Konzert: Bob organisiert, ist dabei ohne Ticket; Carol und Dave dabei ohne Ticket; Erik dabei mit Ticket;
-- Fiona „vielleicht“ ohne Ticket; Alice hat abgesagt (ohne Ticket).
insert into public.plan_participants (plan_id, user_id, attendance_status, has_ticket) values
  (tests.var('konzert')::uuid, tests.uid('bob'), 'going', false),
  (tests.var('konzert')::uuid, tests.uid('carol'), 'going', false),
  (tests.var('konzert')::uuid, tests.uid('dave'), 'going', false),
  (tests.var('konzert')::uuid, tests.uid('erik'), 'going', true),
  (tests.var('konzert')::uuid, tests.uid('fiona'), 'maybe', false),
  (tests.var('konzert')::uuid, tests.uid('alice'), 'declined', false),
  (tests.var('ohne_check')::uuid, tests.uid('dave'), 'going', false),
  (tests.var('alle_haben')::uuid, tests.uid('alice'), 'going', false),
  (tests.var('alle_haben')::uuid, tests.uid('bob'), 'going', true),
  (tests.var('gestartet')::uuid, tests.uid('dave'), 'going', false),
  (tests.var('abgesagt')::uuid, tests.uid('dave'), 'going', false),
  (tests.var('vorbei')::uuid, tests.uid('dave'), 'going', false);
delete from public.notifications;

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.remind_plan_tickets(uuid)', 'execute'), 'anon darf nicht fragen');
select ok(has_function_privilege('authenticated', 'public.remind_plan_tickets(uuid)', 'execute'), 'angemeldete Personen dürfen die Funktion aufrufen');
select ok(not has_table_privilege('authenticated', 'public.plan_reminders', 'select'), 'die Nachfrage-Liste bleibt unlesbar');
select ok(not has_column_privilege('authenticated', 'public.plan_reminders', 'ticket_sent_at', 'update'), 'die neue Frist ist nicht beschreibbar');
select is((select p.prosecdef from pg_proc p where p.oid = 'public.remind_plan_tickets(uuid)'::regprocedure), true, 'SECURITY DEFINER');
select ok((select p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = 'public.remind_plan_tickets(uuid)'::regprocedure), 'search_path leer');

-- ---- Angriffe ----------------------------------------------------------------------------------
select tests.login_anon();
select throws_ok($$ select public.remind_plan_tickets(tests.var('konzert')::uuid) $$, '42501', null, 'anon kann nicht fragen');

select tests.login('mallory');
select throws_ok($$ select public.remind_plan_tickets(tests.var('konzert')::uuid) $$, '42501', 'forbidden', 'Außenstehende können nicht fragen');
select throws_ok($$ select public.remind_plan_tickets(gen_random_uuid()) $$, '42501', 'forbidden', 'unbekannter Plan verrät nichts');

select tests.login('carol');
select throws_ok($$ select public.remind_plan_tickets(tests.var('konzert')::uuid) $$, '42501', 'forbidden', 'einfache Mitglieder fragen bei fremden Plänen nicht');
select is((select count(*)::int from public.notifications), 0, 'keine Benachrichtigung nach den Angriffen');

-- ---- Ablauf ------------------------------------------------------------------------------------
select tests.login('bob');
select throws_ok($$ select public.remind_plan_tickets(tests.var('ohne_check')::uuid) $$, 'P0001', 'plan_tickets_off', 'ohne Ticket-Check keine Frage');
select is(public.remind_plan_tickets(tests.var('konzert')::uuid), 2, 'Bob fragt Carol und Dave (dabei, ohne Ticket)');
select tests.logout();
select is((select array_agg(n.user_id order by n.user_id) from public.notifications n where n.type = 'plan_reminder'),
          (select array_agg(u order by u) from unnest(array[tests.uid('carol'), tests.uid('dave')]) u),
          'nur Carol und Dave – nicht Erik (hat eins), Fiona („vielleicht“), Alice (abgesagt), Bob selbst');
select is((select n.actor_id from public.notifications n where n.type = 'plan_reminder' limit 1), tests.uid('bob'), 'Bob steht als fragende Person drin');
select is((select n.payload ->> 'title' from public.notifications n where n.type = 'plan_reminder' limit 1), 'Konzert', 'Titel im Payload');
select ok((select n.payload ? 'starts_at' from public.notifications n where n.type = 'plan_reminder' limit 1), 'Beginn im Payload');
select is((select bool_and((n.payload ->> 'ticket')::boolean) from public.notifications n where n.type = 'plan_reminder'), true, 'als Ticket-Frage gekennzeichnet');
select is((select count(*)::int from public.notifications n where n.type = 'plan_reminder' and n.payload ? 'maybe'), 0, 'keine Verwechslung mit P45');
select is((select n.entity_type || ':' || n.related_entity_id::text from public.notifications n where n.type = 'plan_reminder' limit 1),
          'plan:' || tests.var('konzert'), 'Antippen führt zum Plan');

select tests.login('bob');
select throws_ok($$ select public.remind_plan_tickets(tests.var('konzert')::uuid) $$, 'P0001', 'reminder_too_soon', 'höchstens einmal alle sechs Stunden');
select tests.login('alice');
select throws_ok($$ select public.remind_plan_tickets(tests.var('konzert')::uuid) $$, 'P0001', 'reminder_too_soon', 'die Frist gilt je Plan, nicht je Person');

-- Die Fristen von P45 bleiben unabhängig: „Vielleicht“ lässt sich trotzdem fragen (Fiona).
select tests.login('bob');
select is(public.remind_plan_maybe(tests.var('konzert')::uuid), 1, 'P45 fragt Fiona trotz frischer Ticket-Frage');
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'plan_reminder' and user_id = tests.uid('fiona') and not (payload ? 'ticket')),
          1, 'Fiona bekommt die Frage an „Vielleicht“, keine Ticket-Frage');

-- Nach sechs Stunden: Carol hat ihr Ticket, Dave hat die Gruppe abgeschaltet.
update public.plan_reminders set ticket_sent_at = now() - interval '6 hours 1 minute' where plan_id = tests.var('konzert')::uuid;
update public.plan_participants set has_ticket = true where plan_id = tests.var('konzert')::uuid and user_id = tests.uid('carol');
update public.user_settings set notification_preferences = notification_preferences || '{"plan_reminder": false}'::jsonb
  where user_id = tests.uid('dave');
delete from public.notifications;
select tests.login('alice');
select is(public.remind_plan_tickets(tests.var('konzert')::uuid), 2, 'Owner Alice darf fragen; gezählt werden Bob (ohne Ticket, fragt jetzt nicht selbst) und Dave');
select tests.logout();
select is((select array_agg(n.user_id) from public.notifications n where n.type = 'plan_reminder'), array[tests.uid('bob')],
          'nur Bob bekommt etwas – Dave hat die Gruppe abgeschaltet, Carol hat inzwischen ein Ticket');
delete from public.notifications;

-- Ehemalige Mitglieder werden nicht gefragt.
update public.plan_reminders set ticket_sent_at = now() - interval '7 hours' where plan_id = tests.var('konzert')::uuid;
update public.plan_participants set has_ticket = true where plan_id = tests.var('konzert')::uuid and user_id = tests.uid('bob');
delete from public.crew_members where crew_id = tests.var('crew')::uuid and user_id = tests.uid('dave');
insert into public.plan_participants (plan_id, user_id, attendance_status, has_ticket) values (tests.var('konzert')::uuid, tests.uid('dave'), 'going', false)
  on conflict (plan_id, user_id) do update set attendance_status = 'going', has_ticket = false;
select tests.login('bob');
select is(public.remind_plan_tickets(tests.var('konzert')::uuid), 0, 'ehemalige Mitglieder werden nicht gefragt');

-- Alle haben eins: 0, und das zählt nicht als Nachfrage.
select tests.login('alice');
select is(public.remind_plan_tickets(tests.var('alle_haben')::uuid), 0, 'alle anderen haben ein Ticket – niemand wird gefragt');
select tests.logout();
select is((select count(*)::int from public.plan_reminders where plan_id = tests.var('alle_haben')::uuid and ticket_sent_at > now() - interval '6 hours'), 0,
          'ohne gefragte Person beginnt keine Frist');

-- Begonnen, abgesagt, abgeschlossen.
select tests.login('bob');
select throws_ok($$ select public.remind_plan_tickets(tests.var('gestartet')::uuid) $$, 'P0001', 'plan_already_started', 'nach Beginn wird nicht mehr gefragt');
select throws_ok($$ select public.remind_plan_tickets(tests.var('abgesagt')::uuid) $$, 'P0001', 'plan_locked', 'abgesagte Pläne: keine Frage');
select throws_ok($$ select public.remind_plan_tickets(tests.var('vorbei')::uuid) $$, 'P0001', 'plan_locked', 'abgeschlossene Pläne: keine Frage');
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'plan_reminder'), 0, 'begonnene, abgesagte und abgeschlossene Pläne lösen nichts aus');

select * from finish();
rollback;
