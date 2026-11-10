-- P35: Crew stummschalten – `set_crew_push_mute` (nur Mitglieder, 'off' | '8h' | 'week' | 'always'), die eigene Zeile
-- lesbar per RLS, sonst niemand. Stumme Crews kommen nicht in die Push-Warteschlange (andere Crews und Benachrichtigungen
-- ohne Crew schon), abgelaufene Zeiten wirken nicht mehr, Wartendes wird beim Stummschalten entfernt. Austritt löscht
-- die Einstellung, der Datenexport enthält sie.
begin;
\ir helpers.inc
select no_plan();

create function tests.p256dh(p_seed text) returns text language sql immutable as $$
  select left(rtrim(translate(encode(sha512(convert_to(p_seed, 'UTF8')) || sha512(convert_to(p_seed || 'x', 'UTF8')), 'base64'), E'+/\n', '-_'), '='), 87) $$;
create function tests.auth_secret(p_seed text) returns text language sql immutable as $$
  select left(rtrim(translate(encode(sha256(convert_to(p_seed, 'UTF8')), 'base64'), E'+/\n', '-_'), '='), 22) $$;

-- Zahl der wartenden Pushs einer Person aus einer Crew (null = ohne Crew).
create function tests.queued(p_user uuid, p_crew uuid) returns integer
language sql security definer set search_path = '' as $$
  select count(*)::int from app_private.push_outbox o
  join public.notifications n on n.id = o.notification_id
  where n.user_id = p_user and n.crew_id is not distinct from p_crew $$;

create function tests.ping(p_user uuid, p_crew uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, type, crew_id, payload) values (p_user, 'poll_vote', p_crew, '{"title": "X"}') $$;

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Mallory');

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Laute Crew', '📣')::text);
select tests.set_var('ruhig', public.create_crew('Ruhige Crew', '🌙')::text);
select tests.set_var('invite', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/alice-handy', tests.p256dh('a'), tests.auth_secret('a'), 'Chrome auf Android');
select tests.login('bob');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Bob tritt bei');
select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/bob-handy', tests.p256dh('b'), tests.auth_secret('b'), 'Chrome auf Android');
select tests.login('mallory');
select tests.set_var('mallory_crew', public.create_crew('Fremde Crew')::text);
select tests.logout();

-- ---- Rechte --------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.set_crew_push_mute(uuid, text)', 'execute'), 'anon darf nichts stummschalten');
select ok(has_function_privilege('authenticated', 'public.set_crew_push_mute(uuid, text)', 'execute'), 'Angemeldete schalten über die RPC');
select ok(not has_table_privilege('anon', 'public.crew_push_mutes', 'select'), 'anon liest die Tabelle nicht');
select ok(has_table_privilege('authenticated', 'public.crew_push_mutes', 'select'), 'Angemeldete lesen (per RLS nur die eigene Zeile)');
select ok(not has_table_privilege('authenticated', 'public.crew_push_mutes', 'insert'), 'nicht direkt eintragen');
select ok(not has_table_privilege('authenticated', 'public.crew_push_mutes', 'update'), 'nicht direkt ändern');
select ok(not has_table_privilege('authenticated', 'public.crew_push_mutes', 'delete'), 'nicht direkt löschen');

select tests.login_anon();
select throws_ok(format($$ select public.set_crew_push_mute(%L, 'always') $$, tests.var('crew')), '42501', null, 'anon scheitert');
select tests.logout();

-- ---- Außenstehende ----------------------------------------------------------------------------------
select tests.login('mallory');
select throws_ok(format($$ select public.set_crew_push_mute(%L, 'always') $$, tests.var('crew')), '42501', null, 'Mallory kann fremde Crews nicht stummschalten');
select throws_ok($$ select public.set_crew_push_mute(null, 'always') $$, '42501', null, 'ohne Crew: verboten');
select throws_ok($$ insert into public.crew_push_mutes (crew_id, user_id) values (gen_random_uuid(), auth.uid()) $$, '42501', null, 'direktes Eintragen scheitert');
select tests.logout();

-- ---- Bob schaltet die laute Crew stumm --------------------------------------------------------------
select tests.login('bob');
select throws_ok(format($$ select public.set_crew_push_mute(%L, 'laut') $$, tests.var('crew')), 'P0001', 'invalid_crew_mute', 'unbekannte Dauer');
select throws_ok(format($$ select public.set_crew_push_mute(%L, null) $$, tests.var('crew')), 'P0001', 'invalid_crew_mute', 'ohne Dauer');
select is(public.set_crew_push_mute(tests.var('crew')::uuid, 'off'), '{"muted": false, "until": null}'::jsonb, 'laut bleibt laut, ohne Fehler');
select is((select count(*)::int from public.crew_push_mutes), 0, 'dabei entsteht keine Zeile');
select tests.logout();

-- Vorher wartet schon ein Push für Bob aus der Crew.
select tests.ping(tests.uid('bob'), tests.var('crew')::uuid);
select is(tests.queued(tests.uid('bob'), tests.var('crew')::uuid), 1, 'vor dem Stummschalten wartet ein Push');

select tests.login('bob');
select is((public.set_crew_push_mute(tests.var('crew')::uuid, '8h') ->> 'muted')::boolean, true, '8 Stunden stumm');
select ok((select muted_until between now() + interval '7 hours 59 minutes' and now() + interval '8 hours 1 minute' from public.crew_push_mutes), 'Ende in 8 Stunden');
select is((select count(*)::int from public.crew_push_mutes), 1, 'Bob liest seine Zeile');
select tests.logout();
select is(tests.queued(tests.uid('bob'), tests.var('crew')::uuid), 0, 'Wartendes aus der Crew geht nicht mehr raus');

-- Neue Benachrichtigungen: stumm für Bob, laut für Alice, laut ohne Crew.
-- Alice hat schon Pushs aus der Crew (z. B. „Bob ist beigetreten“) – gezählt wird ab hier.
select tests.set_var('alice_vorher', tests.queued(tests.uid('alice'), tests.var('crew')::uuid)::text);
select tests.ping(tests.uid('bob'), tests.var('crew')::uuid);
select tests.ping(tests.uid('alice'), tests.var('crew')::uuid);
select tests.ping(tests.uid('bob'), null);
select is(tests.queued(tests.uid('bob'), tests.var('crew')::uuid), 0, 'Bob bekommt aus der stummen Crew keinen Push');
select is((select count(*)::int from public.notifications where user_id = tests.uid('bob') and crew_id = tests.var('crew')::uuid), 2, 'in der App kommt trotzdem alles an');
select is(tests.queued(tests.uid('alice'), tests.var('crew')::uuid), tests.var('alice_vorher')::int + 1, 'Alice bekommt ihren Push wie bisher');
select is(tests.queued(tests.uid('bob'), null), 1, 'Benachrichtigungen ohne Crew kommen weiter');

-- Alice sieht nicht, dass Bob stumm ist; Mallory auch nicht.
select tests.login('alice');
select is((select count(*)::int from public.crew_push_mutes), 0, 'Alice sieht Bobs Stille nicht');
select tests.login('mallory');
select is((select count(*)::int from public.crew_push_mutes), 0, 'Mallory sieht nichts');
select tests.logout();

-- ---- Abgelaufen wirkt nicht mehr ----------------------------------------------------------------
update public.crew_push_mutes set muted_until = now() - interval '1 minute' where user_id = tests.uid('bob');
select tests.ping(tests.uid('bob'), tests.var('crew')::uuid);
select is(tests.queued(tests.uid('bob'), tests.var('crew')::uuid), 1, 'nach Ablauf kommt der Push wieder');

-- ---- Eine Woche, dann „bis ich es ändere“, dann wieder laut ----------------------------------------
select tests.login('bob');
select is((public.set_crew_push_mute(tests.var('crew')::uuid, 'week') ->> 'muted')::boolean, true, 'eine Woche stumm');
select ok((select muted_until between now() + interval '6 days 23 hours' and now() + interval '7 days 1 minute' from public.crew_push_mutes), 'Ende in einer Woche');
select is(public.set_crew_push_mute(tests.var('crew')::uuid, 'always'), '{"muted": true, "until": null}'::jsonb, 'bis ich es ändere');
select is((select count(*)::int from public.crew_push_mutes where muted_until is null), 1, 'ohne Ende gespeichert, eine Zeile');
select tests.logout();
select tests.ping(tests.uid('bob'), tests.var('crew')::uuid);
select is(tests.queued(tests.uid('bob'), tests.var('crew')::uuid), 0, 'ohne Ende: still');

select tests.login('bob');
select is((public.export_my_data() -> 'crews' -> 0 ->> 'push_muted')::boolean, true, 'der Export enthält die Stille');
select ok(public.export_my_data() -> 'crews' -> 0 -> 'push_muted_until' = 'null'::jsonb, 'mit Ende „bis ich es ändere“');
select is(public.set_crew_push_mute(tests.var('crew')::uuid, 'off'), '{"muted": false, "until": null}'::jsonb, 'wieder laut');
select is((select count(*)::int from public.crew_push_mutes), 0, 'die Zeile ist weg');
select is((public.export_my_data() -> 'crews' -> 0 ->> 'push_muted')::boolean, false, 'im Export wieder laut');
select tests.logout();
select tests.ping(tests.uid('bob'), tests.var('crew')::uuid);
select is(tests.queued(tests.uid('bob'), tests.var('crew')::uuid), 1, 'Pushs kommen wieder');

-- ---- Nur die eigene Crew betroffen; Austritt löscht die Einstellung ---------------------------------
select tests.login('alice');
select is((public.set_crew_push_mute(tests.var('ruhig')::uuid, 'always') ->> 'muted')::boolean, true, 'Alice schaltet ihre zweite Crew stumm');
select tests.logout();
select tests.ping(tests.uid('alice'), tests.var('ruhig')::uuid);
select tests.ping(tests.uid('alice'), tests.var('crew')::uuid);
select is(tests.queued(tests.uid('alice'), tests.var('ruhig')::uuid), 0, 'die stumme Crew bleibt still');
select is(tests.queued(tests.uid('alice'), tests.var('crew')::uuid), tests.var('alice_vorher')::int + 2, 'die andere Crew nicht');

select tests.login('bob');
select public.set_crew_push_mute(tests.var('crew')::uuid, 'always');
select public.leave_crew(tests.var('crew')::uuid);
select tests.logout();
select is((select count(*)::int from public.crew_push_mutes where user_id = tests.uid('bob')), 0, 'Austritt löscht die Stille');
select is((select count(*)::int from public.crew_push_mutes where user_id = tests.uid('alice')), 1, 'Alices Einstellung bleibt');

select * from finish();
rollback;
