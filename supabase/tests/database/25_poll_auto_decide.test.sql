-- Abstimmung entscheidet sich selbst (Roadmap S5 Etappe 1): klare Mehrheit, Frist, Gleichstand, kein doppelter Plan.
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
select tests.set_var('d2', ((now() at time zone 'Europe/Berlin')::date + 6)::text);

-- Abstimmung mit zwei Vorschlägen (A mit Uhrzeit, B nur Tag); Optionen-IDs als Variablen p<name>_a / _b.
create function tests.poll2(p_name text) returns void
language plpgsql as $$
begin
  perform tests.set_var(p_name, public.create_poll(tests.var('crew')::uuid, 'Was geht ' || p_name || '?', now() + interval '1 day',
    jsonb_build_array(
      jsonb_build_object('title', 'Bowling', 'proposed_date', tests.var('d1'), 'proposed_time', '20:00'),
      jsonb_build_object('title', 'Kino', 'proposed_date', tests.var('d2'))))::text);
  perform tests.set_var(p_name || '_a', (select id::text from public.poll_options where poll_id = tests.var(p_name)::uuid and title = 'Bowling'));
  perform tests.set_var(p_name || '_b', (select id::text from public.poll_options where poll_id = tests.var(p_name)::uuid and title = 'Kino'));
end $$;
grant execute on function tests.poll2(text) to authenticated;

-- ---- Rechte und Angriff von außen --------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.set_poll_auto_decide(uuid, boolean)', 'execute'), 'anon darf den Schalter nicht');
select ok(has_function_privilege('authenticated', 'public.set_poll_auto_decide(uuid, boolean)', 'execute'), 'angemeldete Mitglieder dürfen ihn aufrufen');

select tests.login('alice');
select tests.poll2('maj');
select is((select auto_decide from public.polls where id = tests.var('maj')::uuid), false, 'neue Abstimmungen entscheiden sich standardmäßig nicht selbst');

select tests.login_anon();
select throws_ok(format($$ select public.set_poll_auto_decide(%L, true) $$, tests.var('maj')), '42501', null, 'anon scheitert');
select tests.login('mallory');
select throws_ok(format($$ select public.set_poll_auto_decide(%L, true) $$, tests.var('maj')), '42501', 'forbidden', 'Außenstehende scheitern');
select throws_ok(format($$ select public.set_poll_auto_decide(%L, true) $$, gen_random_uuid()), '42501', 'forbidden', 'unbekannte Abstimmung sieht aus wie eine fremde');
select tests.login('bob');
select throws_ok(format($$ select public.set_poll_auto_decide(%L, true) $$, tests.var('maj')), '42501', 'forbidden', 'einfache Mitglieder dürfen fremde Abstimmungen nicht umschalten');
select tests.logout();
select is((select auto_decide from public.polls where id = tests.var('maj')::uuid), false, 'Angriffe haben nichts geändert');

-- ---- Klare Mehrheit ---------------------------------------------------------------------------
select tests.login('alice');
select is(public.set_poll_auto_decide(tests.var('maj')::uuid, true), false, 'Einschalten ohne Mehrheit lässt die Abstimmung laufen');
select public.cast_vote(tests.var('maj_a')::uuid, 'yes');
select public.cast_vote(tests.var('maj_b')::uuid, 'no');
select tests.login('bob');
select public.cast_vote(tests.var('maj_a')::uuid, 'yes');
select tests.logout();
select is((select status::text from public.polls where id = tests.var('maj')::uuid), 'open',
  '2 von 3 bei Bowling, aber Kino könnte noch gleichziehen (Bob und Carol fehlen dort) – läuft weiter');

select tests.login('bob');
select public.cast_vote(tests.var('maj_b')::uuid, 'no');
select tests.logout();
select is((select status::text || ' ' || (closed_by is null)::text from public.polls where id = tests.var('maj')::uuid), 'closed true',
  'Mehrheit der Crew und uneinholbar – Abstimmung ist von selbst beendet');
select is((select winning_option_id::text from public.polls where id = tests.var('maj')::uuid), tests.var('maj_a'), 'Bowling gewinnt');
select is((select count(*)::int from public.plans where poll_id = tests.var('maj')::uuid), 1, 'genau ein Plan');
select is((select title || ' ' || status::text || ' ' || created_by::text from public.plans where poll_id = tests.var('maj')::uuid),
  'Bowling confirmed ' || tests.uid('alice')::text, 'bestätigter Plan mit Titel des Gewinners, angelegt für die Ersteller:in');
select is((select starts_at from public.plans where poll_id = tests.var('maj')::uuid),
  (tests.var('d1')::date + time '20:00') at time zone 'Europe/Berlin', 'Termin aus dem Vorschlag in Berliner Zeit');
select is((select string_agg(pr.display_name || '=' || pp.attendance_status::text, ',' order by pr.display_name)
           from public.plan_participants pp join public.profiles pr on pr.id = pp.user_id
           join public.plans pl on pl.id = pp.plan_id where pl.poll_id = tests.var('maj')::uuid),
  'Alice=going,Bob=going,Carol=invited', 'wer bei Bowling dabei war, ist zugesagt; Carol ist eingeladen');
select is((select count(*)::int from public.notifications n join public.plans pl on pl.id = n.related_entity_id
           where pl.poll_id = tests.var('maj')::uuid and n.type = 'plan_created' and (n.payload ->> 'auto')::boolean),
  3, 'alle drei bekommen Bescheid über den Plan');

select tests.login('carol');
select throws_ok(format($$ select public.cast_vote(%L, 'yes') $$, tests.var('maj_b')), 'P0001', 'poll_closed', 'danach kann niemand mehr abstimmen');
select tests.login('alice');
select throws_ok(format($$ select public.create_plan_from_poll(%L, %L) $$, tests.var('maj'), tests.var('maj_a')),
  'P0001', 'plan_exists', 'kein doppelter Plan über „Plan erstellen“');
select throws_ok(format($$ select public.set_poll_auto_decide(%L, false) $$, tests.var('maj')), 'P0001', 'poll_closed', 'beendete Abstimmung lässt sich nicht mehr umschalten');
select tests.logout();

-- ---- Frist ------------------------------------------------------------------------------------
select tests.login('alice');
select tests.poll2('due');
select public.set_poll_auto_decide(tests.var('due')::uuid, true);
select public.cast_vote(tests.var('due_b')::uuid, 'yes');
select tests.logout();
update public.polls set ends_at = now() - interval '1 second' where id = tests.var('due')::uuid;
select tests.login('carol');
select is(public.finalize_due_poll(tests.var('due')::uuid), true, 'nach der Frist stellt jedes Mitglied das Ergebnis fest');
select tests.logout();
select is((select count(*)::int from public.plans where poll_id = tests.var('due')::uuid), 1, 'Fristende mit Gewinner ergibt einen Plan, auch ohne Mehrheit');
select is((select starts_at from public.plans where poll_id = tests.var('due')::uuid),
  (tests.var('d2')::date + time '19:00') at time zone 'Europe/Berlin', 'ohne Uhrzeit gilt 19:00 wie bei „Plan erstellen“');

-- ---- Gleichstand ------------------------------------------------------------------------------
select tests.login('alice');
select tests.poll2('tie');
select public.set_poll_auto_decide(tests.var('tie')::uuid, true);
select public.cast_vote(tests.var('tie_a')::uuid, 'yes');
select tests.login('bob');
select public.cast_vote(tests.var('tie_b')::uuid, 'yes');
select tests.logout();
update public.polls set ends_at = now() - interval '1 second' where id = tests.var('tie')::uuid;
select tests.login('bob');
select public.finalize_due_poll(tests.var('tie')::uuid);
select tests.logout();
select is((select is_tie from public.polls where id = tests.var('tie')::uuid), true, 'Gleichstand bleibt Gleichstand');
select is((select count(*)::int from public.plans where poll_id = tests.var('tie')::uuid), 0, 'bei Gleichstand entsteht kein Plan');
select tests.login('alice');
select tests.set_var('runoff', public.start_runoff_poll(tests.var('tie')::uuid, 'Stichwahl', now() + interval '1 day')::text);
select tests.logout();
select is((select auto_decide from public.polls where id = tests.var('runoff')::uuid), true, 'die Stichwahl erbt den Schalter');

-- ---- Schalter aus, Beenden von Hand, Einschalten mit bestehender Mehrheit ------------------------
select tests.login('alice');
select tests.poll2('off');
select public.cast_vote(tests.var('off_a')::uuid, 'yes');
select public.cast_vote(tests.var('off_b')::uuid, 'no');
select tests.login('bob');
select public.cast_vote(tests.var('off_a')::uuid, 'yes');
select public.cast_vote(tests.var('off_b')::uuid, 'no');
select tests.logout();
select is((select status::text from public.polls where id = tests.var('off')::uuid), 'open', 'ohne Schalter läuft die Abstimmung trotz Mehrheit weiter');
select tests.login('alice');
select is(public.set_poll_auto_decide(tests.var('off')::uuid, true), true, 'Einschalten bei bestehender Mehrheit entscheidet sofort');
select tests.logout();
select is((select count(*)::int from public.plans where poll_id = tests.var('off')::uuid), 1, '… mit Plan');

select tests.login('alice');
select tests.poll2('hand');
select public.set_poll_auto_decide(tests.var('hand')::uuid, true);
select public.cast_vote(tests.var('hand_a')::uuid, 'yes');
select public.close_poll(tests.var('hand')::uuid);
select tests.logout();
select is((select count(*)::int from public.plans where poll_id = tests.var('hand')::uuid), 0, 'wer von Hand beendet, legt den Plan wie bisher selbst an');

-- ---- Ohne Termin, Termin-Abstimmung, Gäste ------------------------------------------------------
select tests.login('alice');
select tests.set_var('nodate', public.create_poll(tests.var('crew')::uuid, 'Was machen wir?', now() + interval '1 day', '[{"title":"Kino"}]'::jsonb)::text);
select public.set_poll_auto_decide(tests.var('nodate')::uuid, true);
select public.cast_vote((select id from public.poll_options where poll_id = tests.var('nodate')::uuid), 'yes');
select tests.login('bob');
select public.cast_vote((select id from public.poll_options where poll_id = tests.var('nodate')::uuid), 'yes');
select tests.logout();
select is((select status::text from public.polls where id = tests.var('nodate')::uuid), 'closed', 'Vorschlag ohne Termin: Abstimmung ist entschieden …');
select is((select count(*)::int from public.plans where poll_id = tests.var('nodate')::uuid), 0, '… aber ohne Tag entsteht kein Plan');

select tests.login('alice');
select tests.set_var('when', public.create_date_poll(tests.var('crew')::uuid, 'Wann könnt ihr?', now() + interval '1 day',
  jsonb_build_array(jsonb_build_object('date', tests.var('d1')), jsonb_build_object('date', tests.var('d2'))))::text);
select throws_ok(format($$ select public.set_poll_auto_decide(%L, true) $$, tests.var('when')),
  'P0001', 'auto_decide_unsupported', 'Termin-Abstimmungen entscheiden sich nicht selbst (danach kommt „Und wo?“)');
select is(public.set_poll_auto_decide(tests.var('when')::uuid, false), false, 'ausschalten geht immer');

-- Gäste zählen bei den Stimmen, die Mehrheit muss aus der Crew kommen.
select tests.poll2('guest');
select public.set_poll_guests(tests.var('guest')::uuid, true);
select public.set_poll_auto_decide(tests.var('guest')::uuid, true);
select public.cast_vote(tests.var('guest_a')::uuid, 'yes');
select public.cast_vote(tests.var('guest_b')::uuid, 'no');
select tests.logout();
insert into public.poll_guests (id, poll_id, secret_hash, display_name)
values ('00000000-0000-0000-0000-0000000000a1', tests.var('guest')::uuid, repeat('a', 64), 'Dana'),
       ('00000000-0000-0000-0000-0000000000a2', tests.var('guest')::uuid, repeat('b', 64), 'Erik');
insert into public.poll_guest_votes (poll_id, poll_option_id, guest_id, response)
values (tests.var('guest')::uuid, tests.var('guest_a')::uuid, '00000000-0000-0000-0000-0000000000a1', 'yes'),
       (tests.var('guest')::uuid, tests.var('guest_a')::uuid, '00000000-0000-0000-0000-0000000000a2', 'yes');
select is((select status::text from public.polls where id = tests.var('guest')::uuid), 'open', 'zwei Gäste allein machen keine Mehrheit der Crew');
select tests.login('bob');
select public.cast_vote(tests.var('guest_a')::uuid, 'yes');
select tests.logout();
select is((select status::text from public.polls where id = tests.var('guest')::uuid), 'closed',
  'mit Bob ist die Crew-Mehrheit da, und Kino kann die Gast-Stimmen nicht mehr einholen');

-- Außenstehende sehen den entstandenen Plan nicht.
select tests.login('mallory');
select is((select count(*)::int from public.plans where crew_id = tests.var('crew')::uuid), 0, 'Außenstehende sehen keine automatisch angelegten Pläne');
select tests.logout();

select * from finish();
rollback;
