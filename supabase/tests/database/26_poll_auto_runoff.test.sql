-- Stichwahl startet von selbst (Roadmap S5 Etappe 2): nur bei automatischem Ende mit Gleichstand,
-- nur einmal, nicht nach Stichwahlen, Frist vor dem frühesten Termin, Außenstehende sehen nichts.
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

-- Abstimmung mit drei Vorschlägen; IDs als <name>_a / _b / _c. Optional mit Schalter „Entscheidet sich selbst“.
create function tests.poll3(p_name text, p_auto boolean, p_options jsonb default null) returns void
language plpgsql as $$
begin
  perform tests.set_var(p_name, public.create_poll(tests.var('crew')::uuid, 'Was geht ' || p_name || '?', now() + interval '1 day',
    coalesce(p_options, jsonb_build_array(
      jsonb_build_object('title', 'Bowling', 'proposed_date', tests.var('d1'), 'proposed_time', '20:00'),
      jsonb_build_object('title', 'Kino', 'proposed_date', tests.var('d2')),
      jsonb_build_object('title', 'Minigolf', 'proposed_date', tests.var('d2')))))::text);
  perform tests.set_var(p_name || '_a', (select id::text from public.poll_options where poll_id = tests.var(p_name)::uuid and position = 0));
  perform tests.set_var(p_name || '_b', (select id::text from public.poll_options where poll_id = tests.var(p_name)::uuid and position = 1));
  perform tests.set_var(p_name || '_c', (select id::text from public.poll_options where poll_id = tests.var(p_name)::uuid and position = 2));
  if p_auto then
    perform public.set_poll_auto_decide(tests.var(p_name)::uuid, true);
  end if;
end $$;
grant execute on function tests.poll3(text, boolean, jsonb) to authenticated;

-- Gleichstand A/B (Alice bei A, Bob bei B), C ohne Zusage; danach Frist vorbei.
create function tests.tie(p_name text) returns void
language plpgsql as $$
begin
  perform tests.login('alice');
  perform public.cast_vote(tests.var(p_name || '_a')::uuid, 'yes');
  perform tests.login('bob');
  perform public.cast_vote(tests.var(p_name || '_b')::uuid, 'yes');
  perform tests.logout();
  update public.polls set ends_at = now() - interval '1 second' where id = tests.var(p_name)::uuid;
end $$;

-- ---- Rechte -----------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'app_private.on_poll_closed_auto_runoff()', 'execute'), 'anon kann die Trigger-Funktion nicht aufrufen');
select ok(not has_function_privilege('authenticated', 'app_private.on_poll_closed_auto_runoff()', 'execute'), 'Angemeldete auch nicht');
select ok((select 'search_path=""' = any(proconfig) from pg_proc where oid = 'app_private.on_poll_closed_auto_runoff()'::regprocedure), 'search_path ist leer');

-- ---- Gleichstand bei Fristende → Stichwahl startet von selbst ---------------------------------
select tests.login('alice');
select tests.poll3('tie', true);
select public.set_poll_guests(tests.var('tie')::uuid, true);
select tests.logout();
select tests.tie('tie');
select tests.login('carol');
select is(public.finalize_due_poll(tests.var('tie')::uuid), true, 'ein Mitglied stellt das Ergebnis fest');
select tests.logout();
select is((select status::text || ' ' || is_tie::text from public.polls where id = tests.var('tie')::uuid), 'closed true', 'Gleichstand');
select is((select count(*)::int from public.polls where parent_poll_id = tests.var('tie')::uuid), 1, 'genau eine Stichwahl ist von selbst gestartet');
select tests.set_var('runoff', (select id::text from public.polls where parent_poll_id = tests.var('tie')::uuid));
select is((select title || ' | ' || status::text || ' | ' || created_by::text || ' | ' || kind::text from public.polls where id = tests.var('runoff')::uuid),
  'Stichwahl: Was geht tie? | open | ' || tests.uid('alice')::text || ' | place', 'Titel, offen, im Namen der Ersteller:in, Orts-Abstimmung');
select is((select ends_at from public.polls where id = tests.var('runoff')::uuid), date_trunc('minute', now() + interval '24 hours'),
  'Frist 24 Stunden (Termine liegen weiter weg)');
select is((select string_agg(title, ',' order by position) from public.poll_options where poll_id = tests.var('runoff')::uuid), 'Bowling,Kino',
  'nur die gleichauf liegenden Vorschläge, Minigolf ohne Zusage fällt weg');
select is((select proposed_date::text || ' ' || coalesce(proposed_time::text, '-') from public.poll_options where poll_id = tests.var('runoff')::uuid and title = 'Bowling'),
  tests.var('d1') || ' 20:00:00', 'Termine werden übernommen');
select is((select auto_decide::text || ' ' || guests_allowed::text from public.polls where id = tests.var('runoff')::uuid), 'true true',
  'Schalter „Entscheidet sich selbst“ und Gäste werden übernommen');
select is((select count(*)::int from public.notifications n where n.related_entity_id = tests.var('runoff')::uuid and n.type = 'poll_created'
           and (n.payload ->> 'auto')::boolean and (n.payload ->> 'runoff')::boolean), 3, 'die ganze Crew bekommt Bescheid, auch die Ersteller:in');
select is((select count(*)::int from public.audit_log where entity_id = tests.var('runoff')::uuid and action = 'poll_runoff_started' and actor_id is null), 1, 'Audit-Eintrag ohne Person');
select is((select count(*)::int from public.plans where poll_id = tests.var('tie')::uuid), 0, 'kein Plan aus dem Gleichstand');

select tests.login('alice');
select throws_ok(format($$ select public.start_runoff_poll(%L, 'Noch eine Stichwahl', now() + interval '1 day') $$, tests.var('tie')),
  'P0001', 'runoff_exists', 'von Hand keine zweite Stichwahl');
select tests.login('mallory');
select is((select count(*)::int from public.polls where id = tests.var('runoff')::uuid), 0, 'Außenstehende sehen die Stichwahl nicht');
select is((select count(*)::int from public.poll_options where poll_id = tests.var('runoff')::uuid), 0, '… und ihre Vorschläge nicht');
select tests.logout();

-- Die Stichwahl entscheidet sich wie gewohnt: Carol bringt die Mehrheit für Bowling.
select tests.login('alice');
select public.cast_vote((select id from public.poll_options where poll_id = tests.var('runoff')::uuid and title = 'Bowling'), 'yes');
select public.cast_vote((select id from public.poll_options where poll_id = tests.var('runoff')::uuid and title = 'Kino'), 'no');
select tests.login('carol');
select public.cast_vote((select id from public.poll_options where poll_id = tests.var('runoff')::uuid and title = 'Bowling'), 'yes');
select public.cast_vote((select id from public.poll_options where poll_id = tests.var('runoff')::uuid and title = 'Kino'), 'no');
select tests.logout();
select is((select status::text from public.polls where id = tests.var('runoff')::uuid), 'closed', 'Stichwahl ist mit klarer Mehrheit entschieden');
select is((select title from public.plans where poll_id = tests.var('runoff')::uuid), 'Bowling', '… und der Plan steht');

-- ---- Stichwahl endet wieder unentschieden → keine Kette ----------------------------------------
select tests.login('alice');
select tests.poll3('again', true);
select tests.logout();
select tests.tie('again');
select tests.login('bob');
select public.finalize_due_poll(tests.var('again')::uuid);
select tests.logout();
select tests.set_var('again_r', (select id::text from public.polls where parent_poll_id = tests.var('again')::uuid));
select tests.login('alice');
select public.cast_vote((select id from public.poll_options where poll_id = tests.var('again_r')::uuid and title = 'Bowling'), 'yes');
select tests.login('bob');
select public.cast_vote((select id from public.poll_options where poll_id = tests.var('again_r')::uuid and title = 'Kino'), 'yes');
select tests.logout();
update public.polls set ends_at = now() - interval '1 second' where id = tests.var('again_r')::uuid;
select is(app_private.finalize_due_polls() >= 1, true, 'pg_cron-Funktion beendet die fällige Stichwahl');
select is((select is_tie from public.polls where id = tests.var('again_r')::uuid), true, 'Stichwahl wieder gleichauf');
select is((select count(*)::int from public.polls where parent_poll_id = tests.var('again_r')::uuid), 0, 'nach einer Stichwahl startet keine weitere von selbst');
select tests.login('alice');
select ok(public.start_runoff_poll(tests.var('again_r')::uuid, 'Letzte Runde', now() + interval '1 day') is not null, 'von Hand geht es weiter wie bisher');
select tests.logout();

-- ---- Kein Automatismus: ohne Schalter, von Hand beendet --------------------------------------
select tests.login('alice');
select tests.poll3('off', false);
select tests.logout();
select tests.tie('off');
select tests.login('bob');
select public.finalize_due_poll(tests.var('off')::uuid);
select tests.logout();
select is((select count(*)::int from public.polls where parent_poll_id = tests.var('off')::uuid), 0, 'ohne „Entscheidet sich selbst“ keine automatische Stichwahl');

select tests.login('alice');
select tests.poll3('hand', true);
select public.cast_vote(tests.var('hand_a')::uuid, 'yes');
select tests.login('bob');
select public.cast_vote(tests.var('hand_b')::uuid, 'yes');
select tests.login('alice');
select public.close_poll(tests.var('hand')::uuid);
select tests.logout();
select is((select is_tie from public.polls where id = tests.var('hand')::uuid), true, 'von Hand beendet mit Gleichstand …');
select is((select count(*)::int from public.polls where parent_poll_id = tests.var('hand')::uuid), 0, '… startet keine Stichwahl von selbst');

-- ---- Frist vor dem frühesten Termin -----------------------------------------------------------
select tests.set_var('soon3', to_char((now() + interval '3 hours') at time zone 'Europe/Berlin', 'YYYY-MM-DD HH24:MI'));
select tests.login('alice');
select tests.poll3('near', true, jsonb_build_array(
  jsonb_build_object('title', 'Bar', 'proposed_date', left(tests.var('soon3'), 10), 'proposed_time', right(tests.var('soon3'), 5)),
  jsonb_build_object('title', 'Kino', 'proposed_date', tests.var('d2')),
  jsonb_build_object('title', 'Minigolf', 'proposed_date', tests.var('d2'))));
select tests.logout();
select tests.tie('near');
select tests.login('carol');
select public.finalize_due_poll(tests.var('near')::uuid);
select tests.logout();
select is((select ends_at from public.polls where parent_poll_id = tests.var('near')::uuid),
  date_trunc('minute', (tests.var('soon3')::timestamp at time zone 'Europe/Berlin') - interval '30 minutes'),
  'Stichwahl endet 30 Minuten vor dem frühesten Termin (in Berliner Zeit)');

select tests.set_var('soon', to_char((now() + interval '50 minutes') at time zone 'Europe/Berlin', 'YYYY-MM-DD HH24:MI'));
select tests.login('alice');
select tests.poll3('late', true, jsonb_build_array(
  jsonb_build_object('title', 'Bar', 'proposed_date', left(tests.var('soon'), 10), 'proposed_time', right(tests.var('soon'), 5)),
  jsonb_build_object('title', 'Kino', 'proposed_date', tests.var('d2')),
  jsonb_build_object('title', 'Minigolf', 'proposed_date', tests.var('d2'))));
select tests.logout();
select tests.tie('late');
select tests.login('carol');
select public.finalize_due_poll(tests.var('late')::uuid);
select tests.logout();
select is((select count(*)::int from public.polls where parent_poll_id = tests.var('late')::uuid), 0,
  'bleiben keine 30 Minuten bis 30 Minuten vor dem Termin, startet nichts von selbst');
select tests.login('alice');
select ok(public.start_runoff_poll(tests.var('late')::uuid, 'Schnell: Bar oder Kino', now() + interval '20 minutes') is not null, 'von Hand geht es trotzdem');
select tests.logout();

select * from finish();
rollback;
