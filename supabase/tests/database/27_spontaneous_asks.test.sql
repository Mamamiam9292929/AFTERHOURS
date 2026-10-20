-- „Heute noch wer?“ (Roadmap S4 Etappe 1): Spontan-Frage, zwei Antworten, verfällt nach 2 Stunden.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Carol');
select tests.make_user('Dave');
select tests.make_user('Mallory'); -- Außenstehende

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew')::text);
select tests.set_var('token', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob'); select public.accept_crew_invitation(tests.var('token'));
select tests.login('carol'); select public.accept_crew_invitation(tests.var('token'));
select tests.login('dave'); select public.accept_crew_invitation(tests.var('token'));
select tests.login('mallory');
select tests.set_var('other', public.create_crew('Mallorys Crew')::text);
select tests.logout();
delete from public.notifications;

-- ---- Rechte -----------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.ask_spontaneous(uuid, text)', 'execute'), 'anon darf nicht fragen');
select ok(not has_function_privilege('anon', 'public.answer_spontaneous(uuid, text)', 'execute'), 'anon darf nicht antworten');
select ok(not has_function_privilege('anon', 'public.close_spontaneous(uuid)', 'execute'), 'anon darf nicht beenden');
select ok(has_function_privilege('authenticated', 'public.ask_spontaneous(uuid, text)', 'execute'), 'Angemeldete dürfen fragen');
select ok(not has_function_privilege('authenticated', 'app_private.spontaneous_open(public.spontaneous_asks)', 'execute'), 'Hilfsfunktion ist privat');
select ok(not has_table_privilege('authenticated', 'public.spontaneous_asks', 'insert'), 'Fragen nicht direkt anlegbar');
select ok(not has_table_privilege('authenticated', 'public.spontaneous_asks', 'update'), 'Fragen nicht direkt änderbar');
select ok(not has_table_privilege('authenticated', 'public.spontaneous_answers', 'insert'), 'Antworten nicht direkt anlegbar');
select ok(not has_table_privilege('authenticated', 'public.spontaneous_answers', 'update'), 'Antworten nicht direkt änderbar');
select ok(not has_table_privilege('anon', 'public.spontaneous_asks', 'select'), 'anon liest keine Fragen');

-- ---- Angriff von außen ------------------------------------------------------------------------
select tests.login_anon();
select throws_ok(format($$ select public.ask_spontaneous(%L) $$, tests.var('crew')), '42501', null, 'anon scheitert');
select tests.login('mallory');
select throws_ok(format($$ select public.ask_spontaneous(%L) $$, tests.var('crew')), '42501', 'forbidden', 'Außenstehende fragen keine fremde Crew');
select throws_ok(format($$ select public.ask_spontaneous(%L) $$, gen_random_uuid()), '42501', 'forbidden', 'unbekannte Crew sieht aus wie eine fremde');
select throws_ok($$ select public.ask_spontaneous(null) $$, '42501', 'forbidden', 'ohne Crew geht nichts');

-- ---- Fragen -----------------------------------------------------------------------------------
select tests.login('alice');
select tests.set_var('ask', public.ask_spontaneous(tests.var('crew')::uuid, E'  Bowling   oder\nBier?  ')::text);
select tests.logout();
select is((select note from public.spontaneous_asks where id = tests.var('ask')::uuid), 'Bowling oder Bier?', 'Notiz wird bereinigt');
select ok((select expires_at between now() + interval '119 minutes' and now() + interval '121 minutes' from public.spontaneous_asks where id = tests.var('ask')::uuid), 'verfällt nach 2 Stunden');
select is((select answer from public.spontaneous_answers where ask_id = tests.var('ask')::uuid and user_id = tests.uid('alice')), 'in', 'wer fragt, hat Bock');
select is((select count(*)::int from public.notifications where type = 'spontaneous_ask'), 3, 'Bob, Carol und Dave bekommen Bescheid');
select is((select count(*)::int from public.notifications where type = 'spontaneous_ask' and user_id in (tests.uid('alice'), tests.uid('mallory'))), 0, 'nicht die Fragende, nicht Außenstehende');
select is((select payload ->> 'note' from public.notifications where type = 'spontaneous_ask' and user_id = tests.uid('bob')), 'Bowling oder Bier?', 'Benachrichtigung nennt die Notiz');
select is((select related_entity_id::text from public.notifications where type = 'spontaneous_ask' and user_id = tests.uid('bob')), tests.var('crew'), 'Benachrichtigung zeigt auf die Crew');
select is((select count(*)::int from public.audit_log where action = 'spontaneous_asked'), 1, 'Audit');

select tests.login('alice');
select throws_ok(format($$ select public.ask_spontaneous(%L) $$, tests.var('crew')), 'P0001', 'spontaneous_active', 'höchstens eine laufende Frage je Crew');
select tests.login('bob');
select throws_ok(format($$ select public.ask_spontaneous(%L, 'Kino?') $$, tests.var('crew')), 'P0001', 'spontaneous_active', 'auch nicht von anderen Mitgliedern');
select is((select count(*)::int from public.spontaneous_asks), 1, 'die Crew sieht ihre Frage');

select tests.login('mallory');
select is((select count(*)::int from public.spontaneous_asks), 0, 'Außenstehende sehen keine Fragen');
select is((select count(*)::int from public.spontaneous_answers), 0, 'Außenstehende sehen keine Antworten');
select throws_ok(format($$ select public.answer_spontaneous(%L, 'in') $$, tests.var('ask')), '42501', 'forbidden', 'Außenstehende antworten nicht');
select throws_ok(format($$ select public.answer_spontaneous(%L, 'in') $$, gen_random_uuid()), '42501', 'forbidden', 'unbekannte Frage sieht aus wie eine fremde');
select throws_ok(format($$ select public.close_spontaneous(%L) $$, tests.var('ask')), '42501', 'forbidden', 'Außenstehende beenden nicht');
select throws_ok(format($$ insert into public.spontaneous_answers (ask_id, user_id, answer) values (%L, %L, 'in') $$, tests.var('ask'), tests.uid('mallory')), '42501', null, 'kein direkter Eintrag');
select tests.logout();
select is((select count(*)::int from public.spontaneous_answers where ask_id = tests.var('ask')::uuid), 1, 'Angriffe haben nichts geändert');

-- ---- Antworten --------------------------------------------------------------------------------
select tests.login('bob');
select is(public.answer_spontaneous(tests.var('ask')::uuid, 'out'), '{"in_count": 1, "out_count": 1, "matched": false}'::jsonb, '„heute nicht“ zählt');
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'spontaneous_answer'), 0, 'eine Absage meldet niemandem etwas');
select tests.login('bob');
select is(public.answer_spontaneous(tests.var('ask')::uuid, 'in'), '{"in_count": 2, "out_count": 0, "matched": false}'::jsonb, 'Antwort lässt sich ändern');
select throws_ok(format($$ select public.answer_spontaneous(%L, 'maybe') $$, tests.var('ask')), 'P0001', 'invalid_spontaneous_answer', 'nur Bock oder heute nicht');
select throws_ok(format($$ select public.answer_spontaneous(%L, null) $$, tests.var('ask')), 'P0001', 'invalid_spontaneous_answer', 'ohne Antwort geht nichts');
select public.answer_spontaneous(tests.var('ask')::uuid, 'in');
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'spontaneous_answer' and user_id = tests.uid('alice')), 1, 'Alice erfährt Bobs Zusage genau einmal');
select is((select actor_id from public.notifications where type = 'spontaneous_answer'), tests.uid('bob'), 'mit Bob als auslösender Person');

select tests.login('carol');
select is(public.answer_spontaneous(tests.var('ask')::uuid, 'in'), '{"in_count": 3, "out_count": 0, "matched": true}'::jsonb, 'dritte Zusage: die Runde steht');
select tests.logout();
select isnt((select matched_at from public.spontaneous_asks where id = tests.var('ask')::uuid), null, 'matched_at gesetzt');
select is((select count(*)::int from public.notifications where type = 'spontaneous_match'), 3, 'Alice, Bob und Carol bekommen Bescheid');
select is((select count(*)::int from public.notifications where type = 'spontaneous_match' and user_id = tests.uid('dave')), 0, 'Dave (ohne Antwort) nicht');
select tests.login('dave');
select is(public.answer_spontaneous(tests.var('ask')::uuid, 'in'), '{"in_count": 4, "out_count": 0, "matched": true}'::jsonb, 'vierte Zusage');
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'spontaneous_match'), 3, 'kein zweites „Ihr seid genug“');

-- ---- Beenden ----------------------------------------------------------------------------------
select tests.login('bob');
select throws_ok(format($$ select public.close_spontaneous(%L) $$, tests.var('ask')), '42501', 'forbidden', 'einfache Mitglieder beenden fremde Fragen nicht');
select tests.login('alice');
select lives_ok(format($$ select public.close_spontaneous(%L) $$, tests.var('ask')), 'wer gefragt hat, beendet');
select lives_ok(format($$ select public.close_spontaneous(%L) $$, tests.var('ask')), 'zweites Beenden ändert nichts');
select tests.login('carol');
select throws_ok(format($$ select public.answer_spontaneous(%L, 'out') $$, tests.var('ask')), 'P0001', 'spontaneous_over', 'nach dem Beenden keine Antwort mehr');
select tests.logout();
select is((select count(*)::int from public.audit_log where action = 'spontaneous_closed'), 1, 'Beenden im Audit, einmal');

-- Owner beendet die Frage eines Mitglieds.
select tests.login('bob');
select tests.set_var('ask2', public.ask_spontaneous(tests.var('crew')::uuid, null)::text);
select tests.logout();
select is((select note from public.spontaneous_asks where id = tests.var('ask2')::uuid), null, 'ohne Notiz geht es auch');
select tests.login('alice');
select lives_ok(format($$ select public.close_spontaneous(%L) $$, tests.var('ask2')), 'Owner beendet die Frage eines Mitglieds');
select tests.logout();
select isnt((select closed_at from public.spontaneous_asks where id = tests.var('ask2')::uuid), null, 'beendet');

-- ---- Ablauf nach 2 Stunden --------------------------------------------------------------------
select tests.login('carol');
select tests.set_var('ask3', public.ask_spontaneous(tests.var('crew')::uuid, 'Pizza?')::text);
select tests.logout();
update public.spontaneous_asks set created_at = now() - interval '2 hours 1 minute', expires_at = now() - interval '1 minute' where id = tests.var('ask3')::uuid;
select tests.login('dave');
select throws_ok(format($$ select public.answer_spontaneous(%L, 'in') $$, tests.var('ask3')), 'P0001', 'spontaneous_over', 'abgelaufene Frage nimmt keine Antwort');
select lives_ok(format($$ select public.ask_spontaneous(%L, 'Kino?') $$, tests.var('crew')), 'nach dem Ablauf darf neu gefragt werden');
select tests.logout();
select is((select count(*)::int from public.spontaneous_asks where crew_id = tests.var('crew')::uuid and closed_at is null and expires_at > now()), 1, 'genau eine laufende Frage');

-- Alte Fragen räumt die nächste Frage weg.
update public.spontaneous_asks set created_at = now() - interval '8 days', expires_at = now() - interval '8 days' + interval '2 hours' where id = tests.var('ask')::uuid;
update public.spontaneous_asks set closed_at = now() where crew_id = tests.var('crew')::uuid and closed_at is null;
select tests.login('alice');
select public.ask_spontaneous(tests.var('crew')::uuid);
select tests.logout();
select is((select count(*)::int from public.spontaneous_asks where id = tests.var('ask')::uuid), 0, 'Fragen älter als 7 Tage sind weg');
select is((select count(*)::int from public.spontaneous_answers where ask_id = tests.var('ask')::uuid), 0, 'samt Antworten');
select is((select count(*)::int from public.spontaneous_asks where id = tests.var('ask3')::uuid), 1, 'jüngere bleiben');

-- ---- Export, Austritt, Rate Limit -------------------------------------------------------------
select tests.login('carol');
select ok(jsonb_array_length(public.export_my_data() -> 'spontaneous_asks') >= 1, 'Export enthält eigene Fragen');
select ok(jsonb_array_length(public.export_my_data() -> 'spontaneous_answers') >= 1, 'Export enthält eigene Antworten');
select tests.login('dave');
select public.leave_crew(tests.var('crew')::uuid);
select is((select count(*)::int from public.spontaneous_asks), 0, 'nach dem Austritt keine Fragen der Crew mehr');
select tests.logout();

delete from public.spontaneous_asks;
create function tests.ask_and_close(p_crew uuid) returns void
language plpgsql as $$
begin
  perform public.close_spontaneous(public.ask_spontaneous(p_crew));
end $$;
grant execute on function tests.ask_and_close(uuid) to authenticated;
select tests.login('mallory');
select tests.ask_and_close(tests.var('other')::uuid) from generate_series(1, 6);
select throws_ok(format($$ select public.ask_spontaneous(%L) $$, tests.var('other')), 'P0001', 'rate_limited', 'höchstens 6 Fragen je Stunde');
select tests.logout();

select * from finish();
rollback;
