-- P31: „Gut heimgekommen?“ – `set_plan_home` meldet „Bin zuhause“ (nur mit Zusage/Vielleicht, ab Beginn bis 12 h nach
-- dem Ende, nie bei abgesagten Plänen); `plan_home_status` zeigt der Crew, wer schon zuhause ist und wie viele fehlen.
-- Außenstehende und anon sehen nichts, außerhalb des Fensters gibt es keine Namen, alte Meldungen werden aufgeräumt.
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

select tests.logout();
insert into public.plans (crew_id, created_by, title, starts_at, ends_at, status, created_at) values
  (tests.var('crew')::uuid, tests.uid('alice'), 'Heute', now() - interval '2 hours', null, 'confirmed', now() - interval '5 days'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Später', now() + interval '1 hour', null, 'confirmed', now() - interval '5 days'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Alt', now() - interval '2 days', null, 'completed', now() - interval '5 days'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Abgesagt', now() - interval '1 hour', null, 'cancelled', now() - interval '5 days'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Ausflug', now() - interval '3 days', now() + interval '1 hour', 'confirmed', now() - interval '5 days'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Fertig', now() - interval '5 hours', null, 'completed', now() - interval '5 days'),
  (tests.var('mallory_crew')::uuid, tests.uid('mallory'), 'Fremder Abend', now() - interval '2 hours', null, 'confirmed', now() - interval '5 days');
select tests.set_var(lower(title), id::text) from public.plans
  where title in ('Heute', 'Später', 'Alt', 'Abgesagt', 'Ausflug', 'Fertig', 'Fremder Abend');

-- Heute: Alice und Bob dabei, Carol vielleicht, Dave abgesagt. Sonst überall Alice und Bob dabei.
insert into public.plan_participants (plan_id, user_id, attendance_status) values
  (tests.var('heute')::uuid, tests.uid('alice'), 'going'),
  (tests.var('heute')::uuid, tests.uid('bob'), 'going'),
  (tests.var('heute')::uuid, tests.uid('carol'), 'maybe'),
  (tests.var('heute')::uuid, tests.uid('dave'), 'declined'),
  (tests.var('später')::uuid, tests.uid('bob'), 'going'),
  (tests.var('alt')::uuid, tests.uid('alice'), 'going'),
  (tests.var('alt')::uuid, tests.uid('bob'), 'going'),
  (tests.var('abgesagt')::uuid, tests.uid('bob'), 'going'),
  (tests.var('ausflug')::uuid, tests.uid('alice'), 'going'),
  (tests.var('fertig')::uuid, tests.uid('alice'), 'going'),
  (tests.var('fremder abend')::uuid, tests.uid('mallory'), 'going');

-- ---- Rechte --------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.set_plan_home(uuid, boolean)', 'execute'), 'anon darf nicht melden');
select ok(not has_function_privilege('anon', 'public.plan_home_status(uuid)', 'execute'), 'anon darf nichts lesen');
select ok(has_function_privilege('authenticated', 'public.set_plan_home(uuid, boolean)', 'execute'), 'angemeldete Personen dürfen melden');
select ok(has_function_privilege('authenticated', 'public.plan_home_status(uuid)', 'execute'), 'angemeldete Personen dürfen den Stand abfragen');
select ok(not has_table_privilege('authenticated', 'public.plan_home_checkins', 'select'), 'die Tabelle ist nicht direkt lesbar');
select ok(not has_table_privilege('authenticated', 'public.plan_home_checkins', 'insert'), 'und nicht direkt beschreibbar');
select ok(not has_function_privilege('authenticated', 'app_private.plan_home_open(public.plans)', 'execute'), 'interne Regel bleibt intern');

select tests.login_anon();
select throws_ok($$ select public.set_plan_home(tests.var('heute')::uuid, true) $$, '42501', null, 'ohne Konto: verboten');
select throws_ok($$ select public.plan_home_status(tests.var('heute')::uuid) $$, '42501', null, 'ohne Konto: kein Stand');

-- ---- Angriff von außen -----------------------------------------------------------------------------
select tests.login('mallory');
select throws_ok($$ select public.set_plan_home(tests.var('heute')::uuid, true) $$, '42501', null, 'Außenstehende melden nicht');
select throws_ok($$ select public.plan_home_status(tests.var('heute')::uuid) $$, '42501', null, 'Außenstehende sehen nicht, wer zuhause ist');
select throws_ok($$ select public.plan_home_status(gen_random_uuid()) $$, '42501', null, 'unbekannter Plan verrät nichts');
select lives_ok($$ select public.set_plan_home(tests.var('fremder abend')::uuid, true) $$, 'Mallory meldet sich beim eigenen Abend');

-- ---- Regeln --------------------------------------------------------------------------------------
select tests.login('dave');
select throws_ok($$ select public.set_plan_home(tests.var('heute')::uuid, true) $$, 'P0001', 'plan_home_not_going', 'wer abgesagt hat, meldet nichts');
select is(public.plan_home_status(tests.var('heute')::uuid) ->> 'can_answer', 'false', 'Dave sieht den Stand, kann aber nicht melden');
select is(public.plan_home_status(tests.var('heute')::uuid) ->> 'open', 'true', 'das Fenster ist offen');

select tests.login('bob');
select throws_ok($$ select public.set_plan_home(tests.var('heute')::uuid, null) $$, 'P0001', 'invalid_input', 'ohne Angabe: ungültig');
select throws_ok($$ select public.set_plan_home(tests.var('später')::uuid, true) $$, 'P0001', 'plan_home_closed', 'vor Beginn: noch nicht');
select throws_ok($$ select public.set_plan_home(tests.var('alt')::uuid, true) $$, 'P0001', 'plan_home_closed', 'zwei Tage danach: nicht mehr');
select throws_ok($$ select public.set_plan_home(tests.var('abgesagt')::uuid, true) $$, 'P0001', 'plan_home_closed', 'abgesagt: nie');

select lives_ok($$ select public.set_plan_home(tests.var('heute')::uuid, true) $$, 'Bob ist zuhause');
select tests.set_var('bob_at', public.plan_home_status(tests.var('heute')::uuid) ->> 'mine');
select isnt(tests.var('bob_at'), null, 'Bob sieht seine Meldung');
select lives_ok($$ select public.set_plan_home(tests.var('heute')::uuid, true) $$, 'doppelt tippen schadet nicht');
select is(public.plan_home_status(tests.var('heute')::uuid) ->> 'mine', tests.var('bob_at'), 'die erste Uhrzeit bleibt');

select tests.login('carol');
select lives_ok($$ select public.set_plan_home(tests.var('heute')::uuid, true) $$, 'mit „Vielleicht“ darf man sich auch melden');

-- Mallory steht (über einen Fehler) im Plan der fremden Crew – darf in der Liste nie auftauchen.
select tests.logout();
insert into public.plan_home_checkins (plan_id, user_id) values (tests.var('heute')::uuid, tests.uid('mallory'));

select tests.login('alice');
select is(public.plan_home_status(tests.var('heute')::uuid) ->> 'can_answer', 'true', 'Alice kann melden');
select is(public.plan_home_status(tests.var('heute')::uuid) -> 'mine', 'null'::jsonb, 'Alice hat sich noch nicht gemeldet');
select is((select array_agg(x ->> 'user_id' order by x ->> 'user_id') from jsonb_array_elements(public.plan_home_status(tests.var('heute')::uuid) -> 'home') x),
          (select array_agg(id::text order by id::text) from (values (tests.uid('bob')), (tests.uid('carol'))) v(id)),
          'die Crew sieht Bob und Carol – niemand von außerhalb der Crew');
select is((public.plan_home_status(tests.var('heute')::uuid) ->> 'missing')::int, 1, 'noch eine Person ohne Meldung (Alice), Dave zählt nicht');
select is((select count(*)::int from jsonb_object_keys(public.plan_home_status(tests.var('heute')::uuid) -> 'home' -> 0)), 2,
          'je Meldung nur Person und Uhrzeit');

select lives_ok($$ select public.set_plan_home(tests.var('ausflug')::uuid, true) $$, 'mehrtägiger Plan: offen bis nach dem Ende');
select lives_ok($$ select public.set_plan_home(tests.var('fertig')::uuid, true) $$, 'schon abgeschlossen, aber noch in der Nacht: offen');

-- Zurücknehmen.
select tests.login('bob');
select lives_ok($$ select public.set_plan_home(tests.var('heute')::uuid, false) $$, 'Bob nimmt zurück');
select is(public.plan_home_status(tests.var('heute')::uuid) -> 'mine', 'null'::jsonb, 'Meldung ist weg');
select is((public.plan_home_status(tests.var('heute')::uuid) ->> 'missing')::int, 2, 'jetzt fehlen Alice und Bob');

-- ---- Außerhalb des Fensters: keine Namen, und die nächste Meldung räumt auf ------------------------
select tests.logout();
insert into public.plan_home_checkins (plan_id, user_id, arrived_at) values
  (tests.var('alt')::uuid, tests.uid('bob'), now() - interval '2 days'),
  (tests.var('abgesagt')::uuid, tests.uid('bob'), now() - interval '30 minutes');
select tests.login('alice');
select is(public.plan_home_status(tests.var('alt')::uuid),
          '{"open": false, "can_answer": false, "mine": null, "home": [], "missing": 0}'::jsonb, 'vorbei: nichts mehr zu sehen');
select is(public.plan_home_status(tests.var('abgesagt')::uuid) -> 'home', '[]'::jsonb, 'abgesagt: nichts zu sehen');
select tests.login('carol');
select lives_ok($$ select public.set_plan_home(tests.var('heute')::uuid, true) $$, 'Carol meldet sich noch einmal');
select tests.logout();
select is((select count(*)::int from public.plan_home_checkins where plan_id in (tests.var('alt')::uuid, tests.var('abgesagt')::uuid)), 0,
          'Meldungen außerhalb ihres Fensters sind aufgeräumt');
select is((select count(*)::int from public.plan_home_checkins where plan_id = tests.var('heute')::uuid and user_id = tests.uid('carol')), 1,
          'Carols Meldung bleibt');

-- ---- Rate Limit, Export, Austritt, Kontolöschung ---------------------------------------------------
insert into public.rate_limit_hits (user_id, action) select tests.uid('alice'), 'plan_home' from generate_series(1, 30);
select tests.login('alice');
select throws_ok($$ select public.set_plan_home(tests.var('heute')::uuid, true) $$, 'P0001', 'rate_limited', 'zu viele Meldungen werden gebremst');

select tests.login('carol');
select is(jsonb_array_length(public.export_my_data() -> 'plan_home_checkins'), 1, 'der Export enthält die eigene Meldung');
select is(public.export_my_data() -> 'plan_home_checkins' -> 0 ->> 'plan_id', tests.var('heute'), 'zum richtigen Plan');

select public.leave_crew(tests.var('crew')::uuid);
select throws_ok($$ select public.set_plan_home(tests.var('heute')::uuid, false) $$, '42501', null, 'nach dem Austritt nichts mehr melden');
select throws_ok($$ select public.plan_home_status(tests.var('heute')::uuid) $$, '42501', null, 'und nichts mehr sehen');
select tests.login('alice');
select is(jsonb_array_length(public.plan_home_status(tests.var('heute')::uuid) -> 'home'), 0, 'wer ausgetreten ist, steht nicht mehr in der Liste');

select tests.login('bob');
select lives_ok($$ select public.set_plan_home(tests.var('heute')::uuid, true) $$, 'Bob meldet sich wieder');
select lives_ok($$ select public.delete_my_account('DELETE') $$, 'Bob löscht sein Konto');
select tests.logout();
select is((select count(*)::int from public.plan_home_checkins where user_id = tests.uid('bob')), 0, 'Kontolöschung löscht die eigenen Meldungen');

select * from finish();
rollback;
