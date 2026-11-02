-- P13 Etappe 1: Live-Standort nur während eines Plans – nur auf Tipp, nur im Fenster (2 h vor Beginn bis
-- Ende bzw. 4 h nach Beginn), höchstens 3 Stunden, gerundet, ohne Verlauf; sehen dürfen nur Mitglieder,
-- die selbst kommen. Außenstehende, anon, Absagende und ehemalige Mitglieder sehen und teilen nichts;
-- beim Beenden, Ablauf, Absage, Verschieben, geänderter Antwort und Austritt ist die Position weg.
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

-- Pläne direkt anlegen, damit die Zeiten relativ zu jetzt frei wählbar sind.
select tests.logout();
insert into public.plans (crew_id, created_by, title, starts_at, ends_at, status) values
  (tests.var('crew')::uuid, tests.uid('alice'), 'Gleich', now() + interval '1 hour', null, 'confirmed'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Spaeter', now() + interval '5 hours', null, 'confirmed'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Kurz', now() - interval '1 hour', now() + interval '30 minutes', 'proposed'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Vorbei', now() - interval '5 hours', null, 'confirmed'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Abgesagt', now() + interval '1 hour', null, 'cancelled'),
  (tests.var('mallory_crew')::uuid, tests.uid('mallory'), 'Fremd', now() + interval '1 hour', null, 'confirmed');
select tests.set_var(lower(title), id::text) from public.plans
  where title in ('Gleich', 'Spaeter', 'Kurz', 'Vorbei', 'Abgesagt', 'Fremd');
-- Gleich: Alice dabei, Bob vielleicht, Carol nicht dabei, Dave ohne Antwort.
insert into public.plan_participants (plan_id, user_id, attendance_status)
select tests.var(x.plan)::uuid, tests.uid(x.who), x.status::public.attendance_status
from (values ('gleich', 'alice', 'going'), ('gleich', 'bob', 'maybe'), ('gleich', 'carol', 'declined'),
             ('spaeter', 'alice', 'going'), ('kurz', 'alice', 'going'), ('vorbei', 'alice', 'going'),
             ('abgesagt', 'alice', 'going'), ('fremd', 'mallory', 'going')) as x(plan, who, status)
on conflict (plan_id, user_id) do update set attendance_status = excluded.attendance_status;

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.share_plan_live_location(uuid, double precision, double precision, double precision)', 'execute'), 'anon darf keinen Standort teilen');
select ok(not has_function_privilege('anon', 'public.stop_plan_live_location(uuid)', 'execute'), 'anon darf nichts beenden');
select ok(has_function_privilege('authenticated', 'public.share_plan_live_location(uuid, double precision, double precision, double precision)', 'execute'), 'angemeldete Personen dürfen teilen');
select ok(not has_function_privilege('authenticated', 'app_private.purge_plan_live_locations()', 'execute'), 'Aufräumen für alle ist gesperrt');
select ok(not has_table_privilege('anon', 'public.plan_live_locations', 'select'), 'anon liest keine Standorte');
select ok(not has_table_privilege('authenticated', 'public.plan_live_locations', 'insert'), 'Standorte nicht direkt einfügbar');
select ok(not has_table_privilege('authenticated', 'public.plan_live_locations', 'update'), 'Standorte nicht direkt änderbar');
select ok(not has_table_privilege('authenticated', 'public.plan_live_locations', 'delete'), 'Standorte nicht direkt löschbar');

select tests.login_anon();
select throws_ok(format($$ select public.share_plan_live_location(%L, 52.52, 13.40) $$, tests.var('gleich')), '42501', null, 'anon kann nicht teilen');

-- ---- Teilen ------------------------------------------------------------------------------------
select tests.login('alice');
select is(public.share_plan_live_location(tests.var('gleich')::uuid, 52.520008, 13.404954, 12.6), now() + interval '3 hours',
  'Alice teilt – höchstens 3 Stunden');
select results_eq(format($$ select latitude, longitude, accuracy_m from public.plan_live_locations where plan_id = %L $$, tests.var('gleich')),
  $$ values (52.52::double precision, 13.405::double precision, 13) $$, 'Position auf 4 Nachkommastellen gerundet, Genauigkeit in Metern');
select is(public.share_plan_live_location(tests.var('kurz')::uuid, 52.5, 13.4), now() + interval '30 minutes', 'nie über das Ende des Plans hinaus');

select tests.login('bob');
select ok(public.share_plan_live_location(tests.var('gleich')::uuid, 52.5235, 13.4115, null) is not null, 'Bob („vielleicht“) teilt ohne Genauigkeit');
select is((select count(*)::int from public.plan_live_locations where plan_id = tests.var('gleich')::uuid), 2, 'Bob sieht beide Standorte');
select tests.login('alice');
select is((select count(*)::int from public.plan_live_locations where plan_id = tests.var('gleich')::uuid), 2, 'Alice sieht beide Standorte');

-- Wer nicht kommt, teilt und sieht nichts.
select tests.login('carol');
select throws_ok(format($$ select public.share_plan_live_location(%L, 52.5, 13.4) $$, tests.var('gleich')), 'P0001', 'live_location_not_going', 'Carol (nicht dabei) kann nicht teilen');
select is((select count(*)::int from public.plan_live_locations), 0, 'Carol sieht keine Standorte');
select tests.login('dave');
select throws_ok(format($$ select public.share_plan_live_location(%L, 52.5, 13.4) $$, tests.var('gleich')), 'P0001', 'live_location_not_going', 'Dave (ohne Antwort) kann nicht teilen');
select is((select count(*)::int from public.plan_live_locations), 0, 'Dave sieht keine Standorte');

-- Angriff von außen.
select tests.login('mallory');
select throws_ok(format($$ select public.share_plan_live_location(%L, 52.5, 13.4) $$, tests.var('gleich')), '42501', null, 'Mallory teilt nicht bei einer fremden Crew');
select is((select count(*)::int from public.plan_live_locations), 0, 'Mallory sieht keine fremden Standorte');
select throws_ok(format($$ insert into public.plan_live_locations (plan_id, user_id, latitude, longitude, expires_at) values (%L, %L, 1, 1, now() + interval '1 hour') $$,
  tests.var('gleich'), tests.uid('mallory')), '42501', null, 'Mallory schreibt nicht direkt in die Tabelle');
select lives_ok($$ select public.stop_plan_live_location(tests.var('gleich')::uuid) $$, 'Beenden fremder Pläne geht ins Leere');
select tests.logout();
select is((select count(*)::int from public.plan_live_locations where plan_id = tests.var('gleich')::uuid), 2, '… und löscht nichts von anderen');

-- Zeitfenster, Status, Eingaben.
select tests.login('alice');
select throws_ok(format($$ select public.share_plan_live_location(%L, 52.5, 13.4) $$, tests.var('spaeter')), 'P0001', 'live_location_outside_window', 'mehr als 2 Stunden vor Beginn: noch nicht');
select throws_ok(format($$ select public.share_plan_live_location(%L, 52.5, 13.4) $$, tests.var('vorbei')), 'P0001', 'live_location_outside_window', '4 Stunden nach Beginn ohne Ende: vorbei');
select throws_ok(format($$ select public.share_plan_live_location(%L, 52.5, 13.4) $$, tests.var('abgesagt')), 'P0001', 'plan_locked', 'abgesagter Plan: nichts teilen');
select throws_ok(format($$ select public.share_plan_live_location(%L, 91, 13.4) $$, tests.var('gleich')), 'P0001', 'invalid_location', 'Breitengrad außerhalb');
select throws_ok(format($$ select public.share_plan_live_location(%L, 52.5, 'NaN') $$, tests.var('gleich')), 'P0001', 'invalid_location', 'NaN wird abgewiesen');
select throws_ok(format($$ select public.share_plan_live_location(%L, null, 13.4) $$, tests.var('gleich')), 'P0001', 'invalid_location', 'ohne Position nichts');
select throws_ok(format($$ update public.plan_live_locations set expires_at = now() + interval '1 day' where plan_id = %L $$, tests.var('gleich')), '42501', null, 'Frist nicht direkt verlängerbar');

-- Aktualisieren ersetzt die Position, verlängert aber nicht.
select tests.logout();
update public.plan_live_locations set expires_at = now() + interval '10 minutes' where user_id = tests.uid('alice') and plan_id = tests.var('gleich')::uuid;
select tests.login('alice');
select is(public.share_plan_live_location(tests.var('gleich')::uuid, 52.51, 13.39), now() + interval '10 minutes', 'Aktualisieren verlängert die Frist nicht');
select results_eq(format($$ select latitude, longitude from public.plan_live_locations where plan_id = %L and user_id = %L $$, tests.var('gleich'), tests.uid('alice')),
  $$ values (52.51::double precision, 13.39::double precision) $$, 'nur die letzte Position bleibt');

-- Datenexport.
select is(jsonb_array_length(public.export_my_data() -> 'plan_live_locations'), 2, 'Datenexport enthält laufende Freigaben');

-- Abgelaufen: unsichtbar, beim nächsten Aufruf gelöscht.
select tests.logout();
update public.plan_live_locations set started_at = now() - interval '4 hours', expires_at = now() - interval '1 minute'
  where user_id = tests.uid('alice') and plan_id = tests.var('gleich')::uuid;
select tests.login('bob');
select is((select count(*)::int from public.plan_live_locations where plan_id = tests.var('gleich')::uuid), 1, 'abgelaufene Freigabe ist nicht mehr zu sehen');
select ok(public.share_plan_live_location(tests.var('gleich')::uuid, 52.5236, 13.4116) is not null, 'Bob aktualisiert');
select tests.logout();
select is((select count(*)::int from public.plan_live_locations where user_id = tests.uid('alice') and plan_id = tests.var('gleich')::uuid), 0, 'abgelaufene Freigabe ist gelöscht');
select tests.login('alice');
select is(public.share_plan_live_location(tests.var('gleich')::uuid, 52.52, 13.405), now() + interval '3 hours', 'nach Ablauf beginnt eine neue Freigabe');

-- Beenden.
select lives_ok($$ select public.stop_plan_live_location(tests.var('gleich')::uuid) $$, 'Alice hört auf zu teilen');
select tests.logout();
select is((select count(*)::int from public.plan_live_locations where user_id = tests.uid('alice') and plan_id = tests.var('gleich')::uuid), 0, 'Position ist sofort weg');

-- Antwort geändert: Bob sagt ab.
select tests.login('bob');
select lives_ok(format($$ select public.set_attendance(%L, 'declined') $$, tests.var('gleich')), 'Bob sagt ab');
select tests.logout();
select is((select count(*)::int from public.plan_live_locations where user_id = tests.uid('bob')), 0, 'Absage löscht Bobs Position');

-- Plan verschoben: alle Positionen weg.
select tests.login('bob');
select lives_ok(format($$ select public.set_attendance(%L, 'going') $$, tests.var('gleich')), 'Bob kommt doch');
select ok(public.share_plan_live_location(tests.var('gleich')::uuid, 52.5, 13.4) is not null, 'Bob teilt wieder');
select tests.login('alice');
select ok(public.share_plan_live_location(tests.var('gleich')::uuid, 52.5, 13.4) is not null, 'Alice teilt wieder');
select tests.logout();
update public.plans set starts_at = starts_at + interval '15 minutes' where id = tests.var('gleich')::uuid;
select is((select count(*)::int from public.plan_live_locations where plan_id = tests.var('gleich')::uuid), 0, 'Verschieben löscht alle Positionen');

-- Absage des Plans.
select tests.login('alice');
select ok(public.share_plan_live_location(tests.var('gleich')::uuid, 52.5, 13.4) is not null, 'Alice teilt beim verschobenen Plan');
select tests.logout();
update public.plans set status = 'cancelled' where id = tests.var('gleich')::uuid;
select is((select count(*)::int from public.plan_live_locations where plan_id = tests.var('gleich')::uuid), 0, 'Absage löscht alle Positionen');

-- Crew verlassen.
update public.plans set status = 'confirmed' where id = tests.var('gleich')::uuid;
select tests.login('bob');
select ok(public.share_plan_live_location(tests.var('gleich')::uuid, 52.5, 13.4) is not null, 'Bob teilt');
select lives_ok(format($$ select public.leave_crew(%L) $$, tests.var('crew')), 'Bob verlässt die Crew');
select tests.logout();
select is((select count(*)::int from public.plan_live_locations where user_id = tests.uid('bob')), 0, 'Austritt löscht Bobs Position');

-- Kontolöschung: Alice' laufende Freigabe (beim kurzen Plan) verschwindet mit dem Profil.
select is((select count(*)::int from public.plan_live_locations where user_id = tests.uid('alice')), 1, 'Alice teilt noch beim kurzen Plan');
select tests.login('alice');
select lives_ok($$ select public.delete_my_account('DELETE') $$, 'Alice löscht ihr Konto');
select tests.logout();
select is((select count(*)::int from public.plan_live_locations where user_id = tests.uid('alice')), 0, 'Kontolöschung löscht die Position');

select * from finish();
rollback;
