-- W11 Etappe 2: Nach dem Beitritt über einen Gast-Link (Plan oder Abstimmung) weiß die App, wohin es geht.
-- `accept_crew_invitation` liefert plan_id/poll_id nur Mitgliedern – Außenstehende erfahren nichts.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Carla');
select tests.make_user('Dana');
select tests.make_user('Mallory');

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew', '🎳')::text);
select tests.set_var('invite', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));

-- ---- Normale Einladung: kein Ziel ------------------------------------------------------------------
select tests.login('bob');
select tests.set_var('bob_join', public.accept_crew_invitation(tests.var('invite'))::text);
select is(tests.var('bob_join')::jsonb ->> 'status', 'joined', 'Bob tritt über die normale Einladung bei');
select is(tests.var('bob_join')::jsonb ->> 'crew_id', tests.var('crew'), '… landet in der Crew');
select ok(tests.var('bob_join')::jsonb ->> 'plan_id' is null, '… ohne Plan als Ziel');
select ok(tests.var('bob_join')::jsonb ->> 'poll_id' is null, '… und ohne Abstimmung als Ziel');

-- ---- Plan-Link (W11) --------------------------------------------------------------------------------
select tests.logout();
insert into public.plans (crew_id, created_by, title, starts_at, status) values
  (tests.var('crew')::uuid, tests.uid('bob'), 'Bowling', now() + interval '3 days', 'confirmed');
select tests.set_var('bowling', (select id::text from public.plans where title = 'Bowling'));
select tests.login('bob');
select tests.set_var('plan_token', public.plan_share_token(tests.var('bowling')::uuid));
select public.set_plan_guests(tests.var('bowling')::uuid, true);
select tests.login('alice');
select public.set_plan_guest_join(tests.var('bowling')::uuid, true);

select tests.set_var('dana', repeat('d', 64));
select tests.login_anon();
select public.guest_rsvp_shared_plan(tests.var('plan_token'), tests.var('dana'), 'Dana', 'going');
select tests.set_var('dana_link', public.guest_join_shared_plan(tests.var('plan_token'), tests.var('dana')) ->> 'token');

select tests.login('dana');
select tests.set_var('dana_join', public.accept_crew_invitation(tests.var('dana_link'))::text);
select is(tests.var('dana_join')::jsonb ->> 'status', 'joined', 'Dana tritt mit ihrem Gast-Link bei');
select is(tests.var('dana_join')::jsonb ->> 'plan_id', tests.var('bowling'), '… und die App führt sie direkt zum Plan');
select ok(tests.var('dana_join')::jsonb ->> 'poll_id' is null, '… nicht zu einer Abstimmung');
select is((select count(*)::int from public.plans where id = tests.var('bowling')::uuid), 1, 'Dana sieht den Plan jetzt als Mitglied');

select tests.set_var('dana_again', public.accept_crew_invitation(tests.var('dana_link'))::text);
select is(tests.var('dana_again')::jsonb ->> 'status', 'already_member', 'Link erneut öffnen: schon Mitglied');
select is(tests.var('dana_again')::jsonb ->> 'plan_id', tests.var('bowling'), '… und wieder zum Plan');

-- ---- Außenstehende erfahren nichts ------------------------------------------------------------------
select tests.login('mallory');
select tests.set_var('mallory_try', public.accept_crew_invitation(tests.var('dana_link'))::text);
select is(tests.var('mallory_try')::jsonb ->> 'status', 'exhausted', 'weitergegebener Link ist verbraucht');
select ok(not (tests.var('mallory_try')::jsonb ? 'plan_id'), 'Außenstehende bekommen keine Plan-ID');
select ok(not (tests.var('mallory_try')::jsonb ? 'crew_id'), '… und keine Crew-ID');
select tests.set_var('mallory_unknown', public.accept_crew_invitation(repeat('0', 64))::text);
select is(tests.var('mallory_unknown')::jsonb ->> 'status', 'not_found', 'unbekannter Link');
select ok(not (tests.var('mallory_unknown')::jsonb ? 'plan_id'), '… ohne Plan-ID');
select is((select count(*)::int from public.crew_members where user_id = tests.uid('mallory')), 0, 'Mallory ist in keiner Crew');

-- ---- Abgesagter Plan: zurück zur Crew ------------------------------------------------------------------
select tests.logout();
update public.plans set status = 'cancelled', cancelled_at = now() where id = tests.var('bowling')::uuid;
select tests.login('dana');
select tests.set_var('dana_cancelled', public.accept_crew_invitation(tests.var('dana_link'))::text);
select is(tests.var('dana_cancelled')::jsonb ->> 'status', 'already_member', 'nach der Absage weiterhin Mitglied');
select ok(tests.var('dana_cancelled')::jsonb ->> 'plan_id' is null, 'abgesagter Plan ist kein Ziel mehr');
select is(tests.var('dana_cancelled')::jsonb ->> 'crew_id', tests.var('crew'), '… dann geht es zur Crew');

-- ---- Abstimm-Link (W3) ------------------------------------------------------------------------------
select tests.login('bob');
select tests.set_var('poll', public.create_poll(
  tests.var('crew')::uuid, 'Was machen wir am Samstag?', now() + interval '2 days',
  '[{"title":"Bowling"},{"title":"Kino"}]')::text);
select tests.set_var('poll_token', public.poll_share_token(tests.var('poll')::uuid));
select public.set_poll_guests(tests.var('poll')::uuid, true);
select tests.login('alice');
select public.set_poll_guest_join(tests.var('poll')::uuid, true);

select tests.set_var('carla', repeat('c', 64));
select tests.login_anon();
select public.guest_vote_shared_poll(tests.var('poll_token'), tests.var('carla'), 'Carla', '{"1": "yes"}');
select tests.set_var('carla_link', public.guest_join_shared_poll(tests.var('poll_token'), tests.var('carla')) ->> 'token');

select tests.login('carla');
select tests.set_var('carla_join', public.accept_crew_invitation(tests.var('carla_link'))::text);
select is(tests.var('carla_join')::jsonb ->> 'status', 'joined', 'Carla tritt vom Stimmzettel aus bei');
select is(tests.var('carla_join')::jsonb ->> 'poll_id', tests.var('poll'), '… und landet bei der Abstimmung');
select ok(tests.var('carla_join')::jsonb ->> 'plan_id' is null, '… nicht bei einem Plan');

-- ---- Rechte unverändert ------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.accept_crew_invitation(text)', 'execute'), 'anon tritt keiner Crew bei');
select ok(has_function_privilege('authenticated', 'public.accept_crew_invitation(text)', 'execute'), 'Angemeldete dürfen beitreten');

select * from finish();
rollback;
