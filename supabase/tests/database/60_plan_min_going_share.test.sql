-- P25 Etappe 2: Die Vorschau des Teilen-Links (preview_shared_plan) nennt die Mindestzahl, solange der Plan
-- offen ist – für alle mit dem Link, auch ohne Konto. Mehr als bisher verrät sie nicht: keine Namen, keine
-- Plan-ID für Außenstehende. Nach Beginn, abgesagt oder abgeschlossen: keine Mindestzahl.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Mallory');

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew', '🎳')::text);
select tests.set_var('invite', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob');
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('mallory');
select public.create_crew('Fremde Crew');

select tests.login('alice');
select tests.set_var('plan', public.create_plan(tests.var('crew')::uuid, 'Bowling', now() + interval '3 days', p_confirmed => true)::text);
select tests.set_var('token', public.plan_share_token(tests.var('plan')::uuid));
select public.set_plan_guests(tests.var('plan')::uuid, true);

-- ---- Ohne Mindestzahl ------------------------------------------------------------------------------------
select tests.logout();
select tests.login_anon();
select is(public.preview_shared_plan(tests.var('token')) -> 'plan' -> 'min_going', 'null'::jsonb, 'ohne Mindestzahl: null');
select ok(public.preview_shared_plan(tests.var('token')) -> 'plan' ? 'min_going', 'Feld ist immer da');

-- ---- Mit Mindestzahl ------------------------------------------------------------------------------------
select tests.login('alice');
select public.set_plan_min_going(tests.var('plan')::uuid, 3);
select tests.logout();
select tests.login_anon();
select is((public.preview_shared_plan(tests.var('token')) -> 'plan' ->> 'min_going')::int, 3, 'ohne Konto: Mindestzahl 3');
select is((public.preview_shared_plan(tests.var('token')) -> 'plan' ->> 'going_count')::int, 1, 'ohne Konto: 1 Zusage (Alice)');
select is(public.preview_shared_plan(tests.var('token')) ->> 'plan_id', null, 'ohne Konto: keine Plan-ID');

-- Gäste zählen mit.
select public.guest_rsvp_shared_plan(tests.var('token'), repeat('e', 64), 'Emil', 'going');
select is((public.preview_shared_plan(tests.var('token')) -> 'plan' ->> 'going_count')::int, 2, 'Gast-Zusage zählt mit');

-- Außenstehende mit Link: dieselben Zahlen, keine Plan-ID, keine Namen.
select tests.login('mallory');
select is((public.preview_shared_plan(tests.var('token')) -> 'plan' ->> 'min_going')::int, 3, 'Außenstehende: Mindestzahl');
select is(public.preview_shared_plan(tests.var('token')) ->> 'plan_id', null, 'Außenstehende: keine Plan-ID');
select is((select array_agg(k order by k) from jsonb_object_keys(public.preview_shared_plan(tests.var('token')) -> 'plan') k),
  array['ends_at', 'going_count', 'guests', 'max_going', 'min_going', 'starts_at', 'status', 'title'], 'nur Titel, Zeit, Status und Zahlen');
select throws_ok($$ select public.set_plan_min_going(tests.var('plan')::uuid, 2) $$, '42501', null, 'Außenstehende ändern nichts');

-- Mitglieder: mit Plan-ID.
select tests.login('bob');
select is(public.preview_shared_plan(tests.var('token')) ->> 'plan_id', tests.var('plan'), 'Mitglieder: Plan-ID');
select is((public.preview_shared_plan(tests.var('token')) -> 'plan' ->> 'min_going')::int, 3, 'Mitglieder: Mindestzahl');

-- Falscher Link: nichts.
select tests.login_anon();
select is(public.preview_shared_plan(repeat('0', 32)), '{"status": "not_found"}'::jsonb, 'falscher Link: nicht gefunden');

-- ---- Nach Beginn, abgesagt ------------------------------------------------------------------------------------
select tests.logout();
update public.plans set starts_at = now() - interval '1 hour' where id = tests.var('plan')::uuid;
select tests.login_anon();
select is(public.preview_shared_plan(tests.var('token')) -> 'plan' -> 'min_going', 'null'::jsonb, 'nach Beginn: keine Mindestzahl');

select tests.logout();
update public.plans set starts_at = now() + interval '3 days' where id = tests.var('plan')::uuid;
select tests.login('alice');
select public.set_plan_status(tests.var('plan')::uuid, 'cancelled');
select tests.login_anon();
select is(public.preview_shared_plan(tests.var('token')) -> 'plan' -> 'min_going', 'null'::jsonb, 'abgesagt: keine Mindestzahl');
select is(public.preview_shared_plan(tests.var('token')) -> 'plan' ->> 'status', 'cancelled', 'abgesagt: Status bleibt sichtbar');

-- Rechte unverändert.
select tests.logout();
select ok(has_function_privilege('anon', 'public.preview_shared_plan(text)', 'execute'), 'anon darf die Vorschau abrufen');
select ok(not has_function_privilege('public', 'public.preview_shared_plan(text)', 'execute'), 'public nicht');

select * from finish();
rollback;
