-- P14 Etappe 1: Wer bringt was? – nur die Crew sieht und schreibt die Mitbring-Liste, eine Sache bringt
-- genau eine Person mit, freigeben nur durch sie selbst, löschen nur durch Berechtigte, keine Dubletten,
-- abgeschlossene/abgesagte Pläne gesperrt, Austritt gibt Zusagen frei; Außenstehende und anon scheitern.
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

-- Bob organisiert das Grillen; Alice ist Owner der Crew.
select tests.logout();
insert into public.plans (crew_id, created_by, title, starts_at, status) values
  (tests.var('crew')::uuid, tests.uid('bob'), 'Grillen', now() + interval '3 days', 'confirmed'),
  (tests.var('crew')::uuid, tests.uid('bob'), 'Vorbei', now() - interval '3 days', 'completed'),
  (tests.var('crew')::uuid, tests.uid('bob'), 'Abgesagt', now() + interval '5 days', 'cancelled'),
  (tests.var('mallory_crew')::uuid, tests.uid('mallory'), 'Fremder Abend', now() + interval '2 days', 'confirmed');
select tests.set_var(lower(title), id::text) from public.plans where title in ('Grillen', 'Vorbei', 'Abgesagt', 'Fremder Abend');

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.add_plan_item(uuid, text, boolean)', 'execute'), 'anon darf nichts eintragen');
select ok(not has_function_privilege('anon', 'public.claim_plan_item(uuid, boolean)', 'execute'), 'anon darf nichts zusagen');
select ok(not has_function_privilege('anon', 'public.remove_plan_item(uuid)', 'execute'), 'anon darf nichts löschen');
select ok(has_function_privilege('authenticated', 'public.add_plan_item(uuid, text, boolean)', 'execute'), 'angemeldete Personen dürfen eintragen (Prüfung in der Funktion)');
select ok(not has_function_privilege('authenticated', 'app_private.plan_for_items(uuid)', 'execute'), 'Hilfsfunktion ist intern');
select ok(not has_function_privilege('authenticated', 'app_private.release_plan_items_on_leave()', 'execute'), 'Trigger-Funktion ist intern');
select ok(not has_table_privilege('authenticated', 'public.plan_items', 'insert'), 'Liste nicht direkt beschreibbar');
select ok(not has_table_privilege('authenticated', 'public.plan_items', 'update'), 'Liste nicht direkt änderbar');
select ok(not has_table_privilege('authenticated', 'public.plan_items', 'delete'), 'Liste nicht direkt löschbar');

select tests.login_anon();
select throws_ok('select * from public.plan_items', '42501', null, 'anon liest keine Mitbring-Liste');
select throws_ok($$ select public.add_plan_item(tests.var('grillen')::uuid, 'Kohle') $$, '42501', null, 'anon trägt nichts ein');

-- ---- Eintragen ---------------------------------------------------------------------------------
select tests.login('alice');
select tests.set_var('kohle', public.add_plan_item(tests.var('grillen')::uuid, '  Kohle   und  Anzünder ')::text);
select is((select label from public.plan_items where id = tests.var('kohle')::uuid), 'Kohle und Anzünder', 'Eintrag wird bereinigt');
select is((select created_by from public.plan_items where id = tests.var('kohle')::uuid), tests.uid('alice'), 'angelegt von Alice');
select ok((select claimed_by is null from public.plan_items where id = tests.var('kohle')::uuid), 'ohne „Bring ich“ ist er frei');

select tests.login('carol');
select tests.set_var('salat', public.add_plan_item(tests.var('grillen')::uuid, 'Nudelsalat', true)::text);
select is((select claimed_by from public.plan_items where id = tests.var('salat')::uuid), tests.uid('carol'), '„Bring ich selbst mit“: gleich zugesagt');
select ok((select claimed_at is not null from public.plan_items where id = tests.var('salat')::uuid), 'Zeitpunkt der Zusage steht');
select is((select count(*)::int from public.plan_items), 2, 'Mitglieder sehen die ganze Liste');

select throws_ok($$ select public.add_plan_item(tests.var('grillen')::uuid, 'KOHLE und anzünder') $$, 'P0001', 'plan_item_exists', 'dasselbe in anderer Schreibweise gibt es nur einmal');
select throws_ok($$ select public.add_plan_item(tests.var('grillen')::uuid, ' x ') $$, 'P0001', 'invalid_plan_item', 'ein Zeichen ist zu kurz');
select throws_ok($$ select public.add_plan_item(tests.var('grillen')::uuid, null) $$, 'P0001', 'invalid_plan_item', 'leer geht nicht');
select tests.set_var('lang', public.add_plan_item(tests.var('grillen')::uuid, repeat('a', 80))::text);
select is((select char_length(label) from public.plan_items where id = tests.var('lang')::uuid), 60, 'zu lange Einträge werden auf 60 Zeichen gekürzt');

select throws_ok($$ select public.add_plan_item(tests.var('vorbei')::uuid, 'Chips') $$, 'P0001', 'plan_locked', 'abgeschlossener Plan: keine neuen Einträge');
select throws_ok($$ select public.add_plan_item(tests.var('abgesagt')::uuid, 'Chips') $$, 'P0001', 'plan_locked', 'abgesagter Plan: keine neuen Einträge');

-- Grenze: 40 Einträge je Plan.
select tests.logout();
insert into public.plan_items (plan_id, label, created_by)
select tests.var('grillen')::uuid, 'Ding ' || g, tests.uid('dave') from generate_series(1, 37) g;
select tests.login('dave');
select throws_ok($$ select public.add_plan_item(tests.var('grillen')::uuid, 'Noch was') $$, 'P0001', 'plan_item_limit', 'mehr als 40 Einträge gehen nicht');
select tests.logout();
delete from public.plan_items where label like 'Ding %';

-- ---- Zusagen -----------------------------------------------------------------------------------
select tests.login('bob');
select lives_ok($$ select public.claim_plan_item(tests.var('kohle')::uuid, true) $$, 'Bob bringt die Kohle');
select is((select claimed_by from public.plan_items where id = tests.var('kohle')::uuid), tests.uid('bob'), 'Kohle: Bob');
select lives_ok($$ select public.claim_plan_item(tests.var('kohle')::uuid, true) $$, 'nochmal tippen ändert nichts');

select tests.login('dave');
select throws_ok($$ select public.claim_plan_item(tests.var('kohle')::uuid, true) $$, 'P0001', 'plan_item_taken', 'was schon jemand mitbringt, kann niemand übernehmen');
select throws_ok($$ select public.claim_plan_item(tests.var('kohle')::uuid, false) $$, 'P0001', 'plan_item_taken', 'fremde Zusage lässt sich nicht freigeben');
select is((select claimed_by from public.plan_items where id = tests.var('kohle')::uuid), tests.uid('bob'), 'Kohle bleibt bei Bob');
select throws_ok($$ select public.claim_plan_item(tests.var('kohle')::uuid, null) $$, 'P0001', 'invalid_plan_item', 'ohne Angabe passiert nichts');

select tests.login('bob');
select lives_ok($$ select public.claim_plan_item(tests.var('kohle')::uuid, false) $$, 'Bob gibt die Kohle wieder frei');
select ok((select claimed_by is null and claimed_at is null from public.plan_items where id = tests.var('kohle')::uuid), 'Kohle ist wieder frei');
select lives_ok($$ select public.claim_plan_item(tests.var('kohle')::uuid, false) $$, 'freigeben, was frei ist, ändert nichts');

select tests.login('dave');
select lives_ok($$ select public.claim_plan_item(tests.var('kohle')::uuid, true) $$, 'jetzt nimmt Dave die Kohle');

-- ---- Löschen -----------------------------------------------------------------------------------
select tests.login('carol');
select throws_ok($$ select public.remove_plan_item(tests.var('kohle')::uuid) $$, '42501', null, 'Carol löscht nicht, was Alice eingetragen hat');
select lives_ok($$ select public.remove_plan_item(tests.var('lang')::uuid) $$, 'eigenen Eintrag löschen geht');
select tests.login('bob');
select lives_ok($$ select public.remove_plan_item(tests.var('salat')::uuid) $$, 'Organisator Bob räumt die Liste auf');
select tests.login('carol');
select tests.set_var('chips', public.add_plan_item(tests.var('grillen')::uuid, 'Chips')::text);
select tests.login('alice');
select lives_ok($$ select public.remove_plan_item(tests.var('chips')::uuid) $$, 'Owner Alice darf ebenfalls aufräumen');
select is((select array_agg(label order by label) from public.plan_items), array['Kohle und Anzünder'], 'übrig bleibt die Kohle');

-- ---- Außenstehende -----------------------------------------------------------------------------
select tests.login('mallory');
select is((select count(*)::int from public.plan_items), 0, 'Mallory sieht keine fremde Liste');
select throws_ok($$ select public.add_plan_item(tests.var('grillen')::uuid, 'Fake') $$, '42501', null, 'Mallory trägt nichts in fremde Pläne ein');
select throws_ok($$ select public.claim_plan_item(tests.var('kohle')::uuid, false) $$, '42501', null, 'Mallory gibt nichts frei');
select throws_ok($$ select public.claim_plan_item(tests.var('kohle')::uuid, true) $$, '42501', null, 'Mallory sagt nichts zu');
select throws_ok($$ select public.remove_plan_item(tests.var('kohle')::uuid) $$, '42501', null, 'Mallory löscht nichts');
select throws_ok($$ select public.remove_plan_item('00000000-0000-0000-0000-000000000000') $$, '42501', null, 'unbekannte Einträge verraten nichts');
select tests.set_var('mallory_item', public.add_plan_item(tests.var('fremder abend')::uuid, 'Eigenes')::text);
select tests.login('alice');
select throws_ok($$ select public.claim_plan_item(tests.var('mallory_item')::uuid, true) $$, '42501', null, 'umgekehrt genauso: Alice sagt in Mallorys Crew nichts zu');

-- Gesperrte Pläne: vorhandene Einträge bleiben lesbar, ändern geht nicht mehr.
select tests.logout();
insert into public.plan_items (plan_id, label, created_by, claimed_by, claimed_at)
values (tests.var('vorbei')::uuid, 'Grillzange', tests.uid('bob'), tests.uid('bob'), now());
select tests.set_var('zange', (select id::text from public.plan_items where label = 'Grillzange'));
select tests.login('bob');
select throws_ok($$ select public.claim_plan_item(tests.var('zange')::uuid, false) $$, 'P0001', 'plan_locked', 'nach dem Abend lässt sich nichts mehr freigeben');
select throws_ok($$ select public.remove_plan_item(tests.var('zange')::uuid) $$, 'P0001', 'plan_locked', 'nach dem Abend lässt sich nichts mehr löschen');
select is((select count(*)::int from public.plan_items where plan_id = tests.var('vorbei')::uuid), 1, 'die Liste vom Abend bleibt lesbar');

-- ---- Austritt und Kontolöschung ----------------------------------------------------------------
select tests.login('dave');
select lives_ok($$ select public.leave_crew(tests.var('crew')::uuid) $$, 'Dave verlässt die Crew');
select tests.logout();
select ok((select claimed_by is null from public.plan_items where id = tests.var('kohle')::uuid), 'Daves Zusage beim kommenden Grillen wird frei');
select is((select claimed_by from public.plan_items where id = tests.var('zange')::uuid), tests.uid('bob'), 'vergangene Abende bleiben unverändert');
select tests.login('dave');
select is((select count(*)::int from public.plan_items), 0, 'ehemalige Mitglieder sehen die Liste nicht mehr');

select tests.login('alice');
select lives_ok($$ select public.delete_my_account('DELETE') $$, 'Alice löscht ihr Konto');
select tests.logout();
select ok((select created_by is null from public.plan_items where id = tests.var('kohle')::uuid), 'Kontolöschung: der Eintrag bleibt für die Crew, ohne Person');

-- ---- Datenexport -------------------------------------------------------------------------------
select tests.login('bob');
select is(jsonb_array_length(public.export_my_data() -> 'plan_items'), 1, 'Export enthält Bobs Eintrag');
select is(public.export_my_data() -> 'plan_items' -> 0 ->> 'bringing', 'true', 'Export: Bob bringt die Grillzange');
select ok(public.export_my_data() ? 'plan_expenses', 'Export enthält weiter alle bisherigen Bereiche');

select * from finish();
rollback;
