-- P39: „Noch einen Tag?“ – `extend_poll` verlängert die Frist einer laufenden Abstimmung.
-- Nur wer sie gestartet hat oder Owner/Admin ist, nur solange sie läuft, nur nach hinten, höchstens 14 Tage,
-- spätestens 30 Minuten vor dem frühesten Termin, nicht in einer laufenden Serie. Danach ist die
-- Endspurt-Erinnerung wieder fällig und wer noch nicht abgestimmt hat, bekommt einmal Bescheid.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');   -- Owner
select tests.make_user('Bob');     -- Mitglied, startet eine Abstimmung
select tests.make_user('Carol');   -- Mitglied
select tests.make_user('Dave');    -- Admin
select tests.make_user('Mallory'); -- Außenstehende

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew')::text);
select tests.set_var('token', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob'); select public.accept_crew_invitation(tests.var('token'));
select tests.login('carol'); select public.accept_crew_invitation(tests.var('token'));
select tests.login('dave'); select public.accept_crew_invitation(tests.var('token'));
select tests.login('alice');
select public.set_crew_member_role(tests.var('crew')::uuid, tests.uid('dave'), 'admin');
select tests.login('mallory');
select tests.set_var('mallory_crew', public.create_crew('Fremde Crew')::text);

select tests.login('bob');
select tests.set_var('poll', public.create_poll(tests.var('crew')::uuid, 'Was geht am Freitag?', now() + interval '1 day',
  '[{"title":"Bowling"},{"title":"Kino"}]')::text);
select tests.set_var('ends', (select ends_at::text from public.polls where id = tests.var('poll')::uuid));
select public.cast_vote((select id from public.poll_options where poll_id = tests.var('poll')::uuid and title = 'Bowling'), 'yes');
select tests.login('carol');
select public.cast_vote((select id from public.poll_options where poll_id = tests.var('poll')::uuid and title = 'Kino'), 'maybe');

-- ---- Rechte und Angriffe -----------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.extend_poll(uuid, timestamptz)', 'execute'), 'anon darf nicht');
select ok(has_function_privilege('authenticated', 'public.extend_poll(uuid, timestamptz)', 'execute'), 'angemeldete Personen dürfen aufrufen');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.extend_poll(uuid, timestamptz)'::regprocedure),
  'SECURITY DEFINER mit leerem search_path');

select tests.login_anon();
select throws_ok(format($$ select public.extend_poll(%L, now() + interval '2 days') $$, tests.var('poll')), '42501', null, 'anon scheitert');
select tests.login('mallory');
select throws_ok(format($$ select public.extend_poll(%L, now() + interval '2 days') $$, tests.var('poll')), '42501', 'forbidden', 'Außenstehende scheitern');
select throws_ok(format($$ select public.extend_poll(%L, now() + interval '2 days') $$, gen_random_uuid()), '42501', 'forbidden', 'unbekannte Abstimmung sieht aus wie eine fremde');
select tests.login('carol');
select throws_ok(format($$ select public.extend_poll(%L, now() + interval '2 days') $$, tests.var('poll')), '42501', 'forbidden',
  'einfache Mitglieder dürfen fremde Abstimmungen nicht verlängern');
select tests.logout();
select is((select ends_at::text from public.polls where id = tests.var('poll')::uuid), tests.var('ends'), 'Angriffe haben die Frist nicht verändert');

-- ---- Grenzen -----------------------------------------------------------------------------------------
select tests.login('bob');
select throws_ok(format($$ select public.extend_poll(%L, %L::timestamptz) $$, tests.var('poll'), tests.var('ends')), 'P0001', 'poll_extend_not_later', 'gleiche Frist ist keine Verlängerung');
select throws_ok(format($$ select public.extend_poll(%L, now() + interval '2 hours') $$, tests.var('poll')), 'P0001', 'poll_extend_not_later', 'früher geht nicht (dafür gibt es „beenden“)');
select throws_ok(format($$ select public.extend_poll(%L, null) $$, tests.var('poll')), 'P0001', 'poll_extend_not_later', 'ohne neue Frist nichts');
select throws_ok(format($$ select public.extend_poll(%L, now() + interval '15 days') $$, tests.var('poll')), 'P0001', 'poll_extend_too_far', 'höchstens 14 Tage');

-- ---- Verlängern: Ersteller, Frist, Erinnerungen ------------------------------------------------------
-- Endspurt-Erinnerung (P15) für Dave war schon raus – zur neuen Frist ist sie wieder fällig.
select tests.logout();
insert into public.poll_closing_reminders (poll_id, user_id) values (tests.var('poll')::uuid, tests.uid('dave'));
select tests.login('bob');
select is(public.extend_poll(tests.var('poll')::uuid, now() + interval '2 days 30 seconds'), date_trunc('minute', now() + interval '2 days 30 seconds'),
  'Bob verlängert seine Abstimmung um einen Tag – auf die Minute');
select tests.logout();
select is((select ends_at from public.polls where id = tests.var('poll')::uuid), date_trunc('minute', now() + interval '2 days 30 seconds'), 'neue Frist gespeichert');
select is((select status::text from public.polls where id = tests.var('poll')::uuid), 'open', 'Abstimmung läuft weiter');
select is((select count(*)::int from public.poll_votes where poll_id = tests.var('poll')::uuid), 2, 'alle Stimmen bleiben');
select is((select count(*)::int from public.poll_closing_reminders where poll_id = tests.var('poll')::uuid), 0, 'Endspurt-Erinnerung wieder fällig');
select is((select string_agg(p.display_name, ',' order by p.display_name) from public.notifications n join public.profiles p on p.id = n.user_id
           where n.type = 'poll_reminder' and n.related_entity_id = tests.var('poll')::uuid and (n.payload ->> 'extended')::boolean),
  'Alice,Dave', 'Bescheid nur an die, die noch nicht abgestimmt haben (nicht Bob selbst, nicht Carol)');
select is((select (payload ->> 'ends_at')::timestamptz from public.notifications where type = 'poll_reminder' and user_id = tests.uid('alice') and related_entity_id = tests.var('poll')::uuid),
  date_trunc('minute', now() + interval '2 days 30 seconds'), 'Hinweis nennt die neue Frist');
select is((select actor_id from public.notifications where type = 'poll_reminder' and user_id = tests.uid('alice') and related_entity_id = tests.var('poll')::uuid),
  tests.uid('bob'), 'Bob steht als auslösende Person dabei');

-- Wer „Erinnerungen“ abgeschaltet hat, bekommt nichts; gleiche Frist zweimal – nur ein Hinweis.
select tests.logout();
insert into public.user_settings (user_id, notification_preferences) values (tests.uid('dave'), '{"poll_reminder": false}')
on conflict (user_id) do update set notification_preferences = excluded.notification_preferences;
select tests.login('alice');
select ok(public.extend_poll(tests.var('poll')::uuid, now() + interval '3 days') is not null, 'Owner darf fremde Abstimmungen verlängern');
select tests.login('dave');
select ok(public.extend_poll(tests.var('poll')::uuid, now() + interval '4 days') is not null, 'Admin darf fremde Abstimmungen verlängern');
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'poll_reminder' and user_id = tests.uid('dave') and related_entity_id = tests.var('poll')::uuid), 1,
  'Dave hat „Erinnerungen“ abgeschaltet – nach der ersten Verlängerung kein weiterer Hinweis');
select is((select string_agg(p.display_name, ',' order by n.created_at, p.display_name) from public.notifications n join public.profiles p on p.id = n.actor_id
           where n.type = 'poll_reminder' and n.user_id = tests.uid('alice') and n.related_entity_id = tests.var('poll')::uuid),
  'Bob,Dave', 'Alice bekommt die Hinweise von Bob und Dave, keinen über ihre eigene Verlängerung');
select is((select count(*)::int from public.notifications where type = 'poll_reminder' and user_id = tests.uid('bob') and related_entity_id = tests.var('poll')::uuid), 0,
  'Bob hat abgestimmt – kein Hinweis');

-- ---- Termine: spätestens 30 Minuten vor dem frühesten bevorstehenden ---------------------------------
select tests.login('bob');
select tests.set_var('dated', public.create_poll(tests.var('crew')::uuid, 'Wann?', now() + interval '1 hour',
  format('[{"title":"Früh","proposed_date":"%s","proposed_time":"%s"},{"title":"Später","proposed_date":"%s"},{"title":"Vorbei","proposed_date":"%s"}]',
    to_char((now() + interval '1 day') at time zone 'Europe/Berlin', 'YYYY-MM-DD'),
    to_char((now() + interval '1 day') at time zone 'Europe/Berlin', 'HH24:MI'),
    to_char((now() + interval '5 days') at time zone 'Europe/Berlin', 'YYYY-MM-DD'),
    to_char((now() - interval '3 days') at time zone 'Europe/Berlin', 'YYYY-MM-DD'))::jsonb)::text);
select throws_ok(format($$ select public.extend_poll(%L, now() + interval '1 day' - interval '20 minutes') $$, tests.var('dated')), 'P0001', 'poll_extend_too_late',
  'nicht näher als 30 Minuten an den frühesten Termin');
select ok(public.extend_poll(tests.var('dated')::uuid, now() + interval '1 day' - interval '40 minutes') is not null,
  'bis 30 Minuten vorher geht – ein Vorschlag in der Vergangenheit zählt nicht');

-- ---- Serie „Jede Woche neu“ ---------------------------------------------------------------------------
select tests.login('alice');
select tests.set_var('weekly', public.create_poll(tests.var('crew')::uuid, 'Freitag, was geht?', now() + interval '1 day', '[{"title":"Bar"},{"title":"Kino"}]')::text);
select public.set_poll_repeat(tests.var('weekly')::uuid, true);
select throws_ok(format($$ select public.extend_poll(%L, now() + interval '2 days') $$, tests.var('weekly')), 'P0001', 'poll_extend_series',
  'laufende Serie: verlängern würde jede weitere Runde verschieben');
select public.set_poll_repeat(tests.var('weekly')::uuid, false);
select ok(public.extend_poll(tests.var('weekly')::uuid, now() + interval '2 days') is not null, 'Serie beendet – dann geht es');

-- ---- Nach dem Ende -----------------------------------------------------------------------------------
select tests.set_var('done', public.create_poll(tests.var('crew')::uuid, 'Vorbei?', now() + interval '1 day', '[{"title":"Eins"},{"title":"Zwei"}]')::text);
select public.close_poll(tests.var('done')::uuid);
select throws_ok(format($$ select public.extend_poll(%L, now() + interval '2 days') $$, tests.var('done')), 'P0001', 'poll_closed', 'beendete Abstimmung lässt sich nicht verlängern');
select tests.set_var('due', public.create_poll(tests.var('crew')::uuid, 'Abgelaufen?', now() + interval '1 day', '[{"title":"Eins"},{"title":"Zwei"}]')::text);
select tests.logout();
update public.polls set ends_at = now() - interval '1 minute', created_at = now() - interval '1 hour' where id = tests.var('due')::uuid;
select tests.login('alice');
select throws_ok(format($$ select public.extend_poll(%L, now() + interval '2 days') $$, tests.var('due')), 'P0001', 'poll_closed',
  'Frist abgelaufen: nicht mehr verlängern, auch wenn der Status noch offen ist');

-- ---- Rate Limit --------------------------------------------------------------------------------------
select tests.set_var('many', public.create_poll(tests.var('crew')::uuid, 'Oft?', now() + interval '1 day', '[{"title":"Eins"},{"title":"Zwei"}]')::text);
select tests.logout();
delete from public.rate_limit_hits where action = 'poll_extend';
select tests.login('alice');
select public.extend_poll(tests.var('many')::uuid, now() + make_interval(days => 1, hours => i)) from generate_series(1, 10) i;
select throws_ok(format($$ select public.extend_poll(%L, now() + interval '3 days') $$, tests.var('many')), 'P0001', 'rate_limited', 'höchstens 10 Verlängerungen je Stunde');

select * from finish();
rollback;
