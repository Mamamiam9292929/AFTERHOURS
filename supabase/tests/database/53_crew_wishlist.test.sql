-- P22: „Wollen wir mal hin“ – Merkliste der Crew nur über RPCs; sichtbar nur für Mitglieder; merken darf jedes
-- Mitglied (doppelt = einmal), entfernen nur, wer gemerkt hat, Owner und Admins; nicht für Außenstehende,
-- ehemalige Mitglieder oder anon; inaktive und unbekannte Orte abgewiesen; Grenze 50; Export, Austritt, Konto.
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

select tests.logout();
insert into public.activities (provider_id, external_id, name, category, city, data_source) values
  ('manual', 'wunsch-bowling', 'Bowling am Ring', 'bowling', 'Leipzig', 'manual'),
  ('manual', 'wunsch-kart', 'Kartbahn Nord', 'karting', 'Leipzig', 'manual'),
  ('manual', 'wunsch-zu', 'Geschlossene Bar', 'bar', 'Leipzig', 'manual');
select tests.set_var('bowling', (select id::text from public.activities where external_id = 'wunsch-bowling'));
select tests.set_var('kart', (select id::text from public.activities where external_id = 'wunsch-kart'));
select tests.set_var('closed', (select id::text from public.activities where external_id = 'wunsch-zu'));
update public.activities set is_active = false where external_id = 'wunsch-zu';

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_table_privilege('authenticated', 'public.crew_wishes', 'select'), 'Merkliste ist nicht direkt lesbar');
select ok(not has_table_privilege('authenticated', 'public.crew_wishes', 'insert'), 'Merkliste ist nicht direkt beschreibbar');
select ok(not has_table_privilege('authenticated', 'public.crew_wishes', 'delete'), 'Merkliste ist nicht direkt löschbar');
select ok(not has_table_privilege('anon', 'public.crew_wishes', 'select'), 'anon liest keine Merkliste');
select ok(not has_function_privilege('anon', 'public.add_crew_wish(uuid, uuid)', 'execute'), 'anon merkt nichts');
select ok(not has_function_privilege('anon', 'public.remove_crew_wish(uuid, uuid)', 'execute'), 'anon entfernt nichts');
select ok(not has_function_privilege('anon', 'public.crew_wishes(uuid)', 'execute'), 'anon liest keine Merkliste');
select ok(not has_function_privilege('anon', 'public.my_wish_crews(uuid)', 'execute'), 'anon fragt keine Listen ab');
select ok(has_function_privilege('authenticated', 'public.crew_wishes(uuid)', 'execute'), 'angemeldete Personen dürfen die Funktion aufrufen');

-- ---- Merken ------------------------------------------------------------------------------------
select tests.login('bob');
select is((select count(*)::int from public.crew_wishes(tests.var('crew')::uuid)), 0, 'neue Crew: Liste leer');
select tests.set_var('wish', public.add_crew_wish(tests.var('crew')::uuid, tests.var('bowling')::uuid)::text);
select is(public.add_crew_wish(tests.var('crew')::uuid, tests.var('bowling')::uuid)::text, tests.var('wish'), 'doppelt merken: derselbe Eintrag');
select is((select count(*)::int from public.crew_wishes(tests.var('crew')::uuid)), 1, 'steht einmal auf der Liste');
select is((select array[name, city, category::text] from public.crew_wishes(tests.var('crew')::uuid)), array['Bowling am Ring', 'Leipzig', 'bowling'], 'mit Name, Stadt und Kategorie');
select is((select added_by from public.crew_wishes(tests.var('crew')::uuid)), tests.uid('bob'), 'mit Person');
select ok((select can_remove from public.crew_wishes(tests.var('crew')::uuid)), 'Bob darf seinen Eintrag entfernen');
select is((select array_agg(crew_id) from public.my_wish_crews(tests.var('bowling')::uuid)), array[tests.var('crew')::uuid], 'Ortsseite: steht auf der Liste der Crew');

select throws_ok($$ select public.add_crew_wish(tests.var('crew')::uuid, tests.var('closed')::uuid) $$, 'P0001', 'unknown_activity', 'inaktiver Ort wird abgewiesen');
select throws_ok($$ select public.add_crew_wish(tests.var('crew')::uuid, gen_random_uuid()) $$, 'P0001', 'unknown_activity', 'unbekannter Ort wird abgewiesen');
select throws_ok($$ select public.add_crew_wish(tests.var('mallory_crew')::uuid, tests.var('kart')::uuid) $$, '42501', 'forbidden', 'in fremde Crew merken: verboten');

-- Alles in einer Transaktion hat dieselbe Zeit: Bobs Eintrag liegt eine Stunde zurück.
select tests.logout();
update public.crew_wishes set created_at = now() - interval '1 hour' where id = tests.var('wish')::uuid;
select tests.login('carol');
select lives_ok($$ select public.add_crew_wish(tests.var('crew')::uuid, tests.var('kart')::uuid) $$, 'Carol merkt die Kartbahn');
select is((select array_agg(name order by created_at desc) from public.crew_wishes(tests.var('crew')::uuid)), array['Kartbahn Nord', 'Bowling am Ring'], 'neueste zuerst');
select ok(not (select can_remove from public.crew_wishes(tests.var('crew')::uuid) where activity_id = tests.var('bowling')::uuid), 'Carol darf Bobs Eintrag nicht entfernen');
select throws_ok($$ select public.remove_crew_wish(tests.var('crew')::uuid, tests.var('bowling')::uuid) $$, '42501', 'forbidden', 'fremden Eintrag entfernen: verboten');
select lives_ok($$ select public.remove_crew_wish(tests.var('crew')::uuid, gen_random_uuid()) $$, 'Ort nicht auf der Liste: kein Fehler');

-- ---- Außenstehende und anon ----------------------------------------------------------------------
select tests.login('mallory');
select throws_ok($$ select * from public.crew_wishes(tests.var('crew')::uuid) $$, '42501', 'forbidden', 'Außenstehende lesen keine Merkliste');
select throws_ok($$ select * from public.crew_wishes(gen_random_uuid()) $$, '42501', 'forbidden', 'unbekannte Crew verrät nichts');
select throws_ok($$ select public.add_crew_wish(tests.var('crew')::uuid, tests.var('kart')::uuid) $$, '42501', 'forbidden', 'Außenstehende merken nichts');
select throws_ok($$ select public.remove_crew_wish(tests.var('crew')::uuid, tests.var('bowling')::uuid) $$, '42501', 'forbidden', 'Außenstehende entfernen nichts');
select is((select count(*)::int from public.my_wish_crews(tests.var('bowling')::uuid)), 0, 'Ortsseite verrät Außenstehenden keine fremden Crews');
select tests.logout();
select is((select count(*)::int from public.crew_wishes where crew_id = tests.var('crew')::uuid), 2, 'Liste unverändert');

select tests.login_anon();
select throws_ok($$ select * from public.crew_wishes(tests.var('crew')::uuid) $$, '42501', null, 'anon liest keine Merkliste');
select throws_ok($$ select public.add_crew_wish(tests.var('crew')::uuid, tests.var('kart')::uuid) $$, '42501', null, 'anon merkt nichts');

-- ---- Owner entfernt ------------------------------------------------------------------------------
select tests.login('alice');
select ok((select bool_and(can_remove) from public.crew_wishes(tests.var('crew')::uuid)), 'Owner darf alles entfernen');
select lives_ok($$ select public.remove_crew_wish(tests.var('crew')::uuid, tests.var('kart')::uuid) $$, 'Alice nimmt die Kartbahn runter');
select is((select array_agg(name) from public.crew_wishes(tests.var('crew')::uuid)), array['Bowling am Ring'], 'Kartbahn ist weg');

-- Ein inaktiv gewordener Ort verschwindet von der Liste.
select tests.login('carol');
select lives_ok($$ select public.add_crew_wish(tests.var('crew')::uuid, tests.var('kart')::uuid) $$, 'Carol merkt die Kartbahn noch einmal');
select tests.logout();
update public.activities set is_active = false where id = tests.var('kart')::uuid;
select tests.login('bob');
select is((select count(*)::int from public.crew_wishes(tests.var('crew')::uuid)), 1, 'inaktiver Ort steht nicht mehr da');
select tests.logout();
update public.activities set is_active = true where id = tests.var('kart')::uuid;

-- ---- Grenze ------------------------------------------------------------------------------------
select tests.logout();
insert into public.activities (provider_id, external_id, name, category, city, data_source)
  select 'manual', 'wunsch-' || g, 'Ort Nummer ' || g, 'bar', 'Leipzig', 'manual' from generate_series(1, 49) g;
insert into public.crew_wishes (crew_id, activity_id, added_by)
  select tests.var('crew')::uuid, a.id, tests.uid('alice') from public.activities a where a.external_id ~ '^wunsch-\d+$' and a.external_id <> 'wunsch-49';
select is((select count(*)::int from public.crew_wishes where crew_id = tests.var('crew')::uuid), 50, '50 Orte auf der Liste');
select tests.login('bob');
select throws_ok($$ select public.add_crew_wish(tests.var('crew')::uuid, (select id from public.activities where external_id = 'wunsch-49')) $$,
                 'P0001', 'crew_wishlist_full', 'der 51. wird abgewiesen');
select lives_ok($$ select public.add_crew_wish(tests.var('crew')::uuid, tests.var('bowling')::uuid) $$, 'schon Gemerktes geht trotz voller Liste');

-- ---- Export, Austritt, Konto ----------------------------------------------------------------------
select is(jsonb_array_length(public.export_my_data() -> 'crew_wishes'), 1, 'Export enthält Bobs gemerkten Ort');
select is(public.export_my_data() -> 'crew_wishes' -> 0 ->> 'place', 'Bowling am Ring', 'mit Namen des Orts');

select lives_ok($$ select public.leave_crew(tests.var('crew')::uuid) $$, 'Bob verlässt die Crew');
select throws_ok($$ select * from public.crew_wishes(tests.var('crew')::uuid) $$, '42501', 'forbidden', 'ehemalige Mitglieder lesen nichts mehr');
select is((select count(*)::int from public.my_wish_crews(tests.var('bowling')::uuid)), 0, 'ehemalige Mitglieder sehen die Liste auch auf der Ortsseite nicht');
select tests.login('alice');
select is((select added_by from public.crew_wishes(tests.var('crew')::uuid) where activity_id = tests.var('bowling')::uuid), null::uuid, 'nach dem Austritt: Eintrag bleibt, ohne Person');

select tests.login('carol');
select lives_ok($$ select public.delete_my_account('DELETE') $$, 'Carol löscht ihr Konto');
select tests.logout();
select is((select added_by from public.crew_wishes where crew_id = tests.var('crew')::uuid and activity_id = tests.var('kart')::uuid), null::uuid, 'mit dem Konto ist die Person weg, der Ort bleibt für die Crew');

select tests.login('alice');
select lives_ok($$ delete from public.crews where id = tests.var('crew')::uuid $$, 'Alice löscht die Crew');
select tests.logout();
select is((select count(*)::int from public.crew_wishes where crew_id = tests.var('crew')::uuid), 0, 'mit der Crew ist die Liste weg');

select * from finish();
rollback;
