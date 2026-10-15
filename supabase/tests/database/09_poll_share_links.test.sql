-- W2 Etappe 2: Teilen-Link einer Abstimmung – Token nur für Mitglieder, Vorschau ohne Konto mit dem Nötigsten.
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

-- Abstimmungen direkt anlegen (am RLS vorbei): eine laufende mit privaten Angaben, eine lange vorbei.
select tests.logout();
insert into public.polls (crew_id, created_by, title, description, meeting_point, budget_cents, ends_at) values
  (tests.var('crew')::uuid, tests.uid('alice'), 'Was machen wir am Samstag?', 'Bitte bis Freitag', 'Hinterhof Tür 3', 2500, now() + interval '2 days'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Lange her', null, null, null, now() - interval '10 days');
select tests.set_var('poll', (select id::text from public.polls where title = 'Was machen wir am Samstag?'));
select tests.set_var('old_poll', (select id::text from public.polls where title = 'Lange her'));
insert into public.poll_options (poll_id, title, position) values
  (tests.var('poll')::uuid, 'Strike Bowling', 0),
  (tests.var('poll')::uuid, 'Grillen bei Bob', 1),
  (tests.var('poll')::uuid, 'Kino', 2),
  (tests.var('old_poll')::uuid, 'Irgendwas', 0);
-- Alice stimmt zweimal ab (zwei Optionen), Bob einmal: zwei Personen haben abgestimmt.
insert into public.poll_votes (poll_id, poll_option_id, user_id, response)
select tests.var('poll')::uuid, o.id, u.uid, u.response::public.vote_response
from (values ('Strike Bowling', tests.uid('alice'), 'yes'), ('Kino', tests.uid('alice'), 'maybe'), ('Strike Bowling', tests.uid('bob'), 'no')) u(opt, uid, response)
join public.poll_options o on o.poll_id = tests.var('poll')::uuid and o.title = u.opt;

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(has_function_privilege('anon', 'public.preview_shared_poll(text)', 'execute'), 'anon darf die Abstimmungs-Vorschau aufrufen');
select ok(not has_function_privilege('anon', 'public.poll_share_token(uuid)', 'execute'), 'anon kann keinen Teilen-Link anlegen');
select ok(has_function_privilege('authenticated', 'public.poll_share_token(uuid)', 'execute'), 'Angemeldete dürfen die Funktion aufrufen (Mitgliedschaft prüft sie selbst)');

select tests.login_anon();
select throws_ok($$ select public.poll_share_token(tests.var('poll')::uuid) $$, '42501', null, 'anon: kein Token');
select throws_ok('select * from public.poll_share_links', '42501', null, 'anon kann die Links nicht lesen');

-- ---- Token anfordern -----------------------------------------------------------------------------
select tests.login('mallory');
select throws_ok($$ select public.poll_share_token(tests.var('poll')::uuid) $$, '42501', null, 'Außenstehende bekommen keinen Token für fremde Abstimmungen');
select throws_ok($$ select public.poll_share_token(null) $$, '42501', null, 'ohne Abstimmung kein Token');
select throws_ok($$ select public.poll_share_token(gen_random_uuid()) $$, '42501', null, 'unbekannte Abstimmung: kein Token');

select tests.login('alice');
select tests.set_var('token', public.poll_share_token(tests.var('poll')::uuid));
select matches(tests.var('token'), '^[0-9a-f]{32}$', 'Token: 32 Hex-Zeichen');
select is(public.poll_share_token(tests.var('poll')::uuid), tests.var('token'), 'zweiter Aufruf: derselbe Link');
select tests.login('bob');
select is(public.poll_share_token(tests.var('poll')::uuid), tests.var('token'), 'jedes Mitglied teilt denselben Link');
select throws_ok('select * from public.poll_share_links', '42501', null, 'auch Mitglieder lesen die Tabelle nicht direkt');
select tests.logout();
select is((select count(*)::int from public.poll_share_links), 1, 'ein Link je Abstimmung');
select is((select created_by from public.poll_share_links), tests.uid('alice'), 'angelegt von der ersten Person, die teilt');

-- ---- Vorschau ohne Konto --------------------------------------------------------------------------
select tests.login_anon();
select tests.set_var('preview', public.preview_shared_poll(tests.var('token'))::text);
select is(tests.var('preview')::jsonb ->> 'status', 'valid', 'gültiger Link: Status valid');
select is(tests.var('preview')::jsonb #>> '{poll,title}', 'Was machen wir am Samstag?', 'Frage sichtbar');
select is(tests.var('preview')::jsonb #>> '{poll,status}', 'open', 'laufende Abstimmung: open');
select is((tests.var('preview')::jsonb #>> '{poll,option_count}')::int, 3, 'Zahl der Vorschläge');
select is((tests.var('preview')::jsonb #>> '{poll,voter_count}')::int, 2, 'Zahl der Personen, die abgestimmt haben (nicht der Stimmen)');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(tests.var('preview')::jsonb -> 'poll') k),
  array['ends_at', 'guests', 'kind', 'option_count', 'status', 'title', 'voter_count'], 'von der Abstimmung nur Frage, Frist, Stand, zwei Zahlen, ob Gäste mitstimmen dürfen (W3) und die Art (P1)');
select is(tests.var('preview')::jsonb #>> '{poll,guests}', 'false', 'Gäste dürfen standardmäßig nicht mitstimmen');
select ok(tests.var('preview')::jsonb -> 'poll_id' = 'null'::jsonb, 'ohne Konto keine Abstimmungs-ID');
select ok(tests.var('preview') !~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'die Vorschau enthält keine einzige ID');
select ok(tests.var('preview') !~* '(Strike|Grillen|Kino|Hinterhof|Freitag|budget|Weekend|Alice|Bob|example\.test)',
  'keine Vorschläge im Wortlaut, kein Treffpunkt, keine Beschreibung, kein Budget, keine Crew, keine Namen');

-- ---- Angemeldet: Mitglieder bekommen die ID, Außenstehende nicht ------------------------------------
select tests.login('bob');
select is(public.preview_shared_poll(tests.var('token')) ->> 'poll_id', tests.var('poll'), 'Mitglied: Abstimmungs-ID zum Weiterleiten');
select tests.login('mallory');
select ok(public.preview_shared_poll(tests.var('token')) -> 'poll_id' = 'null'::jsonb, 'Außenstehende: keine Abstimmungs-ID');
select is((select count(*)::int from public.polls), 0, 'die Vorschau macht die Abstimmung nicht lesbar');
select is((select count(*)::int from public.poll_options), 0, 'auch die Vorschläge bleiben unlesbar');

-- ---- Frist vorbei oder entschieden: closed ------------------------------------------------------------
select tests.logout();
update public.polls set ends_at = now() - interval '1 hour' where id = tests.var('poll')::uuid;
select tests.login_anon();
select is(public.preview_shared_poll(tests.var('token')) #>> '{poll,status}', 'closed', 'Frist vorbei, noch nicht ausgezählt: closed');
select tests.logout();
update public.polls set ends_at = now() + interval '2 days', status = 'closed', closed_at = now() where id = tests.var('poll')::uuid;
select tests.login_anon();
select is(public.preview_shared_poll(tests.var('token')) #>> '{poll,status}', 'closed', 'vorzeitig beendet: closed');

-- ---- Ungültige und abgelaufene Links verraten nichts ------------------------------------------------
select tests.login('alice');
select tests.set_var('old_token', public.poll_share_token(tests.var('old_poll')::uuid));
select tests.login_anon();
select is(public.preview_shared_poll(tests.var('old_token')), '{"status": "expired"}'::jsonb, '3 Tage nach der Frist: nur der Status');
select is(public.preview_shared_poll(repeat('0', 32)), '{"status": "not_found"}'::jsonb, 'unbekannter Token: nur not_found');
select is(public.preview_shared_poll(''), '{"status": "not_found"}'::jsonb, 'leerer Token: not_found');
select is(public.preview_shared_poll(null), '{"status": "not_found"}'::jsonb, 'kein Token: not_found');
select is(public.preview_shared_poll('x'' or 1=1 --'), '{"status": "not_found"}'::jsonb, 'Unsinn wird gar nicht gesucht');
select is(public.preview_shared_poll(upper(tests.var('token'))), '{"status": "not_found"}'::jsonb, 'Token nur in Kleinbuchstaben');

-- Ein Plan-Token öffnet keine Abstimmung (und umgekehrt): getrennte Tabellen.
select tests.logout();
insert into public.plans (crew_id, created_by, title, starts_at, status)
values (tests.var('crew')::uuid, tests.uid('alice'), 'Bowling', now() + interval '3 days', 'confirmed');
select tests.login('alice');
select tests.set_var('plan_token', public.plan_share_token((select id from public.plans where title = 'Bowling')));
select tests.login_anon();
select is(public.preview_shared_poll(tests.var('plan_token')), '{"status": "not_found"}'::jsonb, 'Plan-Token: keine Abstimmung');
select is(public.preview_shared_plan(tests.var('token')), '{"status": "not_found"}'::jsonb, 'Abstimmungs-Token: kein Plan');

-- Gelöschte Abstimmung: Link weg.
select tests.logout();
delete from public.polls where id = tests.var('old_poll')::uuid;
select is((select count(*)::int from public.poll_share_links where token = tests.var('old_token')), 0, 'mit der Abstimmung verschwindet der Link');

-- ---- Rate Limit ---------------------------------------------------------------------------------------
delete from public.rate_limit_hits;  -- die Aufrufe oben zählen nicht mit
select tests.login_anon();
select is((select count(*)::int from (select public.preview_shared_poll(repeat('a', 32)) from generate_series(1, 20)) s), 20, '20 Aufrufe mit ungültigem Token');
select tests.logout();
select is((select count(*)::int from public.rate_limit_hits), 0, 'ungültige Tokens schreiben keine Zeilen');

select tests.login_anon();
select is(
  (select count(*)::int from (select public.preview_shared_poll(tests.var('token')) ->> 'status' as s from generate_series(1, 120)) r where r.s = 'valid'),
  120, '120 Aufrufe je Link in 10 Minuten sind erlaubt');
select throws_ok($$ select public.preview_shared_poll(tests.var('token')) $$, 'P0001', 'rate_limited', 'der 121. Aufruf wird gebremst');

select tests.logout();
select * from finish();
rollback;
