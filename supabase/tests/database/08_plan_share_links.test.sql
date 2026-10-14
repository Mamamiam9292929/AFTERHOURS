-- W2 Etappe 1: Teilen-Link eines Plans – Token nur für Mitglieder, Vorschau ohne Konto mit dem Nötigsten.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Mallory');

update public.profiles set display_name = 'Alice Agentur' where id = tests.uid('alice');

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew', '🎳')::text);
select tests.set_var('invite', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Bob tritt bei');

-- Pläne direkt anlegen (am RLS vorbei): ein künftiger mit privaten Angaben, ein lange vergangener, einer in einer fremden Crew.
select tests.logout();
insert into public.plans (crew_id, created_by, title, starts_at, address, meeting_point, notes, estimated_cost_per_person_cents, status) values
  (tests.var('crew')::uuid, tests.uid('alice'), 'Bowling', now() + interval '3 days', 'Geheimstraße 1, Berlin', 'Hinterhof Tür 3', 'Schlüssel bei Bob', 1500, 'confirmed'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Lange her', now() - interval '10 days', null, null, null, null, 'completed');
select tests.set_var('plan', (select id::text from public.plans where title = 'Bowling'));
select tests.set_var('old_plan', (select id::text from public.plans where title = 'Lange her'));
insert into public.plan_participants (plan_id, user_id, attendance_status) values
  (tests.var('plan')::uuid, tests.uid('alice'), 'going'),
  (tests.var('plan')::uuid, tests.uid('bob'), 'maybe');

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(has_function_privilege('anon', 'public.preview_shared_plan(text)', 'execute'), 'anon darf die Plan-Vorschau aufrufen');
select ok(not has_function_privilege('anon', 'public.plan_share_token(uuid)', 'execute'), 'anon kann keinen Teilen-Link anlegen');
select ok(has_function_privilege('authenticated', 'public.plan_share_token(uuid)', 'execute'), 'Angemeldete dürfen die Funktion aufrufen (Mitgliedschaft prüft sie selbst)');

select tests.login_anon();
select throws_ok($$ select public.plan_share_token(tests.var('plan')::uuid) $$, '42501', null, 'anon: kein Token');
select throws_ok('select * from public.plan_share_links', '42501', null, 'anon kann die Links nicht lesen');

-- ---- Token anfordern -----------------------------------------------------------------------------
select tests.login('mallory');
select throws_ok($$ select public.plan_share_token(tests.var('plan')::uuid) $$, '42501', null, 'Außenstehende bekommen keinen Token für fremde Pläne');
select throws_ok($$ select public.plan_share_token(null) $$, '42501', null, 'ohne Plan kein Token');
select throws_ok($$ select public.plan_share_token(gen_random_uuid()) $$, '42501', null, 'unbekannter Plan: kein Token');

select tests.login('alice');
select tests.set_var('token', public.plan_share_token(tests.var('plan')::uuid));
select matches(tests.var('token'), '^[0-9a-f]{32}$', 'Token: 32 Hex-Zeichen');
select is(public.plan_share_token(tests.var('plan')::uuid), tests.var('token'), 'zweiter Aufruf: derselbe Link');
select tests.login('bob');
select is(public.plan_share_token(tests.var('plan')::uuid), tests.var('token'), 'jedes Mitglied teilt denselben Link');
select throws_ok('select * from public.plan_share_links', '42501', null, 'auch Mitglieder lesen die Tabelle nicht direkt');
select tests.logout();
select is((select count(*)::int from public.plan_share_links), 1, 'ein Link je Plan');
select is((select created_by from public.plan_share_links), tests.uid('alice'), 'angelegt von der ersten Person, die teilt');

-- ---- Vorschau ohne Konto --------------------------------------------------------------------------
select tests.login_anon();
select tests.set_var('preview', public.preview_shared_plan(tests.var('token'))::text);
select is(tests.var('preview')::jsonb ->> 'status', 'valid', 'gültiger Link: Status valid');
select is(tests.var('preview')::jsonb #>> '{plan,title}', 'Bowling', 'Titel sichtbar');
select is((tests.var('preview')::jsonb #>> '{plan,going_count}')::int, 1, 'nur Zusagen zählen (Vielleicht nicht)');
select is(tests.var('preview')::jsonb #>> '{plan,status}', 'confirmed', 'Status sichtbar');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(tests.var('preview')::jsonb -> 'plan') k),
  array['ends_at', 'going_count', 'starts_at', 'status', 'title'], 'vom Plan nur Titel, Zeit, Status und Zahl der Zusagen');
select ok(tests.var('preview')::jsonb -> 'plan_id' = 'null'::jsonb, 'ohne Konto keine Plan-ID');
select ok(tests.var('preview') !~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'die Vorschau enthält keine einzige ID');
select ok(tests.var('preview') !~* '(Geheim|Hinterhof|Schlüssel|cost|Weekend|Alice|Bob|example\.test)', 'keine Adresse, kein Treffpunkt, keine Notizen, keine Kosten, keine Crew, keine Namen');

-- ---- Angemeldet: Mitglieder bekommen die Plan-ID, Außenstehende nicht ----------------------------------
select tests.login('bob');
select is(public.preview_shared_plan(tests.var('token')) ->> 'plan_id', tests.var('plan'), 'Mitglied: Plan-ID zum Weiterleiten');
select tests.login('mallory');
select ok(public.preview_shared_plan(tests.var('token')) -> 'plan_id' = 'null'::jsonb, 'Außenstehende: keine Plan-ID');
select is((select count(*)::int from public.plans), 0, 'die Vorschau macht den Plan nicht lesbar');

-- ---- Ungültige und abgelaufene Links verraten nichts ------------------------------------------------
select tests.login('alice');
select tests.set_var('old_token', public.plan_share_token(tests.var('old_plan')::uuid));
select tests.login_anon();
select is(public.preview_shared_plan(tests.var('old_token')), '{"status": "expired"}'::jsonb, '3 Tage nach dem Plan: nur der Status');
select is(public.preview_shared_plan(repeat('0', 32)), '{"status": "not_found"}'::jsonb, 'unbekannter Token: nur not_found');
select is(public.preview_shared_plan(''), '{"status": "not_found"}'::jsonb, 'leerer Token: not_found');
select is(public.preview_shared_plan(null), '{"status": "not_found"}'::jsonb, 'kein Token: not_found');
select is(public.preview_shared_plan('x'' or 1=1 --'), '{"status": "not_found"}'::jsonb, 'Unsinn wird gar nicht gesucht');
select is(public.preview_shared_plan(upper(tests.var('token'))), '{"status": "not_found"}'::jsonb, 'Token nur in Kleinbuchstaben');
select is(public.preview_shared_plan(tests.var('token') || '0'), '{"status": "not_found"}'::jsonb, 'Token mit falscher Länge: not_found');

-- Abgesagte Pläne bleiben sichtbar – als abgesagt.
select tests.logout();
update public.plans set status = 'cancelled' where id = tests.var('plan')::uuid;
select tests.login_anon();
select is(public.preview_shared_plan(tests.var('token')) #>> '{plan,status}', 'cancelled', 'abgesagter Plan: Status cancelled');

-- Gelöschter Plan: Link weg.
select tests.logout();
delete from public.plans where id = tests.var('old_plan')::uuid;
select is((select count(*)::int from public.plan_share_links where token = tests.var('old_token')), 0, 'mit dem Plan verschwindet der Link');

-- ---- Rate Limit ---------------------------------------------------------------------------------------
delete from public.rate_limit_hits;  -- die Aufrufe oben zählen nicht mit
select tests.set_var('hits_before', (select count(*) from public.rate_limit_hits)::text);
select tests.login_anon();
select is((select count(*)::int from (select public.preview_shared_plan(repeat('a', 32)) from generate_series(1, 20)) s), 20, '20 Aufrufe mit ungültigem Token');
select tests.logout();
select is((select count(*) from public.rate_limit_hits)::text, tests.var('hits_before'), 'ungültige Tokens schreiben keine Zeilen');

select tests.login_anon();
select is(
  (select count(*)::int from (select public.preview_shared_plan(tests.var('token')) ->> 'status' as s from generate_series(1, 120)) r where r.s = 'valid'),
  120, '120 Aufrufe je Link in 10 Minuten sind erlaubt');
select throws_ok($$ select public.preview_shared_plan(tests.var('token')) $$, 'P0001', 'rate_limited', 'der 121. Aufruf wird gebremst');

select tests.logout();
select * from finish();
rollback;
