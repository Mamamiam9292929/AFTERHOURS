-- P53: „Habt ihr alle Tickets?“ – Ticket-Check je Plan. Einschalten nur Organisator:in/Owner/Admin, „Hab mein
-- Ticket“ nur die eigene Angabe von Mitgliedern mit Zeile im Plan, nur bei eingeschaltetem Check und offenem Plan;
-- die Angabe bleibt beim Absagen (Ticket übrig) und beim Ausschalten; Außenstehende und anon kommen nicht heran.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Carol');
select tests.make_user('Dave');
select tests.make_user('Mallory');

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Konzert Crew', '🎸')::text);
select tests.set_var('invite', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob');
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('carol');
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('mallory');
select public.create_crew('Fremde Crew');

-- Bob legt den Plan an (Organisator, ist dabei). Dave kommt erst danach in die Crew.
select tests.login('bob');
select tests.set_var('plan', public.create_plan(tests.var('crew')::uuid, 'Konzert', now() + interval '10 days', p_confirmed => true)::text);
select tests.login('dave');
select public.accept_crew_invitation(tests.var('invite'));

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.set_plan_tickets_needed(uuid, boolean)', 'execute'), 'anon schaltet nichts');
select ok(not has_function_privilege('anon', 'public.set_my_plan_ticket(uuid, boolean)', 'execute'), 'anon meldet kein Ticket');
select ok(has_function_privilege('authenticated', 'public.set_plan_tickets_needed(uuid, boolean)', 'execute'), 'angemeldete dürfen schalten (Prüfung innen)');
select ok(has_function_privilege('authenticated', 'public.set_my_plan_ticket(uuid, boolean)', 'execute'), 'angemeldete dürfen melden (Prüfung innen)');
select tests.logout();
select tests.login_anon();
select throws_ok($$ select public.set_plan_tickets_needed(tests.var('plan')::uuid, true) $$, '42501', null, 'ohne Konto: verboten');
select throws_ok($$ select public.set_my_plan_ticket(tests.var('plan')::uuid, true) $$, '42501', null, 'ohne Konto: kein Ticket');

-- ---- Angriffe ------------------------------------------------------------------------------------
select tests.login('mallory');
select throws_ok($$ select public.set_plan_tickets_needed(tests.var('plan')::uuid, true) $$, '42501', null, 'Außenstehende schalten nichts');
select throws_ok($$ select public.set_plan_tickets_needed(gen_random_uuid(), true) $$, '42501', null, 'unbekannter Plan verrät nichts');
select throws_ok($$ select public.set_my_plan_ticket(tests.var('plan')::uuid, true) $$, '42501', null, 'Außenstehende melden kein Ticket');
select is((select count(*)::int from public.plans where id = tests.var('plan')::uuid), 0, 'Außenstehende sehen den Plan nicht');
select tests.login('carol');
select throws_ok($$ select public.set_plan_tickets_needed(tests.var('plan')::uuid, true) $$, '42501', null, 'einfaches Mitglied schaltet nicht');
select throws_ok($$ update public.plans set tickets_needed = true where id = tests.var('plan')::uuid $$, '42501', null,
  'kein direktes Schreiben am Plan vorbei');
select throws_ok($$ update public.plan_participants set has_ticket = true where plan_id = tests.var('plan')::uuid and user_id = auth.uid() $$,
  '42501', null, 'kein direktes Schreiben an der Funktion vorbei');
select throws_ok($$ select public.set_my_plan_ticket(tests.var('plan')::uuid, true) $$, 'P0001', 'plan_tickets_off', 'Check aus: kein Ticket melden');

-- ---- Einschalten ------------------------------------------------------------------------------------
select tests.login('bob');
select throws_ok($$ select public.set_plan_tickets_needed(tests.var('plan')::uuid, null) $$, 'P0001', 'invalid_input', 'nicht leer');
select is(public.set_plan_tickets_needed(tests.var('plan')::uuid, true), true, 'Bob schaltet den Ticket-Check ein');
select is(public.set_plan_tickets_needed(tests.var('plan')::uuid, true), true, 'noch einmal: bleibt an');
select tests.logout();
select is((select count(*)::int from public.audit_log where action = 'plan_tickets_needed_set' and entity_id = tests.var('plan')::uuid), 1,
  'genau ein Eintrag im Protokoll');
select tests.login('alice');
select is(public.set_plan_tickets_needed(tests.var('plan')::uuid, true), true, 'Owner darf auch');
select tests.login('carol');
select ok((select tickets_needed from public.plans where id = tests.var('plan')::uuid), 'die Crew sieht: Ticket-Check an');

-- ---- Eigene Angabe ------------------------------------------------------------------------------------
select throws_ok($$ select public.set_my_plan_ticket(tests.var('plan')::uuid, null) $$, 'P0001', 'invalid_input', 'nicht leer');
select is(public.set_my_plan_ticket(tests.var('plan')::uuid, true), true, 'Carol hat ihr Ticket (auch ohne Antwort)');
select is(public.set_my_plan_ticket(tests.var('plan')::uuid, true), true, 'noch einmal: bleibt');
select tests.login('bob');
select is((select has_ticket from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = tests.uid('carol')), true,
  'Bob sieht: Carol hat ein Ticket');
select is((select has_ticket from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = auth.uid()), false,
  'Bob hat noch keins – nur die eigene Angabe zählt');
-- Ohne Zeile im Plan (z. B. nach Austritt und Wiedereintritt) gibt es keine Angabe und keine untergeschobene Zeile.
select tests.logout();
delete from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = tests.uid('dave');
select tests.login('dave');
select throws_ok($$ select public.set_my_plan_ticket(tests.var('plan')::uuid, true) $$, 'P0001', 'plan_ticket_not_invited',
  'ohne Zeile im Plan: keine Angabe');
select is((select count(*)::int from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = auth.uid()), 0,
  'Dave bekommt keine Zeile untergeschoben');

-- ---- Ticket übrig, Ausschalten ------------------------------------------------------------------------------------
select tests.login('carol');
select public.set_attendance(tests.var('plan')::uuid, 'declined');
select is((select has_ticket from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = auth.uid()), true,
  'abgesagt: Angabe bleibt (Ticket übrig)');
select is(public.set_my_plan_ticket(tests.var('plan')::uuid, false), false, 'Carol nimmt die Angabe zurück');
select is(public.set_my_plan_ticket(tests.var('plan')::uuid, true), true, 'und setzt sie wieder');
select tests.login('bob');
select is(public.set_plan_tickets_needed(tests.var('plan')::uuid, false), false, 'Bob schaltet aus');
select is((select has_ticket from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = tests.uid('carol')), true,
  'Ausschalten löscht keine Angaben');
select tests.login('carol');
select throws_ok($$ select public.set_my_plan_ticket(tests.var('plan')::uuid, false) $$, 'P0001', 'plan_tickets_off', 'aus: nichts ändern');
select tests.login('bob');
select public.set_plan_tickets_needed(tests.var('plan')::uuid, true);

-- ---- Datenexport ------------------------------------------------------------------------------------
select tests.login('carol');
select is((select (e ->> 'has_ticket')::boolean from jsonb_array_elements(public.export_my_data() -> 'plans') e
           where e ->> 'plan_id' = tests.var('plan')), true, 'Export nennt die eigene Ticket-Angabe');

-- ---- Gesperrt ------------------------------------------------------------------------------------
select tests.logout();
update public.plans set starts_at = now() - interval '1 hour' where id = tests.var('plan')::uuid;
select tests.login('bob');
select is(public.set_my_plan_ticket(tests.var('plan')::uuid, true), true, 'nach Beginn geht es noch (Ticket an der Abendkasse)');
select tests.logout();
update public.plans set status = 'cancelled' where id = tests.var('plan')::uuid;
select tests.login('bob');
select throws_ok($$ select public.set_my_plan_ticket(tests.var('plan')::uuid, false) $$, 'P0001', 'plan_locked', 'abgesagt: gesperrt');
select throws_ok($$ select public.set_plan_tickets_needed(tests.var('plan')::uuid, false) $$, 'P0001', 'plan_locked', 'abgesagt: Schalter gesperrt');

select * from finish();
rollback;
