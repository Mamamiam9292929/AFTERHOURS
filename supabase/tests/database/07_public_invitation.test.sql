-- W1: Öffentliche Einladungsvorschau – das Einzige, was ohne Konto erreichbar ist.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Mallory');

update public.profiles set display_name = 'Alice Agentur' where id = tests.uid('alice');

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew', '🎳')::text);
select tests.set_var('token', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.set_var('token2', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.set_var('revoked', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.set_var('expired', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob');
select is(public.accept_crew_invitation(tests.var('token')) ->> 'status', 'joined', 'Bob tritt bei');

-- Pläne direkt anlegen (am RLS vorbei): ein künftiger mit Adresse, ein früherer, ein abgesagter, einer danach.
select tests.logout();
update public.crew_invitations set revoked_at = now()
where token_hash = encode(sha256(convert_to(tests.var('revoked'), 'UTF8')), 'hex');
update public.crew_invitations set expires_at = now() - interval '1 minute'
where token_hash = encode(sha256(convert_to(tests.var('expired'), 'UTF8')), 'hex');
insert into public.plans (crew_id, created_by, title, starts_at, address, meeting_point, notes, estimated_cost_per_person_cents, status) values
  (tests.var('crew')::uuid, tests.uid('alice'), 'Bowling', now() + interval '3 days', 'Geheimstraße 1, Berlin', 'Hinterhof Tür 3', 'Schlüssel bei Bob', 1500, 'confirmed'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Vergangen', now() - interval '3 days', null, null, null, null, 'completed'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Abgesagt', now() + interval '1 day', null, null, null, null, 'cancelled'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Später', now() + interval '10 days', null, null, null, null, 'proposed');

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(has_function_privilege('anon', 'public.preview_public_invitation(text)', 'execute'), 'anon darf die öffentliche Vorschau aufrufen');
select ok(not has_function_privilege('anon', 'app_private.rate_limit_key(text, text, integer, interval)', 'execute'), 'anon darf das interne Rate Limit nicht direkt aufrufen');
select ok(not has_function_privilege('authenticated', 'app_private.rate_limit_key(text, text, integer, interval)', 'execute'), 'angemeldete Nutzer ebenso nicht');

-- ---- Gültige Einladung ohne Konto -----------------------------------------------------------------
select tests.login_anon();
select tests.set_var('preview', public.preview_public_invitation(tests.var('token'))::text);
select is(tests.var('preview')::jsonb ->> 'status', 'valid', 'gültiger Link: Status valid');
select is(tests.var('preview')::jsonb #>> '{crew,name}', 'Weekend Crew', 'Crew-Name sichtbar');
select is(tests.var('preview')::jsonb #>> '{crew,emoji}', '🎳', 'Crew-Emoji sichtbar');
select is((tests.var('preview')::jsonb #>> '{crew,member_count}')::int, 2, 'Zahl der Mitglieder sichtbar');
select is(tests.var('preview')::jsonb ->> 'invited_by', 'Alice', 'Einladende Person nur mit Vornamen');
select is(tests.var('preview')::jsonb -> 'members', '["Alice", "Bob"]'::jsonb, 'Mitglieder nur mit Vornamen, in Beitrittsreihenfolge');
select is(tests.var('preview')::jsonb #>> '{next_plan,title}', 'Bowling', 'nächster Plan: der früheste künftige, nicht abgesagte');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(tests.var('preview')::jsonb -> 'next_plan') k),
  array['starts_at', 'title'], 'vom Plan nur Titel und Beginn');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(tests.var('preview')::jsonb -> 'crew') k),
  array['emoji', 'member_count', 'name'], 'von der Crew keine ID');
select ok(tests.var('preview') !~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'die Vorschau enthält keine einzige ID');
select ok(tests.var('preview') !~* '(Geheim|Hinterhof|Schlüssel|cost|example\.test|Agentur)', 'keine Adresse, kein Treffpunkt, keine Notizen, keine Kosten, keine E-Mail, keine Nachnamen');

-- Ohne künftigen Plan: next_plan ist null.
select tests.logout();
update public.plans set status = 'cancelled' where crew_id = tests.var('crew')::uuid and status <> 'completed';
select tests.login_anon();
select ok(public.preview_public_invitation(tests.var('token')) -> 'next_plan' = 'null'::jsonb, 'ohne anstehenden Plan bleibt next_plan leer');

-- ---- Ungültige Links verraten nichts ---------------------------------------------------------------
select is(public.preview_public_invitation(tests.var('revoked')), '{"status": "revoked"}'::jsonb, 'widerrufener Link: nur der Status');
select is(public.preview_public_invitation(tests.var('expired')), '{"status": "expired"}'::jsonb, 'abgelaufener Link: nur der Status');
select is(public.preview_public_invitation(repeat('0', 64)), '{"status": "not_found"}'::jsonb, 'unbekannter Token: nur not_found');
select is(public.preview_public_invitation(''), '{"status": "not_found"}'::jsonb, 'leerer Token: not_found');
select is(public.preview_public_invitation(null), '{"status": "not_found"}'::jsonb, 'kein Token: not_found');
select is(public.preview_public_invitation('x'' or 1=1 --'), '{"status": "not_found"}'::jsonb, 'Unsinn wird gar nicht gesucht');
select is(public.preview_public_invitation(upper(tests.var('token'))), '{"status": "not_found"}'::jsonb, 'Token nur in Kleinbuchstaben');

-- ---- Nichts sonst ist ohne Konto erreichbar -----------------------------------------------------------
select throws_ok($$ select public.preview_crew_invitation(tests.var('token')) $$, '42501', null, 'anon: die Beitrittsvorschau für Angemeldete bleibt gesperrt');
select throws_ok($$ select public.accept_crew_invitation(tests.var('token')) $$, '42501', null, 'anon kann nicht beitreten');
select throws_ok('select * from public.crew_invitations', '42501', null, 'anon kann keine Einladungen lesen');
select throws_ok('select * from public.crews', '42501', null, 'anon kann keine Crews lesen');

-- ---- Rate Limit ---------------------------------------------------------------------------------------
select tests.logout();
select tests.set_var('hits_before', (select count(*) from public.rate_limit_hits)::text);
select tests.login_anon();
select is((select count(*)::int from (select public.preview_public_invitation(repeat('a', 64)) from generate_series(1, 20)) s), 20, '20 Aufrufe mit ungültigem Token');
select tests.logout();
select is((select count(*) from public.rate_limit_hits)::text, tests.var('hits_before'), 'ungültige Tokens schreiben keine Zeilen');

select tests.login_anon();
select is(
  (select count(*)::int from (select public.preview_public_invitation(tests.var('token2')) ->> 'status' as s from generate_series(1, 60)) r where r.s = 'valid'),
  60, '60 Aufrufe je Einladung in 10 Minuten sind erlaubt');
select throws_ok($$ select public.preview_public_invitation(tests.var('token2')) $$, 'P0001', 'rate_limited', 'der 61. Aufruf wird gebremst');
select is(public.preview_public_invitation(tests.var('token')) ->> 'status', 'valid', 'das Limit gilt pro Einladung, andere Links bleiben nutzbar');

-- ---- Angemeldete Außenstehende sehen dasselbe – nicht mehr ---------------------------------------------
select tests.login('mallory');
select is((select array_agg(k order by k) from jsonb_object_keys(public.preview_public_invitation(tests.var('token'))) k),
  array['crew', 'expires_at', 'invited_by', 'members', 'next_plan', 'status'], 'auch angemeldet nur die öffentlichen Felder');
select is((select count(*)::int from public.crews), 0, 'die Vorschau macht die Crew nicht lesbar');

select tests.logout();
select * from finish();
rollback;
