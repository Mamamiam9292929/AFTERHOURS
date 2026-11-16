-- P55 Etappe 1 · „Ich besorg die Tickets“: Wer zugesagt hat, übernimmt im Ticket-Check Personen mit Zusage ohne Ticket
-- („Bob besorgt dein Ticket“) und tippt später „Gekauft“ – dann haben sie ein Ticket mit Bob als Quelle. Nur Mitglieder
-- mit Zusage, nur Personen ohne Ticket, niemand doppelt; die eigene Angabe der Person hat Vorrang, eine Absage gibt
-- frei, sagt Bob ab, sind seine offenen Übernahmen weg. anon, Außenstehende und falsche Angaben werden abgewiesen.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Carol');
select tests.make_user('Dave');
select tests.make_user('Erik');
select tests.make_user('Fiona');
select tests.make_user('Gina');
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
select tests.login('gina');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Gina tritt bei');
select tests.login('mallory');
select tests.set_var('mallory_crew', public.create_crew('Fremde Crew')::text);

select tests.logout();
insert into public.plans (crew_id, created_by, title, starts_at, status, tickets_needed) values
  (tests.var('crew')::uuid, tests.uid('alice'), 'Konzert', now() + interval '10 days', 'confirmed', true),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Ohne Check', now() + interval '10 days', 'confirmed', false),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Gestartet', now() - interval '10 minutes', 'confirmed', true),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Abgesagt', now() + interval '2 days', 'cancelled', true);
select tests.set_var(lower(replace(title, ' ', '_')), id::text) from public.plans
  where title in ('Konzert', 'Ohne Check', 'Gestartet', 'Abgesagt');
-- Konzert: Bob, Carol, Dave, Gina dabei ohne Ticket; Alice dabei mit Ticket; Erik „vielleicht“; Fiona abgesagt.
insert into public.plan_participants (plan_id, user_id, attendance_status, has_ticket) values
  (tests.var('konzert')::uuid, tests.uid('alice'), 'going', true),
  (tests.var('konzert')::uuid, tests.uid('bob'), 'going', false),
  (tests.var('konzert')::uuid, tests.uid('carol'), 'going', false),
  (tests.var('konzert')::uuid, tests.uid('dave'), 'going', false),
  (tests.var('konzert')::uuid, tests.uid('gina'), 'going', false),
  (tests.var('konzert')::uuid, tests.uid('erik'), 'maybe', false),
  (tests.var('konzert')::uuid, tests.uid('fiona'), 'declined', false),
  (tests.var('ohne_check')::uuid, tests.uid('bob'), 'going', false),
  (tests.var('ohne_check')::uuid, tests.uid('carol'), 'going', false),
  (tests.var('gestartet')::uuid, tests.uid('bob'), 'going', false),
  (tests.var('gestartet')::uuid, tests.uid('carol'), 'going', false),
  (tests.var('abgesagt')::uuid, tests.uid('bob'), 'going', false),
  (tests.var('abgesagt')::uuid, tests.uid('carol'), 'going', false);
delete from public.notifications;

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.set_plan_ticket_buys(uuid, uuid[])', 'execute'), 'anon darf nicht besorgen');
select ok(not has_function_privilege('anon', 'public.mark_plan_tickets_bought(uuid)', 'execute'), 'anon darf nicht „gekauft“ melden');
select ok(has_function_privilege('authenticated', 'public.set_plan_ticket_buys(uuid, uuid[])', 'execute'), 'angemeldete Personen dürfen besorgen (Funktion)');
select ok(has_function_privilege('authenticated', 'public.mark_plan_tickets_bought(uuid)', 'execute'), 'angemeldete Personen dürfen „gekauft“ melden (Funktion)');
select ok(not has_column_privilege('authenticated', 'public.plan_participants', 'ticket_by', 'update'), 'die Übernahme ist nicht direkt beschreibbar');
select is((select bool_and(p.prosecdef) from pg_proc p where p.oid in ('public.set_plan_ticket_buys(uuid, uuid[])'::regprocedure, 'public.mark_plan_tickets_bought(uuid)'::regprocedure)),
          true, 'SECURITY DEFINER');
select ok((select bool_and(p.proconfig @> array['search_path=""']) from pg_proc p
           where p.oid in ('public.set_plan_ticket_buys(uuid, uuid[])'::regprocedure, 'public.mark_plan_tickets_bought(uuid)'::regprocedure,
                           'app_private.plan_participant_ticket_buyer_gone()'::regprocedure, 'app_private.plan_participant_ticket_by_reset()'::regprocedure)),
          'search_path leer');
select ok(not has_function_privilege('authenticated', 'app_private.plan_participant_ticket_by_reset()', 'execute'), 'Trigger-Funktion nicht aufrufbar');
select ok(not has_function_privilege('authenticated', 'app_private.plan_participant_ticket_buyer_gone()', 'execute'), 'Trigger-Funktion nicht aufrufbar (Absage)');

-- ---- Angriffe ----------------------------------------------------------------------------------
select tests.login_anon();
select throws_ok($$ select public.set_plan_ticket_buys(tests.var('konzert')::uuid, array[tests.uid('carol')]) $$, '42501', null, 'anon kann nicht besorgen');
select throws_ok($$ select public.mark_plan_tickets_bought(tests.var('konzert')::uuid) $$, '42501', null, 'anon kann nicht „gekauft“ melden');
select tests.login('mallory');
select throws_ok($$ select public.set_plan_ticket_buys(tests.var('konzert')::uuid, array[tests.uid('carol')]) $$, '42501', 'forbidden', 'Außenstehende können nicht besorgen');
select throws_ok($$ select public.mark_plan_tickets_bought(tests.var('konzert')::uuid) $$, '42501', 'forbidden', 'Außenstehende können nicht „gekauft“ melden');
select throws_ok($$ select public.set_plan_ticket_buys(gen_random_uuid(), array[tests.uid('carol')]) $$, '42501', 'forbidden', 'unbekannter Plan verrät nichts');

-- ---- Falsche Angaben ---------------------------------------------------------------------------
select tests.login('erik');
select throws_ok($$ select public.set_plan_ticket_buys(tests.var('konzert')::uuid, array[tests.uid('carol')]) $$, 'P0001', 'plan_ticket_buy_not_going', '„vielleicht“: erst zusagen');
select tests.login('fiona');
select throws_ok($$ select public.set_plan_ticket_buys(tests.var('konzert')::uuid, array[tests.uid('carol')]) $$, 'P0001', 'plan_ticket_buy_not_going', 'Absage: besorgt nichts');
select tests.login('bob');
select throws_ok($$ select public.set_plan_ticket_buys(tests.var('konzert')::uuid, array[tests.uid('bob')]) $$, 'P0001', 'invalid_input', 'nicht für sich selbst');
select throws_ok($$ select public.set_plan_ticket_buys(tests.var('konzert')::uuid, null) $$, 'P0001', 'invalid_input', 'ohne Liste nichts');
select throws_ok($$ select public.set_plan_ticket_buys(tests.var('konzert')::uuid, array[null::uuid]) $$, 'P0001', 'invalid_input', 'leere Einträge nicht');
select throws_ok($$ select public.set_plan_ticket_buys(tests.var('konzert')::uuid, array(select gen_random_uuid() from generate_series(1, 31))) $$,
                 'P0001', 'invalid_input', 'höchstens 30 Personen');
select throws_ok($$ select public.set_plan_ticket_buys(tests.var('konzert')::uuid, array[tests.uid('alice')]) $$, 'P0001', 'plan_ticket_buy_unavailable', 'Alice hat schon eins');
select throws_ok($$ select public.set_plan_ticket_buys(tests.var('konzert')::uuid, array[tests.uid('erik')]) $$, 'P0001', 'plan_ticket_buy_unavailable', 'Erik hat nicht zugesagt');
select throws_ok($$ select public.set_plan_ticket_buys(tests.var('konzert')::uuid, array[tests.uid('fiona')]) $$, 'P0001', 'plan_ticket_buy_unavailable', 'Fiona hat abgesagt');
select throws_ok($$ select public.set_plan_ticket_buys(tests.var('konzert')::uuid, array[tests.uid('mallory')]) $$, 'P0001', 'plan_ticket_buy_unavailable', 'Außenstehende nicht');
select throws_ok($$ select public.set_plan_ticket_buys(tests.var('konzert')::uuid, array[tests.uid('carol'), tests.uid('mallory')]) $$, 'P0001', 'plan_ticket_buy_unavailable',
                 'ein falscher Eintrag verwirft die ganze Liste');
select throws_ok($$ select public.set_plan_ticket_buys(tests.var('ohne_check')::uuid, array[tests.uid('carol')]) $$, 'P0001', 'plan_tickets_off', 'ohne Ticket-Check nichts');
select throws_ok($$ select public.set_plan_ticket_buys(tests.var('gestartet')::uuid, array[tests.uid('carol')]) $$, 'P0001', 'plan_plus_ones_started', 'nach Beginn nichts');
select throws_ok($$ select public.set_plan_ticket_buys(tests.var('abgesagt')::uuid, array[tests.uid('carol')]) $$, 'P0001', 'plan_locked', 'abgesagter Plan: nichts');
select throws_ok($$ select public.mark_plan_tickets_bought(tests.var('konzert')::uuid) $$, 'P0001', 'plan_ticket_buy_none', 'ohne Übernahme nichts gekauft');
select tests.logout();
select is((select count(*)::int from public.notifications), 0, 'keine Benachrichtigung nach Angriffen und Fehlern');
select is((select count(*)::int from public.plan_participants where ticket_by is not null), 0, 'keine Übernahme nach Angriffen und Fehlern');

-- ---- Besorgen ----------------------------------------------------------------------------------
select tests.login('bob');
select is(public.set_plan_ticket_buys(tests.var('konzert')::uuid, array[tests.uid('carol'), tests.uid('dave'), tests.uid('carol')]), 2,
          'Bob besorgt für Carol und Dave (doppelt genannt zählt einmal)');
select tests.logout();
select is((select array_agg(user_id order by user_id) from public.plan_participants where plan_id = tests.var('konzert')::uuid and ticket_by = tests.uid('bob')),
          (select array_agg(u order by u) from unnest(array[tests.uid('carol'), tests.uid('dave')]) u), 'bei Carol und Dave steht Bob');
select is((select count(*)::int from public.plan_participants where plan_id = tests.var('konzert')::uuid and ticket_by is not null and has_ticket), 0,
          'übernommen heißt noch nicht gekauft');
select is((select array_agg(n.user_id order by n.user_id) from public.notifications n where n.type = 'plan_reminder' and (n.payload ->> 'ticket_buy')::boolean),
          (select array_agg(u order by u) from unnest(array[tests.uid('carol'), tests.uid('dave')]) u), 'Carol und Dave bekommen Bescheid');
select is((select n.actor_id from public.notifications n where n.type = 'plan_reminder' limit 1), tests.uid('bob'), 'von Bob');
delete from public.notifications;

-- Gina besorgt auch – Carol ist schon vergeben.
select tests.login('gina');
select throws_ok($$ select public.set_plan_ticket_buys(tests.var('konzert')::uuid, array[tests.uid('carol')]) $$, 'P0001', 'plan_ticket_buy_unavailable',
                 'Carol besorgt schon Bob – niemand doppelt');
select is(public.set_plan_ticket_buys(tests.var('konzert')::uuid, array[tests.uid('bob')]), 1, 'Gina besorgt für Bob – wer selbst besorgt, kann auch besorgt werden');

-- Bob ändert seine Liste: Dave raus, Gina rein – Dave ist wieder frei, nur Gina bekommt neu Bescheid.
select tests.logout();
delete from public.notifications;
select tests.login('bob');
select is(public.set_plan_ticket_buys(tests.var('konzert')::uuid, array[tests.uid('carol'), tests.uid('gina')]), 2, 'Bob: Carol und Gina');
select tests.logout();
select is((select ticket_by from public.plan_participants where plan_id = tests.var('konzert')::uuid and user_id = tests.uid('dave')), null, 'Dave ist wieder frei');
select is((select array_agg(n.user_id) from public.notifications n where n.type = 'plan_reminder'), array[tests.uid('gina')], 'nur Gina bekommt neu Bescheid, Carol nicht noch mal');

-- Nachfragen (P53 Etappe 2a) überspringt, wessen Ticket gerade jemand besorgt.
delete from public.notifications;
select tests.login('alice');
select is(public.remind_plan_tickets(tests.var('konzert')::uuid), 1, 'Nachfragen fragt nur Dave');
select tests.logout();
select is((select array_agg(n.user_id) from public.notifications n where n.type = 'plan_reminder'), array[tests.uid('dave')], 'Carol, Gina und Bob (besorgt) werden nicht gefragt');
delete from public.notifications;

-- ---- Gekauft -----------------------------------------------------------------------------------
select tests.login('bob');
select is(public.mark_plan_tickets_bought(tests.var('konzert')::uuid), 2, 'Bob hat für Carol und Gina gekauft');
select throws_ok($$ select public.mark_plan_tickets_bought(tests.var('konzert')::uuid) $$, 'P0001', 'plan_ticket_buy_none', 'nicht doppelt');
select tests.logout();
select is((select count(*)::int from public.plan_participants where plan_id = tests.var('konzert')::uuid and ticket_by = tests.uid('bob') and has_ticket), 2,
          'Carol und Gina haben ein Ticket – von Bob');
select is((select has_ticket from public.plan_participants where plan_id = tests.var('konzert')::uuid and user_id = tests.uid('bob')), false,
          'Bobs eigenes Ticket besorgt weiter Gina (noch nicht gekauft)');
select is((select array_agg(n.user_id order by n.user_id) from public.notifications n where n.type = 'plan_reminder' and (n.payload ->> 'ticket_bought')::boolean),
          (select array_agg(u order by u) from unnest(array[tests.uid('carol'), tests.uid('gina')]) u), 'Carol und Gina bekommen Bescheid');
delete from public.notifications;

-- Gekaufte bleiben, auch wenn Bob die Liste leert.
select tests.login('bob');
select is(public.set_plan_ticket_buys(tests.var('konzert')::uuid, array[]::uuid[]), 0, 'Bob leert seine Liste – nichts mehr offen');
select tests.logout();
select is((select count(*)::int from public.plan_participants where plan_id = tests.var('konzert')::uuid and ticket_by = tests.uid('bob') and has_ticket), 2,
          'schon Gekauftes bleibt');

-- ---- Eigene Angabe hat Vorrang -----------------------------------------------------------------
select tests.login('carol');
select is(public.set_my_plan_ticket(tests.var('konzert')::uuid, false), false, 'Carol sagt doch „noch keins“');
select tests.logout();
select is((select ticket_by from public.plan_participants where plan_id = tests.var('konzert')::uuid and user_id = tests.uid('carol')), null,
          '„noch keins“ nimmt Bob als Quelle raus');
select tests.login('bob');
select is(public.set_plan_ticket_buys(tests.var('konzert')::uuid, array[tests.uid('dave')]), 1, 'Bob besorgt für Dave');
select tests.login('dave');
select is(public.set_my_plan_ticket(tests.var('konzert')::uuid, true), true, 'Dave hat doch selbst eins gekauft');
select tests.logout();
select is((select ticket_by from public.plan_participants where plan_id = tests.var('konzert')::uuid and user_id = tests.uid('dave')), null,
          'Daves eigenes „Hab mein Ticket“ nimmt Bobs Übernahme raus');
select tests.login('bob');
select throws_ok($$ select public.mark_plan_tickets_bought(tests.var('konzert')::uuid) $$, 'P0001', 'plan_ticket_buy_none', 'für Dave nichts mehr zu kaufen');

-- ---- Absage gibt frei --------------------------------------------------------------------------
select is(public.set_plan_ticket_buys(tests.var('konzert')::uuid, array[tests.uid('carol')]), 1, 'Bob besorgt wieder für Carol');
select tests.logout();
update public.plan_participants set attendance_status = 'declined' where plan_id = tests.var('konzert')::uuid and user_id = tests.uid('carol');
select is((select ticket_by from public.plan_participants where plan_id = tests.var('konzert')::uuid and user_id = tests.uid('carol')), null, 'Carols Absage gibt sie frei');
update public.plan_participants set attendance_status = 'going' where plan_id = tests.var('konzert')::uuid and user_id = tests.uid('carol');
select tests.login('bob');
select is(public.set_plan_ticket_buys(tests.var('konzert')::uuid, array[tests.uid('carol')]), 1, 'Bob besorgt noch mal für Carol');
select tests.logout();
-- Gina besorgt weiter für Bob; Bob sagt ab: Carol ist frei, und Bob wird nicht mehr mitbesorgt.
update public.plan_participants set attendance_status = 'declined' where plan_id = tests.var('konzert')::uuid and user_id = tests.uid('bob');
select is((select ticket_by from public.plan_participants where plan_id = tests.var('konzert')::uuid and user_id = tests.uid('carol')), null,
          'Bobs Absage gibt Carol frei');
select is((select ticket_by from public.plan_participants where plan_id = tests.var('konzert')::uuid and user_id = tests.uid('bob')), null,
          '… und Gina besorgt nicht mehr für Bob');
select is((select count(*)::int from public.plan_participants where plan_id = tests.var('konzert')::uuid and ticket_by = tests.uid('bob') and has_ticket), 1,
          'Ginas schon gekauftes Ticket von Bob bleibt');

-- Verlassen der Crew gibt frei: Dave besorgt für Carol und verlässt die Crew.
update public.plan_participants set has_ticket = false where plan_id = tests.var('konzert')::uuid and user_id = tests.uid('dave');
select tests.login('dave');
select is(public.set_plan_ticket_buys(tests.var('konzert')::uuid, array[tests.uid('carol')]), 1, 'Dave besorgt für Carol');
select tests.logout();
delete from public.crew_members where crew_id = tests.var('crew')::uuid and user_id = tests.uid('dave');
select is((select ticket_by from public.plan_participants where plan_id = tests.var('konzert')::uuid and user_id = tests.uid('carol')), null,
          'wer die Crew verlässt, besorgt nichts mehr');
select tests.login('dave');
select throws_ok($$ select public.mark_plan_tickets_bought(tests.var('konzert')::uuid) $$, '42501', 'forbidden', 'ehemalige Mitglieder melden nichts');

-- Datenexport: die eigene Quelle steht dabei.
select tests.login('gina');
select is((select (e ->> 'ticket_by')::uuid from jsonb_array_elements(public.export_my_data() -> 'plans') e where (e ->> 'plan_id')::uuid = tests.var('konzert')::uuid),
          tests.uid('bob'), 'Export zeigt, wer das Ticket besorgt hat');

select * from finish();
rollback;
