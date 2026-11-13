-- P50: „Danach noch wohin?“ – Stationen am Abend. Nur wer den Plan bearbeiten darf, hängt Stationen an oder nimmt
-- sie heraus; die Crew liest, Außenstehende und anon nicht. Uhrzeit nach Beginn und höchstens 18 h danach, höchstens
-- vier Stationen, gesperrt bei abgeschlossenen/abgesagten Plänen, Verschieben nimmt die Uhrzeiten mit.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Carol');
select tests.make_user('Mallory');

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew', '🎳')::text);
select tests.set_var('invite', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Bob tritt bei');
select tests.login('carol');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Carol tritt bei');
select tests.login('mallory');
select tests.set_var('mallory_crew', public.create_crew('Fremde Crew')::text);

-- Bob organisiert; Alice ist Owner; Carol einfaches Mitglied.
select tests.logout();
insert into public.plans (crew_id, created_by, title, starts_at, status) values
  (tests.var('crew')::uuid, tests.uid('bob'), 'Essen und Bar', date_trunc('hour', now()) + interval '3 days', 'confirmed'),
  (tests.var('crew')::uuid, tests.uid('bob'), 'Vorbei', now() - interval '3 days', 'completed'),
  (tests.var('crew')::uuid, tests.uid('bob'), 'Abgesagt', now() + interval '5 days', 'cancelled'),
  (tests.var('mallory_crew')::uuid, tests.uid('mallory'), 'Fremder Abend', now() + interval '2 days', 'confirmed');
select tests.set_var(case title when 'Essen und Bar' then 'plan' when 'Vorbei' then 'done' when 'Abgesagt' then 'off' else 'foreign' end, id::text)
from public.plans where title in ('Essen und Bar', 'Vorbei', 'Abgesagt', 'Fremder Abend');
select tests.set_var('start', (select starts_at::text from public.plans where id = tests.var('plan')::uuid));

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.add_plan_stop(uuid, text, timestamptz, text)', 'execute'), 'anon hängt keine Station an');
select ok(not has_function_privilege('anon', 'public.remove_plan_stop(uuid)', 'execute'), 'anon nimmt keine Station heraus');
select ok(has_function_privilege('authenticated', 'public.add_plan_stop(uuid, text, timestamptz, text)', 'execute'), 'angemeldete Personen dürfen aufrufen (Prüfung in der Funktion)');
select ok(not has_function_privilege('authenticated', 'app_private.plan_for_stops(uuid)', 'execute'), 'Hilfsfunktion ist intern');
select ok(not has_function_privilege('authenticated', 'app_private.plan_stops_follow()', 'execute'), 'Trigger-Funktion ist intern');
select ok(not has_table_privilege('authenticated', 'public.plan_stops', 'insert'), 'Stationen nicht direkt anlegbar');
select ok(not has_table_privilege('authenticated', 'public.plan_stops', 'update'), 'Stationen nicht direkt änderbar');
select ok(not has_table_privilege('authenticated', 'public.plan_stops', 'delete'), 'Stationen nicht direkt löschbar');
select ok(not has_table_privilege('anon', 'public.plan_stops', 'select'), 'anon liest keine Stationen');

select tests.login_anon();
select throws_ok('select * from public.plan_stops', '42501', null, 'anon liest keine Stationen');
select throws_ok($$ select public.add_plan_stop(tests.var('plan')::uuid, 'Bar') $$, '42501', null, 'anon hängt nichts an');

-- ---- Anhängen ----------------------------------------------------------------------------------
select tests.login('bob');
select tests.set_var('bar', public.add_plan_stop(tests.var('plan')::uuid, '  Bar   Raval ', tests.var('start')::timestamptz + interval '3 hours', '  Muskauer Str. 9 ')::text);
select is((select title from public.plan_stops where id = tests.var('bar')::uuid), 'Bar Raval', 'Name wird bereinigt');
select is((select address from public.plan_stops where id = tests.var('bar')::uuid), 'Muskauer Str. 9', 'Adresse wird bereinigt');
select is((select at from public.plan_stops where id = tests.var('bar')::uuid), tests.var('start')::timestamptz + interval '3 hours', 'Uhrzeit gespeichert');
select tests.set_var('club', public.add_plan_stop(tests.var('plan')::uuid, 'Tanzen', null, '')::text);
select ok((select at is null and address is null from public.plan_stops where id = tests.var('club')::uuid), 'ohne Uhrzeit und Adresse geht auch');

select throws_ok($$ select public.add_plan_stop(tests.var('plan')::uuid, ' x ') $$, 'P0001', 'invalid_plan_stop', 'ein Zeichen ist zu kurz');
select throws_ok($$ select public.add_plan_stop(tests.var('plan')::uuid, null) $$, 'P0001', 'invalid_plan_stop', 'ohne Namen geht nicht');
select throws_ok($$ select public.add_plan_stop(tests.var('plan')::uuid, 'Vorher', tests.var('start')::timestamptz) $$, 'P0001', 'plan_stop_time', 'nicht zum Beginn');
select throws_ok($$ select public.add_plan_stop(tests.var('plan')::uuid, 'Vorher', tests.var('start')::timestamptz - interval '1 hour') $$, 'P0001', 'plan_stop_time', 'nicht vor dem Beginn');
select throws_ok($$ select public.add_plan_stop(tests.var('plan')::uuid, 'Morgen', tests.var('start')::timestamptz + interval '18 hours 1 minute') $$, 'P0001', 'plan_stop_time', 'nicht mehr als 18 Stunden danach');
select lives_ok($$ select public.add_plan_stop(tests.var('plan')::uuid, 'Frühstück', tests.var('start')::timestamptz + interval '18 hours') $$, 'genau 18 Stunden danach geht noch');
select tests.set_var('long', public.add_plan_stop(tests.var('plan')::uuid, repeat('a', 80))::text);
select is((select char_length(title) from public.plan_stops where id = tests.var('long')::uuid), 60, 'zu lange Namen werden auf 60 Zeichen gekürzt');
select throws_ok($$ select public.add_plan_stop(tests.var('plan')::uuid, 'Fünfte') $$, 'P0001', 'plan_stop_limit', 'höchstens vier Stationen');

-- Owner/Admin dürfen auch.
select tests.login('alice');
select lives_ok($$ select public.remove_plan_stop(tests.var('long')::uuid) $$, 'Owner nimmt eine Station heraus');
select lives_ok($$ select public.add_plan_stop(tests.var('plan')::uuid, 'Döner danach') $$, 'Owner hängt eine Station an');

-- ---- Lesen und Angriffe ------------------------------------------------------------------------
select tests.login('carol');
select is((select count(*)::int from public.plan_stops), 4, 'Mitglieder sehen alle Stationen');
select throws_ok($$ select public.add_plan_stop(tests.var('plan')::uuid, 'Meine Bar') $$, '42501', null, 'einfaches Mitglied hängt nichts an');
select throws_ok($$ select public.remove_plan_stop(tests.var('bar')::uuid) $$, '42501', null, 'einfaches Mitglied nimmt nichts heraus');

select tests.login('mallory');
select is((select count(*)::int from public.plan_stops), 0, 'Außenstehende sehen keine Stationen');
select throws_ok($$ select public.add_plan_stop(tests.var('plan')::uuid, 'Fremde Bar') $$, '42501', null, 'Außenstehende hängen nichts an');
select throws_ok($$ select public.remove_plan_stop(tests.var('bar')::uuid) $$, '42501', null, 'Außenstehende nehmen nichts heraus');
select throws_ok($$ select public.remove_plan_stop(gen_random_uuid()) $$, '42501', null, 'unbekannte Station: verboten statt Hinweis');
select lives_ok($$ select public.add_plan_stop(tests.var('foreign')::uuid, 'Eigene Bar') $$, 'im eigenen Plan geht es');
select tests.login('bob');
select is((select count(*)::int from public.plan_stops where plan_id = tests.var('foreign')::uuid), 0, 'fremde Stationen bleiben unsichtbar');
select throws_ok($$ select public.add_plan_stop(tests.var('foreign')::uuid, 'Rein da') $$, '42501', null, 'Bob hängt nichts an fremde Pläne');

-- ---- Gesperrt ----------------------------------------------------------------------------------
select throws_ok($$ select public.add_plan_stop(tests.var('done')::uuid, 'Bar') $$, 'P0001', 'plan_locked', 'abgeschlossener Plan: keine Stationen');
select throws_ok($$ select public.add_plan_stop(tests.var('off')::uuid, 'Bar') $$, 'P0001', 'plan_locked', 'abgesagter Plan: keine Stationen');

-- ---- Verschieben -------------------------------------------------------------------------------
select tests.logout();
update public.plans set starts_at = starts_at + interval '1 day 30 minutes' where id = tests.var('plan')::uuid;
select is((select at from public.plan_stops where id = tests.var('bar')::uuid),
          tests.var('start')::timestamptz + interval '1 day 3 hours 30 minutes', 'verschoben: Uhrzeit wandert mit');
select ok((select at is null from public.plan_stops where id = tests.var('club')::uuid), 'ohne Uhrzeit bleibt ohne Uhrzeit');
update public.plans set title = 'Essen, Bar, Tanzen' where id = tests.var('plan')::uuid;
select is((select at from public.plan_stops where id = tests.var('bar')::uuid),
          tests.var('start')::timestamptz + interval '1 day 3 hours 30 minutes', 'andere Änderungen lassen die Uhrzeit stehen');

-- Plan gelöscht: Stationen weg.
delete from public.plans where id = tests.var('plan')::uuid;
select is((select count(*)::int from public.plan_stops where plan_id = tests.var('plan')::uuid), 0, 'mit dem Plan verschwinden die Stationen');

select * from finish();
rollback;
