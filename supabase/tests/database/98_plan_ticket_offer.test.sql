-- P54 · „Ticket übrig – wer will?“: Wer abgesagt hat und ein Ticket hat, bietet es mit einem Tipp an; alle aus der Crew
-- mit Zusage ohne Ticket bekommen Bescheid. Wer zuerst „Nehm ich“ tippt, bekommt es – danach hat die neue Person ein
-- Ticket, die anbietende nicht mehr, und sie erfährt, wer es nimmt. Nur bei eingeschaltetem Ticket-Check, nur vor
-- Beginn, nicht bei abgeschlossenen/abgesagten Plänen; Angebot verfällt mit Zusage oder „noch keins“; ehemalige
-- Mitglieder bieten nichts mehr an; anon, Außenstehende und falsche Antworten werden abgewiesen.
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
  (tests.var('crew')::uuid, tests.uid('bob'), 'Gestartet', now() - interval '10 minutes', 'confirmed', true),
  (tests.var('crew')::uuid, tests.uid('bob'), 'Abgesagt', now() + interval '2 days', 'cancelled', true),
  (tests.var('crew')::uuid, tests.uid('bob'), 'Vorbei', now() + interval '2 days', 'completed', true);
select tests.set_var(lower(replace(title, ' ', '_')), id::text) from public.plans
  where title in ('Konzert', 'Ohne Check', 'Gestartet', 'Abgesagt', 'Vorbei');
-- Konzert: Alice hat abgesagt und ein Ticket übrig; Bob und Carol sind dabei ohne Ticket; Dave dabei mit Ticket;
-- Erik „vielleicht“ ohne Ticket; Fiona hat abgesagt ohne Ticket.
insert into public.plan_participants (plan_id, user_id, attendance_status, has_ticket) values
  (tests.var('konzert')::uuid, tests.uid('alice'), 'declined', true),
  (tests.var('konzert')::uuid, tests.uid('bob'), 'going', false),
  (tests.var('konzert')::uuid, tests.uid('carol'), 'going', false),
  (tests.var('konzert')::uuid, tests.uid('dave'), 'going', true),
  (tests.var('konzert')::uuid, tests.uid('erik'), 'maybe', false),
  (tests.var('konzert')::uuid, tests.uid('fiona'), 'declined', false),
  (tests.var('ohne_check')::uuid, tests.uid('alice'), 'declined', true),
  (tests.var('ohne_check')::uuid, tests.uid('bob'), 'going', false),
  (tests.var('gestartet')::uuid, tests.uid('alice'), 'declined', true),
  (tests.var('gestartet')::uuid, tests.uid('bob'), 'going', false),
  (tests.var('abgesagt')::uuid, tests.uid('alice'), 'declined', true),
  (tests.var('abgesagt')::uuid, tests.uid('bob'), 'going', false),
  (tests.var('vorbei')::uuid, tests.uid('alice'), 'declined', true),
  (tests.var('vorbei')::uuid, tests.uid('bob'), 'going', false);
delete from public.notifications;

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.offer_plan_ticket(uuid)', 'execute'), 'anon darf nicht anbieten');
select ok(not has_function_privilege('anon', 'public.take_plan_ticket(uuid, uuid)', 'execute'), 'anon darf nicht nehmen');
select ok(has_function_privilege('authenticated', 'public.offer_plan_ticket(uuid)', 'execute'), 'angemeldete Personen dürfen anbieten (Funktion)');
select ok(has_function_privilege('authenticated', 'public.take_plan_ticket(uuid, uuid)', 'execute'), 'angemeldete Personen dürfen nehmen (Funktion)');
select ok(not has_column_privilege('authenticated', 'public.plan_participants', 'ticket_offered_at', 'update'), 'das Angebot ist nicht direkt beschreibbar');
select ok(not has_column_privilege('authenticated', 'public.plan_participants', 'has_ticket', 'update'), 'die Ticket-Angabe ist nicht direkt beschreibbar');
select is((select bool_and(p.prosecdef) from pg_proc p where p.oid in ('public.offer_plan_ticket(uuid)'::regprocedure, 'public.take_plan_ticket(uuid, uuid)'::regprocedure)),
          true, 'SECURITY DEFINER');
select ok((select bool_and(p.proconfig @> array['search_path=""']) from pg_proc p
           where p.oid in ('public.offer_plan_ticket(uuid)'::regprocedure, 'public.take_plan_ticket(uuid, uuid)'::regprocedure)), 'search_path leer');
select ok(not has_function_privilege('authenticated', 'app_private.plan_participant_ticket_offer_reset()', 'execute'), 'Trigger-Funktion nicht aufrufbar');

-- ---- Angriffe ----------------------------------------------------------------------------------
select tests.login_anon();
select throws_ok($$ select public.offer_plan_ticket(tests.var('konzert')::uuid) $$, '42501', null, 'anon kann nicht anbieten');
select throws_ok($$ select public.take_plan_ticket(tests.var('konzert')::uuid, tests.uid('alice')) $$, '42501', null, 'anon kann nicht nehmen');

select tests.login('mallory');
select throws_ok($$ select public.offer_plan_ticket(tests.var('konzert')::uuid) $$, '42501', 'forbidden', 'Außenstehende können nicht anbieten');
select throws_ok($$ select public.take_plan_ticket(tests.var('konzert')::uuid, tests.uid('alice')) $$, '42501', 'forbidden', 'Außenstehende können nicht nehmen');
select throws_ok($$ select public.offer_plan_ticket(gen_random_uuid()) $$, '42501', 'forbidden', 'unbekannter Plan verrät nichts');
select is((select count(*)::int from public.plan_participants where plan_id = tests.var('konzert')::uuid), 0, 'Außenstehende sehen keine Angebote');

-- Noch kein Angebot: nehmen geht nicht.
select tests.login('bob');
select throws_ok($$ select public.take_plan_ticket(tests.var('konzert')::uuid, tests.uid('alice')) $$, 'P0001', 'plan_ticket_gone', 'ohne Angebot nichts zu nehmen');
select throws_ok($$ select public.offer_plan_ticket(tests.var('konzert')::uuid) $$, 'P0001', 'plan_ticket_not_spare', 'wer dabei ist, bietet nichts an');
select tests.login('fiona');
select throws_ok($$ select public.offer_plan_ticket(tests.var('konzert')::uuid) $$, 'P0001', 'plan_ticket_not_spare', 'Absage ohne Ticket: nichts anzubieten');
select tests.login('alice');
select throws_ok($$ select public.offer_plan_ticket(tests.var('ohne_check')::uuid) $$, 'P0001', 'plan_tickets_off', 'ohne Ticket-Check kein Angebot');
select throws_ok($$ select public.offer_plan_ticket(tests.var('gestartet')::uuid) $$, 'P0001', 'plan_plus_ones_started', 'nach Beginn kein Angebot');
select throws_ok($$ select public.offer_plan_ticket(tests.var('abgesagt')::uuid) $$, 'P0001', 'plan_locked', 'abgesagter Plan: kein Angebot');
select throws_ok($$ select public.offer_plan_ticket(tests.var('vorbei')::uuid) $$, 'P0001', 'plan_locked', 'abgeschlossener Plan: kein Angebot');
select tests.logout();
select is((select count(*)::int from public.notifications), 0, 'keine Benachrichtigung nach Angriffen und Fehlern');
select is((select count(*)::int from public.plan_participants where ticket_offered_at is not null), 0, 'kein Angebot nach Angriffen und Fehlern');

-- ---- Anbieten ----------------------------------------------------------------------------------
select tests.login('alice');
select is(public.offer_plan_ticket(tests.var('konzert')::uuid), 2, 'Alice bietet an – Bob und Carol (dabei, ohne Ticket) bekommen Bescheid');
select throws_ok($$ select public.offer_plan_ticket(tests.var('konzert')::uuid) $$, 'P0001', 'plan_ticket_already_offered', 'ein laufendes Angebot nicht doppelt');
select ok((select ticket_offered_at is not null from public.plan_participants where plan_id = tests.var('konzert')::uuid and user_id = tests.uid('alice')),
          'die Crew sieht das Angebot an Alices Zeile');
select tests.logout();
select is((select array_agg(n.user_id order by n.user_id) from public.notifications n where n.type = 'plan_reminder'),
          (select array_agg(u order by u) from unnest(array[tests.uid('bob'), tests.uid('carol')]) u),
          'nur Bob und Carol – nicht Dave (hat eins), Erik („vielleicht“), Fiona (abgesagt), Alice selbst');
select is((select bool_and((n.payload ->> 'ticket_offer')::boolean) from public.notifications n where n.type = 'plan_reminder'), true, 'als Angebot gekennzeichnet');
select is((select count(*)::int from public.notifications n where n.type = 'plan_reminder' and (n.payload ? 'ticket' or n.payload ? 'maybe')), 0,
          'keine Verwechslung mit Nachfragen (P45/P53)');
select is((select n.actor_id from public.notifications n where n.type = 'plan_reminder' limit 1), tests.uid('alice'), 'Alice steht als anbietende Person drin');
select is((select n.entity_type || ':' || n.related_entity_id::text from public.notifications n where n.type = 'plan_reminder' limit 1),
          'plan:' || tests.var('konzert'), 'Antippen führt zum Plan');
delete from public.notifications;

-- ---- Nehmen ------------------------------------------------------------------------------------
select tests.login('erik');
select throws_ok($$ select public.take_plan_ticket(tests.var('konzert')::uuid, tests.uid('alice')) $$, 'P0001', 'plan_ticket_not_needed', '„vielleicht“: erst zusagen');
select tests.login('dave');
select throws_ok($$ select public.take_plan_ticket(tests.var('konzert')::uuid, tests.uid('alice')) $$, 'P0001', 'plan_ticket_not_needed', 'wer schon eins hat, nimmt keins');
select tests.login('bob');
select throws_ok($$ select public.take_plan_ticket(tests.var('konzert')::uuid, tests.uid('bob')) $$, 'P0001', 'invalid_input', 'nicht von sich selbst');
select throws_ok($$ select public.take_plan_ticket(tests.var('konzert')::uuid, null) $$, 'P0001', 'invalid_input', 'ohne Person nichts');
select throws_ok($$ select public.take_plan_ticket(tests.var('konzert')::uuid, tests.uid('dave')) $$, 'P0001', 'plan_ticket_gone', 'Dave bietet nichts an');
select throws_ok($$ select public.take_plan_ticket(tests.var('konzert')::uuid, tests.uid('mallory')) $$, 'P0001', 'plan_ticket_gone', 'fremde Person bietet nichts an');
select is(public.take_plan_ticket(tests.var('konzert')::uuid, tests.uid('alice')), true, 'Bob nimmt Alices Ticket');
select tests.login('carol');
select throws_ok($$ select public.take_plan_ticket(tests.var('konzert')::uuid, tests.uid('alice')) $$, 'P0001', 'plan_ticket_gone', 'Carol war zu langsam – das Ticket ist weg');
select tests.logout();
select is((select has_ticket from public.plan_participants where plan_id = tests.var('konzert')::uuid and user_id = tests.uid('bob')), true, 'Bob hat jetzt ein Ticket');
select is((select has_ticket from public.plan_participants where plan_id = tests.var('konzert')::uuid and user_id = tests.uid('alice')), false, 'Alice hat keins mehr');
select is((select ticket_offered_at from public.plan_participants where plan_id = tests.var('konzert')::uuid and user_id = tests.uid('alice')), null, 'das Angebot ist weg');
select is((select n.user_id from public.notifications n where n.type = 'plan_reminder'), tests.uid('alice'), 'nur Alice bekommt Bescheid');
select is((select n.actor_id from public.notifications n where n.type = 'plan_reminder'), tests.uid('bob'), '… dass Bob ihr Ticket nimmt');
select is((select (n.payload ->> 'ticket_taken')::boolean from public.notifications n where n.type = 'plan_reminder'), true, 'als „genommen“ gekennzeichnet');
select is((select attendance_status::text from public.plan_participants where plan_id = tests.var('konzert')::uuid and user_id = tests.uid('bob')), 'going',
          'Bobs Antwort bleibt unverändert');
delete from public.notifications;

-- ---- Angebot verfällt --------------------------------------------------------------------------
-- Alice hat doch wieder ein Ticket und bietet es an; dann sagt sie wieder zu – das Angebot ist weg.
update public.plan_participants set has_ticket = true where plan_id = tests.var('konzert')::uuid and user_id = tests.uid('alice');
select tests.login('alice');
select is(public.offer_plan_ticket(tests.var('konzert')::uuid), 1, 'neues Angebot: Carol bekommt wieder Bescheid');
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'plan_reminder' and user_id = tests.uid('carol')), 1, 'ein neues Angebot gibt wieder Bescheid');
update public.plan_participants set attendance_status = 'going' where plan_id = tests.var('konzert')::uuid and user_id = tests.uid('alice');
select is((select ticket_offered_at from public.plan_participants where plan_id = tests.var('konzert')::uuid and user_id = tests.uid('alice')), null,
          'Zusage nimmt das Angebot zurück');
update public.plan_participants set attendance_status = 'declined' where plan_id = tests.var('konzert')::uuid and user_id = tests.uid('alice');
select tests.login('carol');
select throws_ok($$ select public.take_plan_ticket(tests.var('konzert')::uuid, tests.uid('alice')) $$, 'P0001', 'plan_ticket_gone', 'nach Zusage und neuer Absage gilt das alte Angebot nicht');
select tests.login('alice');
select is(public.offer_plan_ticket(tests.var('konzert')::uuid), 1, 'Alice bietet erneut an');
select is(public.set_my_plan_ticket(tests.var('konzert')::uuid, false), false, 'Alice sagt „noch keins“');
select tests.logout();
select is((select ticket_offered_at from public.plan_participants where plan_id = tests.var('konzert')::uuid and user_id = tests.uid('alice')), null,
          '„noch keins“ nimmt das Angebot zurück');

-- Ehemalige Mitglieder: Fiona bietet an und verlässt die Crew – ihr Angebot gilt nicht mehr.
update public.plan_participants set has_ticket = true where plan_id = tests.var('konzert')::uuid and user_id = tests.uid('fiona');
select tests.login('fiona');
select is(public.offer_plan_ticket(tests.var('konzert')::uuid), 1, 'Fiona bietet an');
select tests.logout();
delete from public.crew_members where crew_id = tests.var('crew')::uuid and user_id = tests.uid('fiona');
select tests.login('carol');
select throws_ok($$ select public.take_plan_ticket(tests.var('konzert')::uuid, tests.uid('fiona')) $$, 'P0001', 'plan_ticket_gone', 'Angebote ehemaliger Mitglieder gelten nicht');
select tests.login('fiona');
select throws_ok($$ select public.offer_plan_ticket(tests.var('konzert')::uuid) $$, '42501', 'forbidden', 'ehemalige Mitglieder bieten nichts an');

-- Nach Beginn, abgesagt, ohne Check: nehmen geht nicht.
select tests.logout();
update public.plan_participants set ticket_offered_at = now() where user_id = tests.uid('alice') and plan_id in
  (tests.var('ohne_check')::uuid, tests.var('gestartet')::uuid, tests.var('abgesagt')::uuid, tests.var('vorbei')::uuid);
select tests.login('bob');
select throws_ok($$ select public.take_plan_ticket(tests.var('ohne_check')::uuid, tests.uid('alice')) $$, 'P0001', 'plan_tickets_off', 'ohne Ticket-Check nichts zu nehmen');
select throws_ok($$ select public.take_plan_ticket(tests.var('gestartet')::uuid, tests.uid('alice')) $$, 'P0001', 'plan_plus_ones_started', 'nach Beginn nichts zu nehmen');
select throws_ok($$ select public.take_plan_ticket(tests.var('abgesagt')::uuid, tests.uid('alice')) $$, 'P0001', 'plan_locked', 'abgesagter Plan: nichts zu nehmen');
select throws_ok($$ select public.take_plan_ticket(tests.var('vorbei')::uuid, tests.uid('alice')) $$, 'P0001', 'plan_locked', 'abgeschlossener Plan: nichts zu nehmen');
select tests.logout();
select is((select count(*)::int from public.plan_participants where user_id = tests.uid('bob') and has_ticket
           and plan_id <> tests.var('konzert')::uuid), 0, 'Bob hat auf den anderen Plänen kein Ticket bekommen');

select * from finish();
rollback;
