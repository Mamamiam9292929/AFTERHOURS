-- Runde jede Woche von selbst (Roadmap S7): Rechte, genau eine Runde je Woche, verpasste Wochen,
-- Zeitpunkt, Beenden, Außenstehende.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Carol');
select tests.make_user('Mallory'); -- Außenstehende

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew')::text);
select tests.set_var('token', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob'); select public.accept_crew_invitation(tests.var('token'));
select tests.login('carol'); select public.accept_crew_invitation(tests.var('token'));
select tests.logout();

select tests.set_var('d1', ((now() at time zone 'Europe/Berlin')::date + 3)::text);

-- Woche in Berliner Zeit weiterrechnen (wie die Migration).
create function tests.plus_weeks(p_at timestamptz, p_weeks integer) returns timestamptz
language sql immutable as $$ select ((p_at at time zone 'Europe/Berlin') + make_interval(days => 7 * p_weeks)) at time zone 'Europe/Berlin' $$;

select tests.login('alice');
select tests.set_var('poll', public.create_poll(tests.var('crew')::uuid, 'Freitag, was geht?', now() + interval '3 days',
  jsonb_build_array(
    jsonb_build_object('title', 'Bowling', 'proposed_date', tests.var('d1'), 'proposed_time', '20:00'),
    jsonb_build_object('title', 'Kino')))::text);
select public.set_poll_guests(tests.var('poll')::uuid, true);
select public.set_poll_auto_decide(tests.var('poll')::uuid, true);
select tests.logout();

-- ---- Rechte und Angriffe ----------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.set_poll_repeat(uuid, boolean)', 'execute'), 'anon darf den Schalter nicht');
select ok(not has_function_privilege('anon', 'public.roll_poll_series()', 'execute'), 'anon stößt keine Runde an');
select ok(not has_function_privilege('authenticated', 'app_private.roll_poll_series(uuid)', 'execute'), 'interne Funktion nicht aufrufbar');
select ok(not has_function_privilege('authenticated', 'app_private.roll_due_poll_series()', 'execute'), 'pg_cron-Funktion nicht für Angemeldete');
select ok(has_function_privilege('service_role', 'app_private.roll_due_poll_series()', 'execute'), 'pg_cron-Funktion für service_role');
select ok(not has_table_privilege('anon', 'public.poll_series', 'select'), 'anon liest keine Serien');
select ok(not has_table_privilege('authenticated', 'public.poll_series', 'insert'), 'Serien sind nicht direkt schreibbar');

select tests.login_anon();
select throws_ok(format($$ select public.set_poll_repeat(%L, true) $$, tests.var('poll')), '42501', null, 'anon scheitert');
select tests.login('mallory');
select throws_ok(format($$ select public.set_poll_repeat(%L, true) $$, tests.var('poll')), '42501', 'forbidden', 'Außenstehende scheitern');
select throws_ok(format($$ select public.set_poll_repeat(%L, true) $$, gen_random_uuid()), '42501', 'forbidden', 'unbekannte Abstimmung sieht aus wie eine fremde');
select tests.login('bob');
select throws_ok(format($$ select public.set_poll_repeat(%L, true) $$, tests.var('poll')), '42501', 'forbidden', 'einfache Mitglieder schalten fremde Abstimmungen nicht um');
select throws_ok(format($$ update public.polls set series_id = gen_random_uuid() where id = %L $$, tests.var('poll')), '42501', null, 'series_id ist nicht direkt schreibbar');
select tests.logout();
select is((select count(*)::int from public.poll_series), 0, 'Angriffe haben nichts angelegt');

-- Termin-Abstimmungen und Stichwahlen lassen sich nicht wiederholen.
select tests.login('alice');
select tests.set_var('when', public.create_date_poll(tests.var('crew')::uuid, 'Wann könnt ihr?', now() + interval '1 day',
  jsonb_build_array(jsonb_build_object('date', tests.var('d1')), jsonb_build_object('date', ((tests.var('d1'))::date + 1)::text)))::text);
select throws_ok(format($$ select public.set_poll_repeat(%L, true) $$, tests.var('when')), 'P0001', 'repeat_unsupported', 'Termin-Abstimmung: nicht wiederholbar');
select tests.logout();
insert into public.polls (crew_id, created_by, parent_poll_id, title, ends_at, series_id)
values (tests.var('crew')::uuid, tests.uid('alice'), tests.var('poll')::uuid, 'Stichwahl: Test', now() + interval '1 day', null)
returning tests.set_var('runoff', id::text);
select tests.login('alice');
select throws_ok(format($$ select public.set_poll_repeat(%L, true) $$, tests.var('runoff')), 'P0001', 'repeat_unsupported', 'Stichwahl: nicht wiederholbar');
select tests.logout();

-- ---- Einschalten ------------------------------------------------------------------------------
select tests.login('alice');
select tests.set_var('state', public.set_poll_repeat(tests.var('poll')::uuid, true)::text);
select is((tests.var('state')::jsonb ->> 'active')::boolean, true, 'Serie ist aktiv');
select is((tests.var('state')::jsonb ->> 'next_ends_at')::timestamptz, tests.plus_weeks(now() + interval '3 days', 1), 'nächste Runde endet eine Woche später');
select is((tests.var('state')::jsonb ->> 'next_opens_at')::timestamptz, tests.plus_weeks(now() + interval '3 days', 1) - interval '3 days',
  'und öffnet so lange vorher, wie diese Runde läuft (3 Tage)');
select is(public.roll_poll_series(), 0, 'solange die Runde läuft, startet keine neue');
select tests.login('bob');
select is((select count(*)::int from public.poll_series where id = (select series_id from public.polls where id = tests.var('poll')::uuid)), 1, 'Mitglieder sehen die Serie');
select tests.login('mallory');
select is((select count(*)::int from public.poll_series), 0, 'Außenstehende sehen keine Serie');
select tests.logout();

-- ---- Runde vorbei, nächste fällig → genau eine neue Runde --------------------------------------
update public.polls set ends_at = now() - interval '5 days', created_at = now() - interval '8 days', status = 'closed', closed_at = now() - interval '5 days'
where id = tests.var('poll')::uuid;
select tests.set_var('series', (select series_id::text from public.polls where id = tests.var('poll')::uuid));
select tests.login('mallory');
select is(public.roll_poll_series(), 0, 'Außenstehende stoßen nichts an');
select tests.login('bob');
select is(public.roll_poll_series(), 1, 'ein einfaches Mitglied stößt die fällige Runde an');
select is(public.roll_poll_series(), 0, 'zweiter Aufruf: keine zweite Runde');
select tests.logout();
select is((select count(*)::int from public.polls where series_id = tests.var('series')::uuid), 2, 'genau eine neue Runde');
select tests.set_var('next', (select id::text from public.polls where series_id = tests.var('series')::uuid and id <> tests.var('poll')::uuid));
select is((select title || ' | ' || status::text || ' | ' || created_by::text || ' | ' || guests_allowed::text || ' | ' || auto_decide::text
           from public.polls where id = tests.var('next')::uuid),
  'Freitag, was geht? | open | ' || tests.uid('alice')::text || ' | true | true', 'gleiche Frage, offen, im Namen der Ersteller:in, Gäste und Schalter übernommen');
select is((select ends_at from public.polls where id = tests.var('next')::uuid), tests.plus_weeks(now() - interval '5 days', 1), 'Ende eine Woche nach dem letzten');
select is((select string_agg(title || '@' || coalesce(proposed_date::text, '-') || '@' || coalesce(proposed_time::text, '-'), ',' order by position)
           from public.poll_options where poll_id = tests.var('next')::uuid),
  'Bowling@' || (tests.var('d1')::date + 7)::text || '@20:00:00,Kino@-@-', 'gleiche Vorschläge, Termine eine Woche später');
select is((select count(*)::int from public.notifications where related_entity_id = tests.var('next')::uuid and type = 'poll_created' and (payload ->> 'repeat')::boolean),
  3, 'die ganze Crew bekommt Bescheid');
select is((select count(*)::int from public.poll_votes where poll_id = tests.var('next')::uuid), 0, 'niemand hat automatisch abgestimmt');
select tests.login('mallory');
select is((select count(*)::int from public.polls where id = tests.var('next')::uuid), 0, 'Außenstehende sehen die neue Runde nicht');
select tests.logout();

-- ---- Verpasste Wochen werden übersprungen ------------------------------------------------------
update public.polls set ends_at = now() - interval '20 days', created_at = now() - interval '23 days', status = 'closed', closed_at = now() - interval '20 days'
where id = tests.var('next')::uuid;
select is(app_private.roll_due_poll_series(), 1, 'pg_cron startet die fällige Runde');
select is((select count(*)::int from public.polls where series_id = tests.var('series')::uuid and status = 'open'), 1, 'genau eine laufende Runde');
select is((select ends_at from public.polls where series_id = tests.var('series')::uuid and status = 'open'), tests.plus_weeks(now() - interval '20 days', 3),
  'drei Wochen weiter – nie rückwirkend');
select is((select (meta ->> 'weeks')::int from public.audit_log where action = 'poll_series_rolled' order by created_at desc, id desc limit 1), 3, 'Audit nennt die übersprungenen Wochen');
select is((select min(proposed_date)::text from public.poll_options where poll_id = (select id from public.polls where series_id = tests.var('series')::uuid and status = 'open')),
  (tests.var('d1')::date + 7 + 21)::text, 'Termine ebenfalls drei Wochen weiter');

-- ---- Noch nicht fällig ------------------------------------------------------------------------
select tests.set_var('third', (select id::text from public.polls where series_id = tests.var('series')::uuid and status = 'open'));
update public.polls set ends_at = now() - interval '1 hour', created_at = now() - interval '25 hours', status = 'closed', closed_at = now() - interval '1 hour'
where id = tests.var('third')::uuid;
select is(app_private.roll_due_poll_series(), 0, 'vorbei, aber die nächste öffnet erst einen Tag vor ihrem Ende');
select tests.login('alice');
select is((public.set_poll_repeat(tests.var('third')::uuid, true) ->> 'next_opens_at')::timestamptz, tests.plus_weeks(now() - interval '1 hour', 1) - interval '1 day',
  'Runde lief einen Tag – die nächste öffnet einen Tag vor ihrem Ende');
select is((select count(*)::int from public.polls where series_id = tests.var('series')::uuid), 3, 'erneutes Einschalten legt nichts doppelt an');
select tests.login('carol');
select throws_ok(format($$ select public.set_poll_repeat(%L, false) $$, tests.var('third')), '42501', 'forbidden', 'einfache Mitglieder beenden die Serie nicht');

-- ---- Beenden und wieder einschalten -----------------------------------------------------------
select tests.login('alice');
select is((public.set_poll_repeat(tests.var('third')::uuid, false) ->> 'active')::boolean, false, 'Serie beendet');
select tests.logout();
update public.polls set ends_at = now() - interval '6 days 20 hours', created_at = now() - interval '7 days 20 hours' where id = tests.var('third')::uuid;
select is(app_private.roll_due_poll_series(), 0, 'beendete Serie startet keine Runde, auch wenn sie fällig wäre');
select tests.login('alice');
select is((public.set_poll_repeat(tests.var('third')::uuid, true) ->> 'active')::boolean, true, 'wieder eingeschaltet …');
select tests.logout();
select is((select count(*)::int from public.polls where series_id = tests.var('series')::uuid and status = 'open'), 1, '… und die fällige Runde läuft sofort');

-- ---- Grenzen ----------------------------------------------------------------------------------
select is((select series_id from public.polls where id = tests.var('runoff')::uuid), null, 'Stichwahlen gehören zu keiner Serie');
insert into public.poll_series (crew_id, created_by) select tests.var('crew')::uuid, tests.uid('alice') from generate_series(1, 9);
select tests.login('alice');
select tests.set_var('eleventh', public.create_poll(tests.var('crew')::uuid, 'Noch eine Runde?', now() + interval '1 day', '[{"title":"Kino"}]'::jsonb)::text);
select throws_ok(format($$ select public.set_poll_repeat(%L, true) $$, tests.var('eleventh')), 'P0001', 'too_many_series', 'höchstens 10 laufende Serien je Crew');
select is(public.set_poll_repeat(tests.var('eleventh')::uuid, false), null, 'ausschalten ohne Serie: nichts zu tun');
select tests.logout();

select * from finish();
rollback;
