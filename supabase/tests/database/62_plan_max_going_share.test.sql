-- P26 Etappe 2: Die Vorschau des Teilen-Links (preview_shared_plan) nennt die Höchstzahl, solange der Plan offen
-- ist – für alle mit dem Link, auch ohne Konto. Mehr verrät sie nicht: keine Namen, keine Nachrückliste, keine
-- Plan-ID für Außenstehende. Nach Beginn, abgesagt oder abgeschlossen: keine Höchstzahl. Gäste kommen bei voller
-- Runde nicht auf „Bin dabei“, „Vielleicht“ geht weiter.
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
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('carol');
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('mallory');
select public.create_crew('Fremde Crew');

select tests.login('alice');
select tests.set_var('plan', public.create_plan(tests.var('crew')::uuid, 'Bowling', now() + interval '3 days', p_confirmed => true)::text);
select tests.set_var('token', public.plan_share_token(tests.var('plan')::uuid));
select public.set_plan_guests(tests.var('plan')::uuid, true);

-- ---- Ohne Höchstzahl ------------------------------------------------------------------------------------
select tests.logout();
select tests.login_anon();
select ok(public.preview_shared_plan(tests.var('token')) -> 'plan' ? 'max_going', 'Feld ist immer da');
select is(public.preview_shared_plan(tests.var('token')) -> 'plan' -> 'max_going', 'null'::jsonb, 'ohne Höchstzahl: null');

-- ---- Mit Höchstzahl ------------------------------------------------------------------------------------
select tests.login('alice');
select public.set_plan_max_going(tests.var('plan')::uuid, 3);
select tests.logout();
select tests.login_anon();
select is((public.preview_shared_plan(tests.var('token')) -> 'plan' ->> 'max_going')::int, 3, 'ohne Konto: Höchstzahl 3');
select is((public.preview_shared_plan(tests.var('token')) -> 'plan' ->> 'going_count')::int, 1, 'ohne Konto: 1 Zusage (Alice)');
select is(public.preview_shared_plan(tests.var('token')) ->> 'plan_id', null, 'ohne Konto: keine Plan-ID');

-- Gast sagt zu, Bob sagt zu: voll.
select public.guest_rsvp_shared_plan(tests.var('token'), repeat('e', 64), 'Emil', 'going');
select tests.login('bob');
select public.set_attendance(tests.var('plan')::uuid, 'going');
select tests.login_anon();
select is((public.preview_shared_plan(tests.var('token')) -> 'plan' ->> 'going_count')::int, 3, 'voll: 3 Zusagen mit Gast');

-- Carol steht auf der Nachrückliste – die Vorschau verrät weder sie noch die Liste.
select tests.login('carol');
select public.join_plan_waitlist(tests.var('plan')::uuid);
select tests.login_anon();
select ok(public.preview_shared_plan(tests.var('token'))::text !~* '(carol|waitlist|nachr)', 'keine Namen, keine Nachrückliste');

-- Ein zweiter Gast kommt bei voller Runde nicht auf „Bin dabei“, „Vielleicht“ geht.
select throws_ok($$ select public.guest_rsvp_shared_plan(tests.var('token'), repeat('f', 64), 'Fritz', 'going') $$, 'P0001', 'plan_full', 'voll: Gast kann nicht zusagen');
select lives_ok($$ select public.guest_rsvp_shared_plan(tests.var('token'), repeat('f', 64), 'Fritz', 'maybe') $$, 'voll: Gast kann „Vielleicht“ sagen');
select lives_ok($$ select public.guest_rsvp_shared_plan(tests.var('token'), repeat('e', 64), 'Emil', 'going') $$, 'wer schon dabei ist, behält den Platz');

-- Außenstehende mit Link: dieselben Zahlen, keine Plan-ID; ändern nichts.
select tests.login('mallory');
select is((public.preview_shared_plan(tests.var('token')) -> 'plan' ->> 'max_going')::int, 3, 'Außenstehende: Höchstzahl');
select is(public.preview_shared_plan(tests.var('token')) ->> 'plan_id', null, 'Außenstehende: keine Plan-ID');
select is((select array_agg(k order by k) from jsonb_object_keys(public.preview_shared_plan(tests.var('token')) -> 'plan') k),
  array['ends_at', 'going_count', 'guests', 'max_going', 'min_going', 'starts_at', 'status', 'title'], 'nur Titel, Zeit, Status und Zahlen');
select throws_ok($$ select public.set_plan_max_going(tests.var('plan')::uuid, 10) $$, '42501', null, 'Außenstehende ändern nichts');

-- Mitglieder: mit Plan-ID.
select tests.login('carol');
select is(public.preview_shared_plan(tests.var('token')) ->> 'plan_id', tests.var('plan'), 'Mitglieder: Plan-ID');
select is((public.preview_shared_plan(tests.var('token')) -> 'plan' ->> 'max_going')::int, 3, 'Mitglieder: Höchstzahl');

-- ---- Nach Beginn, abgesagt ------------------------------------------------------------------------------------
select tests.logout();
update public.plans set starts_at = now() - interval '1 hour' where id = tests.var('plan')::uuid;
select tests.login_anon();
select is(public.preview_shared_plan(tests.var('token')) -> 'plan' -> 'max_going', 'null'::jsonb, 'nach Beginn: keine Höchstzahl');

select tests.logout();
update public.plans set starts_at = now() + interval '3 days' where id = tests.var('plan')::uuid;
select tests.login('alice');
select public.set_plan_status(tests.var('plan')::uuid, 'cancelled');
select tests.login_anon();
select is(public.preview_shared_plan(tests.var('token')) -> 'plan' -> 'max_going', 'null'::jsonb, 'abgesagt: keine Höchstzahl');
select is(public.preview_shared_plan(tests.var('token')) -> 'plan' -> 'min_going', 'null'::jsonb, 'abgesagt: keine Mindestzahl (unverändert)');

-- Rechte unverändert.
select tests.logout();
select ok(has_function_privilege('anon', 'public.preview_shared_plan(text)', 'execute'), 'anon darf die Vorschau abrufen');
select ok(not has_function_privilege('public', 'public.preview_shared_plan(text)', 'execute'), 'public nicht');

select * from finish();
rollback;
