-- P21: „Bin weg“ – Abwesenheiten nur über RPCs; sichtbar nur für Mitglieder derselben Crew und nur, solange
-- sie nicht vorbei sind; nicht für Außenstehende, ehemalige Mitglieder oder anon; ungültige Zeiträume und
-- mehr als 20 abgewiesen; fremde Einträge lassen sich nicht entfernen; Export und Kontolöschung.
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
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Bob tritt bei');
select tests.login('carol');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Carol tritt bei');
select tests.login('mallory');
select tests.set_var('mallory_crew', public.create_crew('Fremde Crew')::text);

select tests.set_var('today', ((now() at time zone 'Europe/Berlin')::date)::text);

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_table_privilege('authenticated', 'public.absences', 'select'), 'Abwesenheiten sind nicht direkt lesbar');
select ok(not has_table_privilege('authenticated', 'public.absences', 'insert'), 'Abwesenheiten sind nicht direkt beschreibbar');
select ok(not has_table_privilege('anon', 'public.absences', 'select'), 'anon liest keine Abwesenheiten');
select ok(not has_function_privilege('anon', 'public.add_my_absence(date, date)', 'execute'), 'anon trägt nichts ein');
select ok(not has_function_privilege('anon', 'public.remove_my_absence(uuid)', 'execute'), 'anon entfernt nichts');
select ok(not has_function_privilege('anon', 'public.my_absences()', 'execute'), 'anon hat keine eigenen');
select ok(not has_function_privilege('anon', 'public.crew_absences(uuid)', 'execute'), 'anon liest keine Abwesenheiten einer Crew');
select ok(has_function_privilege('authenticated', 'public.crew_absences(uuid)', 'execute'), 'angemeldete Personen dürfen die Funktion aufrufen');

-- ---- Eintragen ---------------------------------------------------------------------------------
select tests.login('bob');
select is((select count(*)::int from public.my_absences()), 0, 'ohne Eintrag keine Abwesenheit');
select tests.set_var('bob_trip', public.add_my_absence(tests.var('today')::date + 10, tests.var('today')::date + 20)::text);
select is((select array[starts_on, ends_on] from public.my_absences()), array[tests.var('today')::date + 10, tests.var('today')::date + 20], 'Bob sieht seinen Zeitraum');
select lives_ok($$ select public.add_my_absence(tests.var('today')::date + 3, tests.var('today')::date + 3) $$, 'ein einzelner Tag geht');
select is((select count(*)::int from public.my_absences()), 2, 'zwei Zeiträume');
select is((select starts_on from public.my_absences() order by starts_on limit 1), tests.var('today')::date + 3, 'nach Beginn sortiert');

select throws_ok($$ select public.add_my_absence(tests.var('today')::date + 5, tests.var('today')::date + 4) $$, 'P0001', 'invalid_absence', 'Ende vor Beginn');
select throws_ok($$ select public.add_my_absence(tests.var('today')::date - 5, tests.var('today')::date - 1) $$, 'P0001', 'invalid_absence', 'ganz in der Vergangenheit');
select throws_ok($$ select public.add_my_absence(tests.var('today')::date, tests.var('today')::date + 400) $$, 'P0001', 'invalid_absence', 'länger als ein Jahr');
select throws_ok($$ select public.add_my_absence(tests.var('today')::date + 800, tests.var('today')::date + 801) $$, 'P0001', 'invalid_absence', 'mehr als zwei Jahre voraus');
select throws_ok($$ select public.add_my_absence(null, tests.var('today')::date + 1) $$, 'P0001', 'invalid_absence', 'ohne Beginn');
select is((select count(*)::int from public.my_absences()), 2, 'ungültige Eingaben ändern nichts');

-- Hat schon begonnen: zählt ab heute.
select tests.login('carol');
select lives_ok($$ select public.add_my_absence(tests.var('today')::date - 2, tests.var('today')::date + 1) $$, 'Carol ist schon seit vorgestern weg');
select is((select starts_on from public.my_absences()), tests.var('today')::date, 'gespeichert ab heute');

select tests.login('mallory');
select lives_ok($$ select public.add_my_absence(tests.var('today')::date + 10, tests.var('today')::date + 12) $$, 'Mallory trägt etwas ein');

-- ---- Sehen -------------------------------------------------------------------------------------
select tests.login('alice');
select is((select count(*)::int from public.crew_absences(tests.var('crew')::uuid)), 3, 'Alice sieht Bobs zwei und Carols Zeitraum');
select is((select array_agg(user_id order by starts_on, user_id) from public.crew_absences(tests.var('crew')::uuid) where user_id = tests.uid('bob')),
          array[tests.uid('bob'), tests.uid('bob')], 'mit Person');
select ok((select bool_and(user_id <> tests.uid('mallory')) from public.crew_absences(tests.var('crew')::uuid)), 'Mallory (andere Crew) taucht nicht auf');
select throws_ok($$ select * from public.crew_absences(tests.var('mallory_crew')::uuid) $$, '42501', 'forbidden', 'fremde Crew: verboten');

select tests.login('mallory');
select throws_ok($$ select * from public.crew_absences(tests.var('crew')::uuid) $$, '42501', 'forbidden', 'Außenstehende lesen keine Abwesenheiten');
select throws_ok($$ select * from public.crew_absences(gen_random_uuid()) $$, '42501', 'forbidden', 'unbekannte Crew verrät nichts');
-- Mallory kennt die ID von Bobs Reise (geraten) – entfernen ändert nichts.
select lives_ok($$ select public.remove_my_absence(tests.var('bob_trip')::uuid) $$, 'fremde ID: kein Fehler, der etwas verrät');
select tests.logout();
select is((select count(*)::int from public.absences where id = tests.var('bob_trip')::uuid), 1, 'Bobs Reise ist noch da');

select tests.login_anon();
select throws_ok($$ select * from public.crew_absences(tests.var('crew')::uuid) $$, '42501', null, 'anon liest keine Abwesenheiten');
select throws_ok($$ select public.add_my_absence(current_date, current_date) $$, '42501', null, 'anon trägt nichts ein');

-- ---- Vergangenes ---------------------------------------------------------------------------------
-- Ein abgelaufener Zeitraum (direkt eingetragen) ist für niemanden mehr sichtbar und verschwindet beim nächsten Eintragen.
select tests.logout();
insert into public.absences (user_id, starts_on, ends_on) values (tests.uid('bob'), tests.var('today')::date - 10, tests.var('today')::date - 1);
select tests.login('alice');
select is((select count(*)::int from public.crew_absences(tests.var('crew')::uuid) where user_id = tests.uid('bob')), 2, 'Vorbei: nicht mehr sichtbar');
select tests.login('bob');
select is((select count(*)::int from public.my_absences()), 2, 'auch für Bob selbst nicht');
select lives_ok($$ select public.add_my_absence(tests.var('today')::date + 30, tests.var('today')::date + 31) $$, 'Bob trägt noch etwas ein');
select tests.logout();
select is((select count(*)::int from public.absences where user_id = tests.uid('bob') and ends_on < tests.var('today')::date), 0, 'Vergangenes ist dabei weggeräumt');

-- ---- Grenze ------------------------------------------------------------------------------------
select tests.login('carol');
select is((select count(public.add_my_absence(tests.var('today')::date + 40 + g, tests.var('today')::date + 40 + g))::int from generate_series(1, 19) g), 19, 'bis 20 Zeiträume gehen');
select throws_ok($$ select public.add_my_absence(tests.var('today')::date + 100, tests.var('today')::date + 100) $$, 'P0001', 'too_many_absences', 'der 21. wird abgewiesen');

-- ---- Export, Entfernen, Austritt, Konto ----------------------------------------------------------
select tests.login('bob');
select is(jsonb_array_length(public.export_my_data() -> 'absences'), 3, 'Export enthält die eigenen Zeiträume');
select lives_ok($$ select public.remove_my_absence(tests.var('bob_trip')::uuid) $$, 'Bob entfernt seine Reise');
select is((select count(*)::int from public.my_absences() where id = tests.var('bob_trip')::uuid), 0, 'entfernt');

select tests.login('carol');
select lives_ok($$ select public.leave_crew(tests.var('crew')::uuid) $$, 'Carol verlässt die Crew');
select throws_ok($$ select * from public.crew_absences(tests.var('crew')::uuid) $$, '42501', 'forbidden', 'ehemalige Mitglieder lesen nichts mehr');
select tests.login('alice');
select is((select count(*)::int from public.crew_absences(tests.var('crew')::uuid) where user_id = tests.uid('carol')), 0, 'nach dem Austritt sieht die Crew Carols Zeiträume nicht mehr');

select tests.login('mallory');
select lives_ok($$ select public.delete_my_account('DELETE') $$, 'Mallory löscht ihr Konto');
select tests.logout();
select is((select count(*)::int from public.absences where user_id = tests.uid('mallory')), 0, 'mit dem Konto sind die Zeiträume weg');

select * from finish();
rollback;
