-- P13 Etappe 2b: „Bin gleich da“ – wer seinen Standort beim Plan teilt, sagt an, wann er ungefähr da ist
-- (1–120 Minuten ab jetzt, Uhrzeit vom Server). Nur mit laufender eigener Freigabe; sichtbar wie die
-- Position, weg mit ihr. Außenstehende, anon, Absagende und Personen ohne Freigabe können nichts ansagen.
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

select tests.logout();
insert into public.plans (crew_id, created_by, title, starts_at, ends_at, status) values
  (tests.var('crew')::uuid, tests.uid('alice'), 'Gleich', now() + interval '1 hour', null, 'confirmed'),
  (tests.var('mallory_crew')::uuid, tests.uid('mallory'), 'Fremd', now() + interval '1 hour', null, 'confirmed');
select tests.set_var(lower(title), id::text) from public.plans where title in ('Gleich', 'Fremd');
insert into public.plan_participants (plan_id, user_id, attendance_status)
select tests.var(x.plan)::uuid, tests.uid(x.who), x.status::public.attendance_status
from (values ('gleich', 'alice', 'going'), ('gleich', 'bob', 'maybe'), ('gleich', 'carol', 'declined'),
             ('fremd', 'mallory', 'going')) as x(plan, who, status)
on conflict (plan_id, user_id) do update set attendance_status = excluded.attendance_status;

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.set_plan_live_arrival(uuid, integer)', 'execute'), 'anon darf nichts ansagen');
select ok(has_function_privilege('authenticated', 'public.set_plan_live_arrival(uuid, integer)', 'execute'), 'angemeldete Personen dürfen ansagen');
select ok(not has_column_privilege('authenticated', 'public.plan_live_locations', 'arrival_eta', 'update'), 'Ankunft nicht direkt änderbar');

select tests.login_anon();
select throws_ok(format($$ select public.set_plan_live_arrival(%L, 10) $$, tests.var('gleich')), '42501', null, 'anon kann nichts ansagen');

-- ---- Ohne Freigabe nichts ----------------------------------------------------------------------
select tests.login('alice');
select throws_ok(format($$ select public.set_plan_live_arrival(%L, 10) $$, tests.var('gleich')), 'P0001', 'live_location_not_sharing', 'ohne geteilten Standort keine Ansage');

-- ---- Ansagen -----------------------------------------------------------------------------------
select ok(public.share_plan_live_location(tests.var('gleich')::uuid, 52.52, 13.405) is not null, 'Alice teilt');
select is(public.set_plan_live_arrival(tests.var('gleich')::uuid, 10), now() + interval '10 minutes', 'Alice ist in 10 Minuten da – Uhrzeit vom Server');
select is((select arrival_eta from public.plan_live_locations where plan_id = tests.var('gleich')::uuid and user_id = tests.uid('alice')),
  now() + interval '10 minutes', 'Ansage steht bei der Position');
select throws_ok(format($$ select public.set_plan_live_arrival(%L, 0) $$, tests.var('gleich')), 'P0001', 'invalid_arrival', '0 Minuten wird abgewiesen');
select throws_ok(format($$ select public.set_plan_live_arrival(%L, 121) $$, tests.var('gleich')), 'P0001', 'invalid_arrival', 'mehr als 2 Stunden wird abgewiesen');
select throws_ok(format($$ select public.set_plan_live_arrival(%L, -5) $$, tests.var('gleich')), 'P0001', 'invalid_arrival', 'negative Minuten werden abgewiesen');
select ok(public.share_plan_live_location(tests.var('gleich')::uuid, 52.51, 13.40) is not null, 'Alice aktualisiert die Position');
select is((select arrival_eta from public.plan_live_locations where plan_id = tests.var('gleich')::uuid and user_id = tests.uid('alice')),
  now() + interval '10 minutes', 'neue Position lässt die Ansage stehen');

-- Bob („vielleicht“) teilt und sieht Alice' Ansage.
select tests.login('bob');
select ok(public.share_plan_live_location(tests.var('gleich')::uuid, 52.5235, 13.4115) is not null, 'Bob teilt');
select is((select arrival_eta from public.plan_live_locations where user_id = tests.uid('alice')), now() + interval '10 minutes', 'Bob sieht, wann Alice da ist');
select is(public.set_plan_live_arrival(tests.var('gleich')::uuid, 45), now() + interval '45 minutes', 'Bob sagt 45 Minuten an');

-- Datenexport.
select tests.login('alice');
select is(public.export_my_data() -> 'plan_live_locations' -> 0 ->> 'arrival_eta' is not null, true, 'Datenexport enthält die Ansage');

-- Zurücknehmen.
select is(public.set_plan_live_arrival(tests.var('gleich')::uuid, null), null, 'Alice nimmt die Ansage zurück');
select is((select arrival_eta from public.plan_live_locations where plan_id = tests.var('gleich')::uuid and user_id = tests.uid('alice')), null, 'Ansage ist weg');

-- ---- Wer nicht kommt oder nicht dazugehört -----------------------------------------------------
select tests.login('carol');
select throws_ok(format($$ select public.set_plan_live_arrival(%L, 10) $$, tests.var('gleich')), 'P0001', 'live_location_not_going', 'Carol (nicht dabei) sagt nichts an');
select is((select count(*)::int from public.plan_live_locations), 0, 'Carol sieht keine Ansagen');
select tests.login('mallory');
select throws_ok(format($$ select public.set_plan_live_arrival(%L, 10) $$, tests.var('gleich')), '42501', null, 'Mallory sagt bei einer fremden Crew nichts an');
select throws_ok(format($$ update public.plan_live_locations set arrival_eta = now() where plan_id = %L $$, tests.var('gleich')), '42501', null, 'Mallory schreibt nicht direkt');
select is((select count(*)::int from public.plan_live_locations), 0, 'Mallory sieht keine Ansagen');
select tests.login('bob');
select throws_ok(format($$ update public.plan_live_locations set arrival_eta = now() + interval '1 minute' where user_id = %L $$, tests.uid('alice')),
  '42501', null, 'Bob ändert Alice'' Ansage nicht direkt');

-- ---- Abgelaufen: keine Ansage mehr -------------------------------------------------------------
select tests.logout();
update public.plan_live_locations set started_at = now() - interval '4 hours', expires_at = now() - interval '1 minute'
  where user_id = tests.uid('bob');
select tests.login('bob');
select throws_ok(format($$ select public.set_plan_live_arrival(%L, 10) $$, tests.var('gleich')), 'P0001', 'live_location_not_sharing', 'abgelaufene Freigabe: keine Ansage');

-- ---- Beenden und Absage nehmen die Ansage mit --------------------------------------------------
select tests.login('alice');
select ok(public.set_plan_live_arrival(tests.var('gleich')::uuid, 5) is not null, 'Alice sagt wieder an');
select lives_ok($$ select public.stop_plan_live_location(tests.var('gleich')::uuid) $$, 'Alice hört auf zu teilen');
select ok(public.share_plan_live_location(tests.var('gleich')::uuid, 52.52, 13.405) is not null, 'Alice teilt neu');
select is((select arrival_eta from public.plan_live_locations where user_id = tests.uid('alice')), null, 'neue Freigabe beginnt ohne alte Ansage');
select ok(public.set_plan_live_arrival(tests.var('gleich')::uuid, 5) is not null, 'Alice sagt an');
select lives_ok(format($$ select public.set_attendance(%L, 'declined') $$, tests.var('gleich')), 'Alice sagt ab');
select tests.logout();
select is((select count(*)::int from public.plan_live_locations where user_id = tests.uid('alice')), 0, 'Absage löscht Position und Ansage');

-- ---- Rate Limit --------------------------------------------------------------------------------
select tests.login('bob');
select ok(public.share_plan_live_location(tests.var('gleich')::uuid, 52.5236, 13.4116) is not null, 'Bob teilt neu');
-- Bisher zählt eine Ansage (45 Minuten); abgewiesene Aufrufe zählen nicht (Fehler rollt zurück).
-- `g` im Aufruf, damit Postgres die Funktion je Zeile aufruft statt einmal zwischenzuspeichern.
select is((select count(*)::int from generate_series(1, 29) g cross join lateral public.set_plan_live_arrival(tests.var('gleich')::uuid, 10 + g * 0) e), 29, 'bis zur Grenze geht es');
select throws_ok(format($$ select public.set_plan_live_arrival(%L, 10) $$, tests.var('gleich')), 'P0001', 'rate_limited', 'höchstens 30 Ansagen je Stunde');

select * from finish();
rollback;
