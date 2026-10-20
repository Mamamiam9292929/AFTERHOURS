-- Fehlerbehebung S5: Fristende unter der Mindestteilnehmerzahl ergibt keinen automatischen Plan.
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

select tests.set_var('d1', ((now() at time zone 'Europe/Berlin')::date + 5)::text);

-- Abstimmung mit Mindestzahl; Optionen-IDs als Variablen <name>_a / _b.
create function tests.poll_min(p_name text, p_min integer) returns void
language plpgsql as $$
begin
  perform tests.set_var(p_name, public.create_poll(tests.var('crew')::uuid, 'Was geht ' || p_name || '?', now() + interval '1 day',
    jsonb_build_array(
      jsonb_build_object('title', 'Bowling', 'proposed_date', tests.var('d1'), 'proposed_time', '20:00'),
      jsonb_build_object('title', 'Kino', 'proposed_date', tests.var('d1'))),
    null, null, null, p_min)::text);
  perform tests.set_var(p_name || '_a', (select id::text from public.poll_options where poll_id = tests.var(p_name)::uuid and title = 'Bowling'));
  perform tests.set_var(p_name || '_b', (select id::text from public.poll_options where poll_id = tests.var(p_name)::uuid and title = 'Kino'));
end $$;
grant execute on function tests.poll_min(text, integer) to authenticated;

-- ---- Rechte: die Trigger-Funktion ist von außen nicht aufrufbar ---------------------------------
select ok(not has_function_privilege('anon', 'app_private.on_poll_closed_auto_plan()', 'execute'), 'anon kann die Trigger-Funktion nicht aufrufen');
select ok(not has_function_privilege('authenticated', 'app_private.on_poll_closed_auto_plan()', 'execute'), 'Angemeldete können die Trigger-Funktion nicht aufrufen');

-- ---- Fristende unter der Mindestzahl: Ergebnis ja, Plan nein ------------------------------------
select tests.login('alice');
select tests.poll_min('low', 3);
select public.set_poll_auto_decide(tests.var('low')::uuid, true);
select public.cast_vote(tests.var('low_a')::uuid, 'yes');
select tests.login('bob');
select public.cast_vote(tests.var('low_a')::uuid, 'yes');
select tests.logout();
select is((select status::text from public.polls where id = tests.var('low')::uuid), 'open',
  'Mehrheit der Crew, aber unter der Mindestzahl: die Abstimmung läuft weiter');
update public.polls set ends_at = now() - interval '1 second' where id = tests.var('low')::uuid;
select tests.login('carol');
select is(public.finalize_due_poll(tests.var('low')::uuid), true, 'nach der Frist wird das Ergebnis festgestellt');
select tests.logout();
select is((select winning_option_id::text from public.polls where id = tests.var('low')::uuid), tests.var('low_a'),
  'der Gewinner steht trotzdem fest');
select is((select count(*)::int from public.plans where poll_id = tests.var('low')::uuid), 0,
  '2 von mindestens 3 Zusagen: kein automatischer Plan');
select is((select count(*)::int from public.notifications where type = 'plan_created' and crew_id = tests.var('crew')::uuid), 0,
  'niemand bekommt „Plan steht“');

-- „Plan erstellen“ von Hand geht weiterhin.
select tests.login('alice');
select lives_ok(format($$ select public.create_plan_from_poll(%L, %L) $$, tests.var('low'), tests.var('low_a')),
  'die Crew kann den Plan trotzdem von Hand erstellen');
select tests.logout();
select is((select count(*)::int from public.plans where poll_id = tests.var('low')::uuid), 1, 'danach gibt es genau einen Plan');

-- ---- Gäste zählen zur Mindestzahl wie beim Ergebnis --------------------------------------------
select tests.login('alice');
select tests.poll_min('guest', 3);
select public.set_poll_guests(tests.var('guest')::uuid, true);
select public.set_poll_auto_decide(tests.var('guest')::uuid, true);
select public.cast_vote(tests.var('guest_b')::uuid, 'yes');
select tests.login('bob');
select public.cast_vote(tests.var('guest_b')::uuid, 'yes');
select tests.logout();
insert into public.poll_guests (id, poll_id, secret_hash, display_name)
values ('00000000-0000-0000-0000-0000000000a1', tests.var('guest')::uuid, repeat('a', 64), 'Dana');
insert into public.poll_guest_votes (poll_id, poll_option_id, guest_id, response)
values (tests.var('guest')::uuid, tests.var('guest_b')::uuid, '00000000-0000-0000-0000-0000000000a1', 'yes');
update public.polls set ends_at = now() - interval '1 second' where id = tests.var('guest')::uuid;
select tests.login('carol');
select public.finalize_due_poll(tests.var('guest')::uuid);
select tests.logout();
select is((select count(*)::int from public.plans where poll_id = tests.var('guest')::uuid), 1,
  '2 aus der Crew + 1 Gast erreichen die Mindestzahl 3: Plan entsteht');

-- ---- Ohne Mindestzahl bleibt alles wie bisher ---------------------------------------------------
select tests.login('alice');
select tests.poll_min('none', null);
select public.set_poll_auto_decide(tests.var('none')::uuid, true);
select public.cast_vote(tests.var('none_b')::uuid, 'yes');
select tests.logout();
update public.polls set ends_at = now() - interval '1 second' where id = tests.var('none')::uuid;
select tests.login('bob');
select public.finalize_due_poll(tests.var('none')::uuid);
select tests.logout();
select is((select count(*)::int from public.plans where poll_id = tests.var('none')::uuid), 1,
  'ohne Mindestzahl: Fristende mit Gewinner ergibt wie bisher einen Plan');

-- ---- Mindestzahl genau erreicht ----------------------------------------------------------------
select tests.login('alice');
select tests.poll_min('exact', 2);
select public.set_poll_auto_decide(tests.var('exact')::uuid, true);
select public.cast_vote(tests.var('exact_a')::uuid, 'yes');
select public.cast_vote(tests.var('exact_b')::uuid, 'no');
select tests.login('mallory');
select throws_ok(format($$ select public.cast_vote(%L, 'yes') $$, tests.var('exact_a')), '42501', null,
  'Außenstehende können nicht mitstimmen, um die Mindestzahl zu erreichen');
select tests.login('bob');
select public.cast_vote(tests.var('exact_b')::uuid, 'no');
select public.cast_vote(tests.var('exact_a')::uuid, 'yes');
select tests.logout();
select is((select count(*)::int from public.plans where poll_id = tests.var('exact')::uuid), 1,
  'Mindestzahl genau erreicht und klare Mehrheit: Plan entsteht sofort');

select * from finish();
rollback;
