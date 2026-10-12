-- Crews, Rollen und Einladungslinks.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');   -- Owner
select tests.make_user('Bob');     -- Mitglied
select tests.make_user('Carol');   -- Admin
select tests.make_user('Dave');
select tests.make_user('Mallory'); -- Außenstehende

-- ---- Crew anlegen -------------------------------------------------------------------------------
select tests.login('alice');
select throws_ok($$ select public.create_crew(' ') $$, 'P0001', 'invalid_name', 'leerer Crew-Name wird abgelehnt');
select tests.set_var('crew', public.create_crew('  Weekend   Crew ', '🎳')::text);
select is((select name from public.crews where id = tests.var('crew')::uuid), 'Weekend Crew', 'Crew-Name wird bereinigt');
select is((select role::text from public.crew_members where crew_id = tests.var('crew')::uuid and user_id = tests.uid('alice')), 'owner', 'wer die Crew anlegt, ist Owner');
select throws_ok($$ insert into public.crews (name) values ('Direkt') $$, '42501', null, 'Crews lassen sich nicht an der RPC vorbei anlegen');
select throws_ok($$ insert into public.crew_members (crew_id, user_id, role) values (tests.var('crew')::uuid, tests.uid('mallory'), 'owner') $$, '42501', null, 'Mitgliedschaften lassen sich nicht direkt anlegen');

-- ---- Außenstehende ---------------------------------------------------------------------------------
select tests.login('mallory');
select is((select count(*)::int from public.crews), 0, 'Außenstehende sehen die Crew nicht');
select is((select count(*)::int from public.crew_members), 0, 'Außenstehende sehen keine Mitglieder');
select throws_ok($$ select * from public.create_crew_invitation(tests.var('crew')::uuid) $$, '42501', 'forbidden', 'Außenstehende können keine Einladung erzeugen');
select throws_ok($$ select public.send_crew_message(tests.var('crew')::uuid, 'Hi') $$, '42501', 'forbidden', 'Außenstehende können nicht in den Crew-Chat schreiben');
select throws_ok($$ select public.leave_crew(tests.var('crew')::uuid) $$, '42501', 'forbidden', 'Verlassen einer fremden Crew schlägt fehl');

-- ---- Einladungen -------------------------------------------------------------------------------------
select tests.login('alice');
select tests.set_var('token', (select token from public.create_crew_invitation(tests.var('crew')::uuid, 24, 2)));
select is(char_length(tests.var('token')), 64, 'Token hat 64 Hex-Zeichen (244 Bit Zufall)');
select throws_ok($$ select token_hash from public.crew_invitations $$, '42501', null, 'der Token-Hash ist auch für Owner nicht lesbar');
select is((select count(*)::int from (select id, expires_at from public.crew_invitations) i), 1, 'Owner sieht die Einladung (ohne Hash)');
select tests.logout();
select isnt((select token_hash from public.crew_invitations where crew_id = tests.var('crew')::uuid), tests.var('token'), 'gespeichert wird nur der Hash, nie der Token');
select is((select max_uses from public.crew_invitations where crew_id = tests.var('crew')::uuid), 2, 'Nutzungslimit wird übernommen');
select ok((select expires_at <= now() + interval '24 hours' from public.crew_invitations where crew_id = tests.var('crew')::uuid), 'Ablaufzeit wird übernommen');

select tests.login('bob');
select is(public.preview_crew_invitation('falscher-token') ->> 'status', 'not_found', 'unbekannter Token: not_found');
select is(public.preview_crew_invitation('falscher-token') -> 'crew', null, 'unbekannter Token verrät nichts über Crews');
select is(public.preview_crew_invitation(tests.var('token')) #>> '{crew,name}', 'Weekend Crew', 'gültiger Token zeigt die Crew-Vorschau');
select is(public.preview_crew_invitation(tests.var('token')) ->> 'invited_by', 'Alice', 'Vorschau nennt, wer einlädt');
select is((select count(*)::int from public.crews), 0, 'die Vorschau allein gewährt noch keinen Zugriff');
select is(public.accept_crew_invitation(tests.var('token')) ->> 'status', 'joined', 'Beitritt mit gültigem Token');
select is(public.accept_crew_invitation(tests.var('token')) ->> 'status', 'already_member', 'zweiter Beitritt: already_member');
select is((select count(*)::int from public.crews), 1, 'nach dem Beitritt ist die Crew sichtbar');
select is((select count(*)::int from public.crew_invitations), 0, 'einfache Mitglieder sehen keine Einladungen');
select throws_ok($$ select * from public.create_crew_invitation(tests.var('crew')::uuid) $$, '42501', 'forbidden', 'einfache Mitglieder können nicht einladen');

select tests.login('carol');
select is(public.accept_crew_invitation(tests.var('token')) ->> 'status', 'joined', 'zweite Nutzung des Links');
select tests.login('dave');
select is(public.accept_crew_invitation(tests.var('token')) ->> 'status', 'exhausted', 'Nutzungslimit erreicht: exhausted');
select tests.logout();
select is((select use_count from public.crew_invitations where crew_id = tests.var('crew')::uuid), 2, 'Nutzungen werden gezählt');
select is((select count(*)::int from public.notifications where user_id = tests.uid('alice') and type = 'crew_member_joined'), 2, 'Owner wird über Beitritte informiert');

-- Widerruf
select tests.login('alice');
select tests.set_var('token2', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.logout();
select tests.set_var('inv2', (select id::text from public.crew_invitations where token_hash = encode(sha256(convert_to(tests.var('token2'), 'UTF8')), 'hex')));
select tests.login('bob');
select throws_ok($$ select public.revoke_crew_invitation(tests.var('inv2')::uuid) $$, '42501', 'forbidden', 'einfache Mitglieder können nicht widerrufen');
select tests.login('alice');
select lives_ok($$ select public.revoke_crew_invitation(tests.var('inv2')::uuid) $$, 'Owner widerruft die Einladung');
select tests.login('dave');
select is(public.accept_crew_invitation(tests.var('token2')) ->> 'status', 'revoked', 'widerrufener Link: revoked');

-- Ablauf
select tests.login('alice');
select tests.set_var('token3', (select token from public.create_crew_invitation(tests.var('crew')::uuid, 1)));
select tests.logout();
update public.crew_invitations set expires_at = now() - interval '1 minute'
where token_hash = encode(sha256(convert_to(tests.var('token3'), 'UTF8')), 'hex');
select tests.login('dave');
select is(public.accept_crew_invitation(tests.var('token3')) ->> 'status', 'expired', 'abgelaufener Link: expired');
select is((select count(*)::int from public.crews), 0, 'Dave ist weiterhin kein Mitglied');

-- Grenzen: Laufzeit höchstens 30 Tage, Nutzungen höchstens 50
select tests.login('alice');
select ok((select expires_at <= now() + interval '720 hours' and max_uses = 50 from public.create_crew_invitation(tests.var('crew')::uuid, 99999, 99999)), 'Laufzeit und Nutzungen werden gedeckelt');

-- ---- Rollen -------------------------------------------------------------------------------------------
select tests.login('bob');
select throws_ok($$ select public.set_crew_member_role(tests.var('crew')::uuid, tests.uid('bob'), 'admin') $$, '42501', 'forbidden', 'Mitglieder können sich nicht selbst befördern');
select throws_ok($$ select public.remove_crew_member(tests.var('crew')::uuid, tests.uid('carol')) $$, '42501', 'forbidden', 'Mitglieder können niemanden entfernen');
update public.crews set name = 'Übernommen' where id = tests.var('crew')::uuid;
select is((select name from public.crews where id = tests.var('crew')::uuid), 'Weekend Crew', 'Mitglieder können die Crew nicht umbenennen');
delete from public.crews where id = tests.var('crew')::uuid;
select is((select count(*)::int from public.crews), 1, 'Mitglieder können die Crew nicht löschen');

select tests.login('alice');
select lives_ok($$ select public.set_crew_member_role(tests.var('crew')::uuid, tests.uid('carol'), 'admin') $$, 'Owner ernennt eine Admin');
select tests.login('carol');
select lives_ok($$ update public.crews set name = 'Weekend Crew 2' where id = tests.var('crew')::uuid $$, 'Admins dürfen umbenennen');
select throws_ok($$ update public.crews set created_by = tests.uid('carol') where id = tests.var('crew')::uuid $$, '42501', null, 'created_by ist nicht änderbar');
select throws_ok($$ select public.remove_crew_member(tests.var('crew')::uuid, tests.uid('alice')) $$, '42501', 'forbidden', 'Admins können den Owner nicht entfernen');
select throws_ok($$ select public.set_crew_member_role(tests.var('crew')::uuid, tests.uid('bob'), 'admin') $$, '42501', 'forbidden', 'Admins vergeben keine Rollen');
select lives_ok($$ select * from public.create_crew_invitation(tests.var('crew')::uuid) $$, 'Admins dürfen einladen');
select lives_ok($$ select public.remove_crew_member(tests.var('crew')::uuid, tests.uid('bob')) $$, 'Admins dürfen Mitglieder entfernen');
select tests.login('bob');
select is((select count(*)::int from public.crews), 0, 'entfernte Mitglieder verlieren sofort den Zugriff');
select is((select count(*)::int from public.notifications where type = 'crew_member_removed'), 1, 'die entfernte Person wird informiert');

-- ---- Eigentum übertragen und Nachfolge ---------------------------------------------------------------------
select tests.login('alice');
select lives_ok($$ select public.set_crew_member_role(tests.var('crew')::uuid, tests.uid('carol'), 'owner') $$, 'Owner überträgt die Crew');
select tests.logout();
select is((select count(*)::int from public.crew_members where crew_id = tests.var('crew')::uuid and role = 'owner'), 1, 'es gibt immer genau einen Owner');
select is((select role::text from public.crew_members where crew_id = tests.var('crew')::uuid and user_id = tests.uid('alice')), 'admin', 'der bisherige Owner wird Admin');

select tests.login('carol');
select lives_ok($$ select public.leave_crew(tests.var('crew')::uuid) $$, 'Owner verlässt die Crew');
select tests.logout();
select is((select user_id from public.crew_members where crew_id = tests.var('crew')::uuid and role = 'owner'), tests.uid('alice'), 'Nachfolge: die dienstälteste Admin wird Owner');
select tests.login('alice');
select lives_ok($$ select public.leave_crew(tests.var('crew')::uuid) $$, 'das letzte Mitglied verlässt die Crew');
select tests.logout();
select is((select count(*)::int from public.crews where id = tests.var('crew')::uuid), 0, 'eine Crew ohne Mitglieder wird gelöscht');
select is((select count(*)::int from public.crew_invitations where crew_id = tests.var('crew')::uuid), 0, 'ihre Einladungen verschwinden mit ihr');

-- ---- Chat ----------------------------------------------------------------------------------------------------
select tests.login('alice');
select tests.set_var('crew2', public.create_crew('Chat Crew')::text);
select lives_ok($$ select public.send_crew_message(tests.var('crew2')::uuid, '  Wer ist Samstag dabei?  ') $$, 'Mitglieder schreiben in den Crew-Chat');
select throws_ok($$ select public.send_crew_message(tests.var('crew2')::uuid, '   ') $$, 'P0001', 'empty_message', 'leere Nachrichten werden abgelehnt');
select throws_ok($$ insert into public.crew_messages (crew_id, user_id, body) values (tests.var('crew2')::uuid, tests.uid('bob'), 'gefälscht') $$, '42501', null, 'Nachrichten lassen sich nicht im Namen anderer einfügen');
select tests.login('mallory');
select is((select count(*)::int from public.crew_messages), 0, 'Außenstehende lesen keine Nachrichten');

-- ---- Rate Limit --------------------------------------------------------------------------------------------------
select tests.login('dave');
select lives_ok($$ select public.create_crew('Crew ' || g) from generate_series(1, 10) g $$, 'zehn Crews pro Stunde sind erlaubt');
select throws_ok($$ select public.create_crew('Crew 11') $$, 'P0001', 'rate_limited', 'die elfte Crew in einer Stunde wird gebremst');

select tests.logout();
select * from finish();
rollback;
