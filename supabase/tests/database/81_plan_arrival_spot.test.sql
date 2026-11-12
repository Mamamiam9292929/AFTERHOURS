-- P44: „Wo sitzt ihr?“ – wer „Bin da“ gesagt hat, sagt in ein paar Worten, wo genau. Nur mit eigener Ansage „Bin da“
-- aus dem aktuellen Fenster, höchstens 60 Zeichen, leer löscht; „später“ oder Zurücknehmen löscht den Hinweis. Lesen nur
-- über `plan_arrival_status` (Crew); Außenstehende und anon sehen und setzen nichts.
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

select tests.logout();
insert into public.plans (crew_id, created_by, title, starts_at, ends_at, status, created_at) values
  (tests.var('crew')::uuid, tests.uid('alice'), 'Bowling', now() + interval '10 minutes', null, 'confirmed', now() - interval '5 days'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Morgen', now() + interval '1 day', null, 'confirmed', now() - interval '5 days');
select tests.set_var(lower(title), id::text) from public.plans where title in ('Bowling', 'Morgen');
insert into public.plan_participants (plan_id, user_id, attendance_status) values
  (tests.var('bowling')::uuid, tests.uid('alice'), 'going'),
  (tests.var('bowling')::uuid, tests.uid('bob'), 'going'),
  (tests.var('bowling')::uuid, tests.uid('carol'), 'maybe'),
  (tests.var('bowling')::uuid, tests.uid('dave'), 'declined'),
  (tests.var('morgen')::uuid, tests.uid('alice'), 'going');

-- ---- Rechte ----------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.set_plan_arrival_spot(uuid, text)', 'execute'), 'anon darf nichts sagen');
select ok(has_function_privilege('authenticated', 'public.set_plan_arrival_spot(uuid, text)', 'execute'), 'angemeldete Personen dürfen');
select ok(not has_function_privilege('authenticated', 'app_private.plan_arrival_spot_reset()', 'execute'), 'Trigger-Funktion bleibt intern');
select ok(not has_column_privilege('authenticated', 'public.plan_arrivals', 'spot', 'select'), 'Hinweis nicht direkt lesbar');

select tests.login_anon();
select throws_ok($$ select public.set_plan_arrival_spot(tests.var('bowling')::uuid, 'hinten') $$, '42501', null, 'ohne Konto: verboten');

select tests.login('mallory');
select throws_ok($$ select public.set_plan_arrival_spot(tests.var('bowling')::uuid, 'hinten') $$, '42501', null, 'Außenstehende sagen nichts');
select throws_ok($$ select public.set_plan_arrival_spot(gen_random_uuid(), 'hinten') $$, '42501', null, 'unbekannter Plan verrät nichts');

-- ---- Regeln --------------------------------------------------------------------------------------
select tests.login('dave');
select throws_ok($$ select public.set_plan_arrival_spot(tests.var('bowling')::uuid, 'hinten') $$, 'P0001', 'plan_arrival_not_going', 'wer abgesagt hat, sagt nichts');

select tests.login('alice');
select throws_ok($$ select public.set_plan_arrival_spot(tests.var('morgen')::uuid, 'hinten') $$, 'P0001', 'plan_arrival_closed', 'am Vortag: noch nicht');
select throws_ok($$ select public.set_plan_arrival_spot(tests.var('bowling')::uuid, 'hinten') $$, 'P0001', 'plan_arrival_spot_not_here', 'ohne „Bin da“: nichts');
select public.set_plan_arrival(tests.var('bowling')::uuid, 'late', 20);
select throws_ok($$ select public.set_plan_arrival_spot(tests.var('bowling')::uuid, 'hinten') $$, 'P0001', 'plan_arrival_spot_not_here', 'wer noch kommt, sagt nicht, wo man sitzt');

select public.set_plan_arrival(tests.var('bowling')::uuid, 'here');
select is(public.set_plan_arrival_spot(tests.var('bowling')::uuid, E'  hinten   links,\n Tisch 12  '), 'hinten links, Tisch 12', 'eine Zeile, Leerzeichen zusammengefasst');
select is(public.plan_arrival_status(tests.var('bowling')::uuid) -> 'mine' ->> 'spot', 'hinten links, Tisch 12', 'Alice sieht ihren Hinweis');
select is(char_length(public.set_plan_arrival_spot(tests.var('bowling')::uuid, repeat('x', 100))), 60, 'höchstens 60 Zeichen');
select is(public.set_plan_arrival_spot(tests.var('bowling')::uuid, 'Terrasse oben'), 'Terrasse oben', 'ändern');

select tests.login('bob');
select is((select x ->> 'spot' from jsonb_array_elements(public.plan_arrival_status(tests.var('bowling')::uuid) -> 'people') x
           where x ->> 'user_id' = tests.uid('alice')::text), 'Terrasse oben', 'die Crew sieht, wo Alice sitzt');
select tests.login('mallory');
select throws_ok($$ select public.plan_arrival_status(tests.var('bowling')::uuid) $$, '42501', null, 'Außenstehende sehen es nicht');

-- Bob ist da, Hinweis löschen mit leerem Text.
select tests.login('bob');
select public.set_plan_arrival(tests.var('bowling')::uuid, 'here');
select is(public.set_plan_arrival_spot(tests.var('bowling')::uuid, 'Bar'), 'Bar', 'Bob sagt „Bar“');
select is(public.set_plan_arrival_spot(tests.var('bowling')::uuid, '   '), null, 'leer löscht');
select is(public.plan_arrival_status(tests.var('bowling')::uuid) -> 'mine' -> 'spot', 'null'::jsonb, 'Hinweis ist weg');

-- „Bin da“ erneut behält den Hinweis; „später“ oder Zurücknehmen löscht ihn.
select tests.login('alice');
select public.set_plan_arrival(tests.var('bowling')::uuid, 'here');
select is(public.plan_arrival_status(tests.var('bowling')::uuid) -> 'mine' ->> 'spot', 'Terrasse oben', '„Bin da“ noch mal: Hinweis bleibt');
select public.set_plan_arrival(tests.var('bowling')::uuid, 'late', 10);
select is(public.plan_arrival_status(tests.var('bowling')::uuid) -> 'mine' -> 'spot', 'null'::jsonb, '„später“ löscht den Hinweis');
select tests.logout();
update public.plan_arrivals set spot = 'x' where user_id = tests.uid('alice');
select is((select spot from public.plan_arrivals where user_id = tests.uid('alice')), null,
          'Hinweis nur bei „Bin da“ (auch direkt in der Datenbank)');

-- ---- Export ----------------------------------------------------------------------------------------
select tests.login('carol');
select public.set_plan_arrival(tests.var('bowling')::uuid, 'here');
select public.set_plan_arrival_spot(tests.var('bowling')::uuid, 'am Fenster');
select is(public.export_my_data() -> 'plan_arrivals' -> 0 ->> 'spot', 'am Fenster', 'der Export enthält den Hinweis');

-- ---- Rate Limit ------------------------------------------------------------------------------------
select tests.logout();
insert into public.rate_limit_hits (user_id, action) select tests.uid('carol'), 'plan_arrival_spot' from generate_series(1, 30);
select tests.login('carol');
select throws_ok($$ select public.set_plan_arrival_spot(tests.var('bowling')::uuid, 'Theke') $$, 'P0001', 'rate_limited', 'zu oft wird gebremst');

select * from finish();
rollback;
