-- P43: „Seid ihr schon da?“ – `set_plan_arrival` sagt „Bin da“ oder „Bin in … Min. da“ (nur mit Zusage/Vielleicht,
-- ab 1 h vor bis 3 h nach Beginn, höchstens bis zum Ende, nie bei abgesagten Plänen); `plan_arrival_status` zeigt der
-- Crew, wer da ist und wer gegen wann kommt. Außenstehende und anon sehen nichts, verschobene Pläne zeigen keine
-- alten Ansagen, alte Ansagen werden aufgeräumt.
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
  (tests.var('crew')::uuid, tests.uid('alice'), 'Gleich', now() + interval '30 minutes', null, 'confirmed', now() - interval '5 days'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Morgen', now() + interval '1 day', null, 'confirmed', now() - interval '5 days'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Lange her', now() - interval '4 hours', null, 'confirmed', now() - interval '5 days'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Kurz', now() - interval '1 hour', now() - interval '10 minutes', 'confirmed', now() - interval '5 days'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Abgesagt', now() + interval '10 minutes', null, 'cancelled', now() - interval '5 days'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Läuft', now() - interval '2 hours', null, 'confirmed', now() - interval '5 days'),
  (tests.var('mallory_crew')::uuid, tests.uid('mallory'), 'Fremder Abend', now() + interval '30 minutes', null, 'confirmed', now() - interval '5 days');
select tests.set_var(lower(title), id::text) from public.plans
  where title in ('Gleich', 'Morgen', 'Lange her', 'Kurz', 'Abgesagt', 'Läuft', 'Fremder Abend');

-- Gleich: Alice und Bob dabei, Carol vielleicht, Dave abgesagt. Sonst überall Bob dabei.
insert into public.plan_participants (plan_id, user_id, attendance_status) values
  (tests.var('gleich')::uuid, tests.uid('alice'), 'going'),
  (tests.var('gleich')::uuid, tests.uid('bob'), 'going'),
  (tests.var('gleich')::uuid, tests.uid('carol'), 'maybe'),
  (tests.var('gleich')::uuid, tests.uid('dave'), 'declined'),
  (tests.var('morgen')::uuid, tests.uid('bob'), 'going'),
  (tests.var('lange her')::uuid, tests.uid('bob'), 'going'),
  (tests.var('kurz')::uuid, tests.uid('bob'), 'going'),
  (tests.var('abgesagt')::uuid, tests.uid('bob'), 'going'),
  (tests.var('läuft')::uuid, tests.uid('bob'), 'going'),
  (tests.var('fremder abend')::uuid, tests.uid('mallory'), 'going');

-- ---- Rechte --------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.set_plan_arrival(uuid, text, integer)', 'execute'), 'anon darf nichts ansagen');
select ok(not has_function_privilege('anon', 'public.plan_arrival_status(uuid)', 'execute'), 'anon darf nichts lesen');
select ok(has_function_privilege('authenticated', 'public.set_plan_arrival(uuid, text, integer)', 'execute'), 'angemeldete Personen dürfen ansagen');
select ok(has_function_privilege('authenticated', 'public.plan_arrival_status(uuid)', 'execute'), 'angemeldete Personen dürfen den Stand abfragen');
select ok(not has_table_privilege('authenticated', 'public.plan_arrivals', 'select'), 'die Tabelle ist nicht direkt lesbar');
select ok(not has_table_privilege('authenticated', 'public.plan_arrivals', 'insert'), 'und nicht direkt beschreibbar');
select ok(not has_function_privilege('authenticated', 'app_private.plan_arrival_open(public.plans)', 'execute'), 'interne Regel bleibt intern');

select tests.login_anon();
select throws_ok($$ select public.set_plan_arrival(tests.var('gleich')::uuid, 'here') $$, '42501', null, 'ohne Konto: verboten');
select throws_ok($$ select public.plan_arrival_status(tests.var('gleich')::uuid) $$, '42501', null, 'ohne Konto: kein Stand');

-- ---- Angriff von außen -----------------------------------------------------------------------------
select tests.login('mallory');
select throws_ok($$ select public.set_plan_arrival(tests.var('gleich')::uuid, 'here') $$, '42501', null, 'Außenstehende sagen nichts an');
select throws_ok($$ select public.plan_arrival_status(tests.var('gleich')::uuid) $$, '42501', null, 'Außenstehende sehen nicht, wer kommt');
select throws_ok($$ select public.plan_arrival_status(gen_random_uuid()) $$, '42501', null, 'unbekannter Plan verrät nichts');
select lives_ok($$ select public.set_plan_arrival(tests.var('fremder abend')::uuid, 'here') $$, 'Mallory sagt beim eigenen Abend an');

-- ---- Regeln --------------------------------------------------------------------------------------
select tests.login('dave');
select throws_ok($$ select public.set_plan_arrival(tests.var('gleich')::uuid, 'here') $$, 'P0001', 'plan_arrival_not_going', 'wer abgesagt hat, sagt nichts an');
select is(public.plan_arrival_status(tests.var('gleich')::uuid) ->> 'can_answer', 'false', 'Dave sieht den Stand, kann aber nichts ansagen');
select is(public.plan_arrival_status(tests.var('gleich')::uuid) ->> 'open', 'true', 'eine halbe Stunde vorher ist offen');

select tests.login('bob');
select throws_ok($$ select public.set_plan_arrival(tests.var('gleich')::uuid, null) $$, 'P0001', 'invalid_input', 'ohne Angabe: ungültig');
select throws_ok($$ select public.set_plan_arrival(tests.var('gleich')::uuid, 'gone') $$, 'P0001', 'invalid_input', 'unbekannte Ansage: ungültig');
select throws_ok($$ select public.set_plan_arrival(tests.var('gleich')::uuid, 'late') $$, 'P0001', 'invalid_arrival', 'später ohne Minuten: ungültig');
select throws_ok($$ select public.set_plan_arrival(tests.var('gleich')::uuid, 'late', 0) $$, 'P0001', 'invalid_arrival', '0 Minuten: ungültig');
select throws_ok($$ select public.set_plan_arrival(tests.var('gleich')::uuid, 'late', 121) $$, 'P0001', 'invalid_arrival', 'über zwei Stunden: ungültig');
select throws_ok($$ select public.set_plan_arrival(tests.var('morgen')::uuid, 'here') $$, 'P0001', 'plan_arrival_closed', 'am Vortag: noch nicht');
select throws_ok($$ select public.set_plan_arrival(tests.var('lange her')::uuid, 'here') $$, 'P0001', 'plan_arrival_closed', 'vier Stunden nach Beginn: nicht mehr');
select throws_ok($$ select public.set_plan_arrival(tests.var('kurz')::uuid, 'here') $$, 'P0001', 'plan_arrival_closed', 'nach dem Ende: nicht mehr');
select throws_ok($$ select public.set_plan_arrival(tests.var('abgesagt')::uuid, 'here') $$, 'P0001', 'plan_arrival_closed', 'abgesagt: nie');
select lives_ok($$ select public.set_plan_arrival(tests.var('läuft')::uuid, 'late', 20) $$, 'zwei Stunden nach Beginn: noch offen');

select ok(public.set_plan_arrival(tests.var('gleich')::uuid, 'late', 20) between now() + interval '19 minutes' and now() + interval '21 minutes',
          'Bob kommt in 20 Minuten – die Uhrzeit rechnet der Server');
select is(public.plan_arrival_status(tests.var('gleich')::uuid) -> 'mine' ->> 'state', 'late', 'Bob sieht seine Ansage');
select is(public.set_plan_arrival(tests.var('gleich')::uuid, 'here'), null, '„Bin da“ ersetzt „später“');
select is(public.plan_arrival_status(tests.var('gleich')::uuid) -> 'mine' ->> 'eta', null, 'ohne Uhrzeit');

select tests.login('carol');
select lives_ok($$ select public.set_plan_arrival(tests.var('gleich')::uuid, 'late', 45) $$, 'mit „Vielleicht“ darf man auch ansagen');

-- Mallory steht (über einen Fehler) in der Tabelle – darf in der Liste nie auftauchen.
select tests.logout();
insert into public.plan_arrivals (plan_id, user_id, state) values (tests.var('gleich')::uuid, tests.uid('mallory'), 'here');

select tests.login('alice');
select is(public.plan_arrival_status(tests.var('gleich')::uuid) ->> 'can_answer', 'true', 'Alice kann ansagen');
select is(public.plan_arrival_status(tests.var('gleich')::uuid) -> 'mine', 'null'::jsonb, 'Alice hat noch nichts gesagt');
select is((select array_agg(x ->> 'user_id' || ':' || (x ->> 'state') order by x ->> 'user_id') from jsonb_array_elements(public.plan_arrival_status(tests.var('gleich')::uuid) -> 'people') x),
          (select array_agg(v order by v) from (values (tests.uid('bob') || ':here'), (tests.uid('carol') || ':late')) t(v)),
          'die Crew sieht Bob (da) und Carol (später) – niemand von außerhalb der Crew');
select is((public.plan_arrival_status(tests.var('gleich')::uuid) ->> 'missing')::int, 1, 'eine Person ohne Ansage (Alice), Dave zählt nicht');
select is((select count(*)::int from jsonb_object_keys(public.plan_arrival_status(tests.var('gleich')::uuid) -> 'people' -> 0)), 5,
          'je Ansage nur Person, Stand, Uhrzeit, Hinweis „Wo sitzt ihr?“ (P44) und Zeitpunkt');

-- Wer umschwenkt auf „Kann nicht“, verschwindet aus der Liste.
select tests.login('carol');
select lives_ok($$ select public.set_attendance(tests.var('gleich')::uuid, 'declined') $$, 'Carol sagt doch ab');
select tests.login('alice');
select is(jsonb_array_length(public.plan_arrival_status(tests.var('gleich')::uuid) -> 'people'), 1, 'Carols Ansage gilt nicht mehr');

-- Zurücknehmen.
select tests.login('bob');
select lives_ok($$ select public.set_plan_arrival(tests.var('gleich')::uuid, 'none') $$, 'Bob nimmt zurück');
select is(public.plan_arrival_status(tests.var('gleich')::uuid) -> 'mine', 'null'::jsonb, 'Ansage ist weg');
select is((public.plan_arrival_status(tests.var('gleich')::uuid) ->> 'missing')::int, 2, 'jetzt fehlen Alice und Bob');

-- ---- Verschoben: alte Ansagen gelten nicht; außerhalb des Fensters nichts; Aufräumen ------------------
select lives_ok($$ select public.set_plan_arrival(tests.var('gleich')::uuid, 'late', 10) $$, 'Bob sagt wieder an');
select tests.logout();
update public.plan_arrivals set updated_at = now() - interval '2 hours' where plan_id = tests.var('gleich')::uuid and user_id = tests.uid('bob');
insert into public.plan_arrivals (plan_id, user_id, state, updated_at) values
  (tests.var('lange her')::uuid, tests.uid('bob'), 'here', now() - interval '4 hours'),
  (tests.var('abgesagt')::uuid, tests.uid('bob'), 'here', now() - interval '5 minutes');
select tests.login('alice');
select is(jsonb_array_length(public.plan_arrival_status(tests.var('gleich')::uuid) -> 'people'), 0,
          'Ansage von vor der Verschiebung (vor dem Fenster) zählt nicht');
select is(public.plan_arrival_status(tests.var('lange her')::uuid),
          '{"open": false, "can_answer": false, "mine": null, "people": [], "missing": 0}'::jsonb, 'vorbei: nichts mehr zu sehen');
select is(public.plan_arrival_status(tests.var('abgesagt')::uuid) -> 'people', '[]'::jsonb, 'abgesagt: nichts zu sehen');
select lives_ok($$ select public.set_plan_arrival(tests.var('gleich')::uuid, 'here') $$, 'Alice ist da');
select tests.logout();
select is((select count(*)::int from public.plan_arrivals where plan_id in (tests.var('lange her')::uuid, tests.var('abgesagt')::uuid)), 0,
          'Ansagen außerhalb ihres Fensters sind aufgeräumt');
select is((select count(*)::int from public.plan_arrivals where plan_id = tests.var('gleich')::uuid and user_id = tests.uid('bob')), 0,
          'Bobs Ansage von vor der Verschiebung ist aufgeräumt');
select is((select count(*)::int from public.plan_arrivals where plan_id = tests.var('gleich')::uuid and user_id = tests.uid('alice')), 1,
          'Alices Ansage bleibt');

-- ---- Rate Limit, Export, Austritt, Kontolöschung ---------------------------------------------------
insert into public.rate_limit_hits (user_id, action) select tests.uid('dave'), 'plan_arrival' from generate_series(1, 30);
select tests.login('dave');
select public.set_attendance(tests.var('gleich')::uuid, 'going');
select throws_ok($$ select public.set_plan_arrival(tests.var('gleich')::uuid, 'here') $$, 'P0001', 'rate_limited', 'zu viele Ansagen werden gebremst');

select tests.login('alice');
select is(jsonb_array_length(public.export_my_data() -> 'plan_arrivals'), 1, 'der Export enthält die eigene Ansage');
select is(public.export_my_data() -> 'plan_arrivals' -> 0 ->> 'state', 'here', 'mit Stand');

select tests.login('bob');
select lives_ok($$ select public.set_plan_arrival(tests.var('gleich')::uuid, 'here') $$, 'Bob ist da');
select public.leave_crew(tests.var('crew')::uuid);
select throws_ok($$ select public.set_plan_arrival(tests.var('gleich')::uuid, 'none') $$, '42501', null, 'nach dem Austritt nichts mehr ansagen');
select throws_ok($$ select public.plan_arrival_status(tests.var('gleich')::uuid) $$, '42501', null, 'und nichts mehr sehen');
select tests.login('alice');
select is(jsonb_array_length(public.plan_arrival_status(tests.var('gleich')::uuid) -> 'people'), 1, 'wer ausgetreten ist, steht nicht mehr in der Liste');

select lives_ok($$ select public.delete_my_account('DELETE') $$, 'Alice löscht ihr Konto');
select tests.logout();
select is((select count(*)::int from public.plan_arrivals where user_id = tests.uid('alice')), 0, 'Kontolöschung löscht die eigenen Ansagen');

select * from finish();
rollback;
