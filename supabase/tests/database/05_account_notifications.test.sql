-- Benachrichtigungen, Datenexport, Kontolöschung, Meldungen.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Mallory');

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew')::text);
select tests.set_var('token', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob');
select public.accept_crew_invitation(tests.var('token'));
select tests.login('alice');
select tests.set_var('poll', public.create_poll(tests.var('crew')::uuid, 'Was machen wir?', now() + interval '1 day', '[{"title":"Kino"},{"title":"Bar"}]')::text);
select public.send_crew_message(tests.var('crew')::uuid, 'Hallo zusammen');
select tests.login('bob');
select public.cast_vote((select id from public.poll_options where poll_id = tests.var('poll')::uuid and position = 1), 'yes');
select tests.set_var('bob_plan', public.create_plan(tests.var('crew')::uuid, 'Bobs Plan', now() + interval '3 days')::text);

-- ---- Benachrichtigungen ----------------------------------------------------------------------------
select is((select count(*)::int from public.notifications), 1, 'Bob sieht genau seine eigene Benachrichtigung (neue Abstimmung)');
select throws_ok($$ update public.notifications set payload = '{}' $$, '42501', null, 'Benachrichtigungen sind nicht direkt änderbar');
select throws_ok($$ insert into public.notifications (user_id, type) values (tests.uid('alice'), 'poll_created') $$, '42501', null, 'niemand kann anderen Benachrichtigungen unterschieben');
select is(public.mark_notifications_read(), 1, 'als gelesen markieren');
select is(public.mark_notifications_read(), 0, 'zweiter Aufruf findet nichts Ungelesenes');
select tests.login('alice');
select is((select count(*)::int from public.notifications where read_at is null), 3, 'Alices Benachrichtigungen bleiben von Bobs Aktion unberührt');
select is(public.mark_notifications_read(array(select id from public.notifications where type = 'poll_vote')), 1, 'gezielt einzelne markieren');
delete from public.notifications where user_id = tests.uid('bob');
select tests.login('bob');
select is((select count(*)::int from public.notifications), 1, 'fremde Benachrichtigungen lassen sich nicht löschen');
select lives_ok($$ delete from public.notifications $$, 'eigene Benachrichtigungen lassen sich löschen');

-- ---- Meldungen ---------------------------------------------------------------------------------------
select throws_ok($$ select public.report_entity('activity', gen_random_uuid(), 'x') $$, 'P0001', 'invalid_report', 'Meldungen brauchen eine Begründung');
select lives_ok($$ select public.report_entity('activity', (select id from public.activities limit 1), 'Öffnungszeiten stimmen nicht') $$, 'Meldung abgegeben');
select tests.login('alice');
select is((select count(*)::int from public.reports), 0, 'fremde Meldungen sind nicht sichtbar');

-- ---- Kontingent für den KI-Assistenten -------------------------------------------------------------
select lives_ok($$ select public.assistant_quota() from generate_series(1, 20) $$, '20 Assistenten-Anfragen pro Stunde sind erlaubt');
select throws_ok($$ select public.assistant_quota() $$, 'P0001', 'rate_limited', 'die 21. Anfrage wird gebremst');

-- ---- Datenexport -------------------------------------------------------------------------------------
select tests.login('bob');
select is(public.export_my_data() #>> '{account,email}', 'bob@example.test', 'Export enthält das eigene Konto');
select is(jsonb_array_length(public.export_my_data() -> 'votes'), 1, 'Export enthält die eigenen Stimmen');
select is(jsonb_array_length(public.export_my_data() -> 'messages'), 0, 'Export enthält keine fremden Nachrichten');
select ok(public.export_my_data()::text not like '%alice@example.test%', 'Export enthält keine fremden E-Mail-Adressen');

-- ---- Kontolöschung -----------------------------------------------------------------------------------
select tests.login('alice');
select throws_ok($$ select public.delete_my_account('ja') $$, 'P0001', 'confirmation_required', 'Löschung nur mit Bestätigungsphrase');
select throws_ok($$ delete from auth.users $$, '42501', null, 'auth.users ist über die API nicht erreichbar');
select lives_ok($$ select public.delete_my_account('DELETE') $$, 'Alice löscht ihr Konto');
select tests.logout();
select is((select count(*)::int from auth.users where id = tests.uid('alice')), 0, 'Konto ist entfernt');
select is((select count(*)::int from public.profiles where id = tests.uid('alice')), 0, 'Profil ist entfernt');
select is((select count(*)::int from public.user_settings where user_id = tests.uid('alice')), 0, 'Einstellungen sind entfernt');
select is((select count(*)::int from public.notifications where user_id = tests.uid('alice')), 0, 'Benachrichtigungen sind entfernt');
select is((select count(*)::int from public.poll_votes where user_id = tests.uid('alice')), 0, 'Stimmen sind entfernt');
select is((select user_id from public.crew_members where crew_id = tests.var('crew')::uuid and role = 'owner'), tests.uid('bob'), 'die Crew bleibt bestehen, Bob rückt als Owner nach');
select is((select created_by from public.polls where id = tests.var('poll')::uuid), null, 'ihre Abstimmung bleibt ohne Personenbezug erhalten');
select is((select user_id from public.crew_messages where crew_id = tests.var('crew')::uuid), null, 'ihre Nachricht bleibt ohne Personenbezug erhalten');
select is((select count(*)::int from public.audit_log where action = 'account_deleted' and actor_id is null and created_at = now()), 1, 'die Löschung ist ohne Personenbezug protokolliert');

-- Bob ist jetzt allein; löscht er sein Konto, verschwindet auch die Crew samt Inhalten.
select tests.login('bob');
select public.delete_my_account('DELETE');
select tests.logout();
select is((select count(*)::int from public.crews where id = tests.var('crew')::uuid), 0, 'ohne Mitglieder wird die Crew gelöscht');
select is((select count(*)::int from public.polls where crew_id = tests.var('crew')::uuid) + (select count(*)::int from public.plans where crew_id = tests.var('crew')::uuid), 0, 'mit ihr verschwinden Abstimmungen und Pläne');

select * from finish();
rollback;
