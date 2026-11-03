-- P20: Geburtstage in der Crew – nur Tag und Monat, nur über RPCs; sichtbar nur für Mitglieder derselben
-- Crew, nicht für Außenstehende, ehemalige Mitglieder oder anon; ungültige Tage abgewiesen; Entfernen,
-- Export und Kontolöschung.
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

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_table_privilege('authenticated', 'public.birthdays', 'select'), 'Geburtstage sind nicht direkt lesbar');
select ok(not has_table_privilege('authenticated', 'public.birthdays', 'insert'), 'Geburtstage sind nicht direkt beschreibbar');
select ok(not has_table_privilege('anon', 'public.birthdays', 'select'), 'anon liest keine Geburtstage');
select ok(not has_function_privilege('anon', 'public.set_my_birthday(integer, integer)', 'execute'), 'anon setzt keinen Geburtstag');
select ok(not has_function_privilege('anon', 'public.crew_birthdays(uuid)', 'execute'), 'anon liest keine Geburtstage einer Crew');
select ok(not has_function_privilege('anon', 'public.my_birthday()', 'execute'), 'anon hat keinen eigenen Geburtstag');
select ok(has_function_privilege('authenticated', 'public.crew_birthdays(uuid)', 'execute'), 'angemeldete Personen dürfen die Funktion aufrufen');

-- ---- Eintragen ---------------------------------------------------------------------------------
select tests.login('bob');
select is((select count(*)::int from public.my_birthday()), 0, 'ohne Eintrag kein Geburtstag');
select lives_ok($$ select public.set_my_birthday(11, 14) $$, 'Bob trägt den 14. November ein');
select is((select array[month, day] from public.my_birthday()), array[11, 14], 'Bob sieht seinen Geburtstag');
select lives_ok($$ select public.set_my_birthday(11, 15) $$, 'Bob ändert ihn');
select is((select array[month, day] from public.my_birthday()), array[11, 15], 'geändert, nicht doppelt');
select throws_ok($$ select public.set_my_birthday(4, 31) $$, 'P0001', 'invalid_birthday', '31. April gibt es nicht');
select throws_ok($$ select public.set_my_birthday(2, 30) $$, 'P0001', 'invalid_birthday', '30. Februar gibt es nicht');
select throws_ok($$ select public.set_my_birthday(13, 1) $$, 'P0001', 'invalid_birthday', 'Monat 13 gibt es nicht');
select throws_ok($$ select public.set_my_birthday(0, 1) $$, 'P0001', 'invalid_birthday', 'Monat 0 gibt es nicht');
select throws_ok($$ select public.set_my_birthday(5, 0) $$, 'P0001', 'invalid_birthday', 'Tag 0 gibt es nicht');
select throws_ok($$ select public.set_my_birthday(5, null) $$, 'P0001', 'invalid_birthday', 'nur der Monat reicht nicht');
select is((select array[month, day] from public.my_birthday()), array[11, 15], 'ungültige Eingaben ändern nichts');

select tests.login('carol');
select lives_ok($$ select public.set_my_birthday(2, 29) $$, 'Carol hat am 29. Februar Geburtstag');

select tests.login('mallory');
select lives_ok($$ select public.set_my_birthday(1, 1) $$, 'Mallory trägt einen Geburtstag ein');

-- ---- Sehen -------------------------------------------------------------------------------------
select tests.login('alice');
select is((select array_agg(user_id order by month, day) from public.crew_birthdays(tests.var('crew')::uuid)),
          array[tests.uid('carol'), tests.uid('bob')], 'Alice sieht Carol und Bob (nach Datum), sich selbst ohne Eintrag nicht');
select is((select array[month, day] from public.crew_birthdays(tests.var('crew')::uuid) where user_id = tests.uid('bob')), array[11, 15], 'mit Tag und Monat');
select ok((select bool_and(user_id <> tests.uid('mallory')) from public.crew_birthdays(tests.var('crew')::uuid)), 'Mallory (andere Crew) taucht nicht auf');
select throws_ok($$ select * from public.crew_birthdays(tests.var('mallory_crew')::uuid) $$, '42501', 'forbidden', 'fremde Crew: verboten');

select tests.login('mallory');
select throws_ok($$ select * from public.crew_birthdays(tests.var('crew')::uuid) $$, '42501', 'forbidden', 'Außenstehende lesen keine Geburtstage');
select throws_ok($$ select * from public.crew_birthdays(gen_random_uuid()) $$, '42501', 'forbidden', 'unbekannte Crew verrät nichts');
select is((select count(*)::int from public.crew_birthdays(tests.var('mallory_crew')::uuid)), 1, 'in der eigenen Crew sieht Mallory nur sich');

select tests.login_anon();
select throws_ok($$ select * from public.crew_birthdays(tests.var('crew')::uuid) $$, '42501', null, 'anon liest keine Geburtstage');
select throws_ok($$ select public.set_my_birthday(1, 1) $$, '42501', null, 'anon setzt keinen Geburtstag');

-- ---- Export, Entfernen, Austritt, Konto ----------------------------------------------------------
select tests.login('bob');
select is(public.export_my_data() -> 'birthday' ->> 'day', '15', 'Export enthält den eigenen Geburtstag');
select ok(public.export_my_data()::text not like '%"day": 29%', 'Export enthält keine fremden Geburtstage');
select lives_ok($$ select public.set_my_birthday(null, null) $$, 'Bob entfernt seinen Geburtstag');
select is((select count(*)::int from public.my_birthday()), 0, 'entfernt');
select ok(public.export_my_data() -> 'birthday' = 'null'::jsonb, 'Export ohne Geburtstag');

select tests.login('carol');
select lives_ok($$ select public.leave_crew(tests.var('crew')::uuid) $$, 'Carol verlässt die Crew');
select throws_ok($$ select * from public.crew_birthdays(tests.var('crew')::uuid) $$, '42501', 'forbidden', 'ehemalige Mitglieder lesen nichts mehr');
select tests.login('alice');
select is((select count(*)::int from public.crew_birthdays(tests.var('crew')::uuid)), 0, 'nach dem Austritt sieht die Crew Carols Geburtstag nicht mehr');

select tests.login('mallory');
select lives_ok($$ select public.delete_my_account('DELETE') $$, 'Mallory löscht ihr Konto');
select tests.logout();
select is((select count(*)::int from public.birthdays where user_id = tests.uid('mallory')), 0, 'mit dem Konto ist der Geburtstag weg');

select * from finish();
rollback;
