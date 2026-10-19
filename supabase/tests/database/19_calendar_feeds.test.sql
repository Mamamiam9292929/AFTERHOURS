-- P2 Etappe 2: Kalender-Abo – eigener Link nur für die eigene Person, Termine nur aus eigenen Crews,
-- ohne abgesagte Teilnahme, ohne fremde Namen; ungültige Links verraten nichts.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Mallory');

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew', '🎳')::text);
select tests.set_var('invite', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Bob tritt bei');
select tests.login('mallory');
select tests.set_var('other_crew', public.create_crew('Mallorys Crew', '🦊')::text);

-- Pläne direkt anlegen (am RLS vorbei).
select tests.logout();
insert into public.plans (crew_id, created_by, title, starts_at, ends_at, address, meeting_point, notes, estimated_cost_per_person_cents, status) values
  (tests.var('crew')::uuid, tests.uid('alice'), 'Bowling', now() + interval '3 days', now() + interval '3 days 2 hours', 'Bahnstraße 1, Leipzig', 'Vor dem Eingang', 'Schlüssel bei Bob', 1500, 'confirmed'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Kino', now() + interval '5 days', null, null, null, null, null, 'proposed'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Abgesagtes Grillen', now() + interval '6 days', null, null, null, null, null, 'cancelled'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Ohne Bob', now() + interval '7 days', null, null, null, null, null, 'confirmed'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Letzten Monat', now() - interval '30 days', null, null, null, null, null, 'completed'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Uralt', now() - interval '90 days', null, null, null, null, null, 'completed'),
  (tests.var('other_crew')::uuid, tests.uid('mallory'), 'Mallorys Abend', now() + interval '2 days', null, 'Geheimweg 7', null, null, null, 'confirmed');
select tests.set_var('bowling', (select id::text from public.plans where title = 'Bowling'));
insert into public.plan_participants (plan_id, user_id, attendance_status) values
  (tests.var('bowling')::uuid, tests.uid('alice'), 'going'),
  (tests.var('bowling')::uuid, tests.uid('bob'), 'maybe'),
  ((select id from public.plans where title = 'Ohne Bob'), tests.uid('bob'), 'declined');

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(has_function_privilege('anon', 'public.calendar_feed_events(text)', 'execute'), 'anon darf den Kalender abrufen (Kalender-Apps melden sich nicht an)');
select ok(not has_function_privilege('anon', 'public.my_calendar_feed()', 'execute'), 'anon sieht keinen Abo-Link');
select ok(not has_function_privilege('anon', 'public.renew_calendar_feed()', 'execute'), 'anon legt keinen Abo-Link an');
select ok(not has_function_privilege('anon', 'public.revoke_calendar_feed()', 'execute'), 'anon beendet kein Abo');
select ok(not has_function_privilege('authenticated', 'app_private.calendar_feed_json(uuid)', 'execute'), 'interne Hilfe ist nicht aufrufbar');

select tests.login_anon();
select throws_ok('select public.renew_calendar_feed()', '42501', null, 'anon: kein Abo-Link');
select throws_ok('select * from public.calendar_feeds', '42501', null, 'anon liest die Tabelle nicht');

-- ---- Link anlegen, ansehen, ersetzen ------------------------------------------------------------
select tests.login('bob');
select is(public.my_calendar_feed(), null, 'ohne Abo: null');
select tests.set_var('feed', public.renew_calendar_feed()::text);
select tests.set_var('token', tests.var('feed')::jsonb ->> 'token');
select matches(tests.var('token'), '^[0-9a-f]{64}$', 'Token: 64 Hex-Zeichen');
select ok(tests.var('feed')::jsonb -> 'last_used_at' = 'null'::jsonb, 'neuer Link: noch nie abgerufen');
select is(public.my_calendar_feed() ->> 'token', tests.var('token'), 'der Link lässt sich wieder ansehen');
select throws_ok('select * from public.calendar_feeds', '42501', null, 'auch die eigene Person liest die Tabelle nicht direkt');

select tests.login('alice');
select is(public.my_calendar_feed(), null, 'Alice sieht Bobs Link nicht');
select tests.set_var('alice_token', public.renew_calendar_feed() ->> 'token');
select isnt(tests.var('alice_token'), tests.var('token'), 'jede Person hat ihren eigenen Link');

-- ---- Termine ohne Konto --------------------------------------------------------------------------
select tests.login_anon();
select tests.set_var('events', public.calendar_feed_events(tests.var('token'))::text);
select is(tests.var('events')::jsonb ->> 'status', 'valid', 'gültiger Link: Status valid');
select is(
  (select array_agg(e ->> 'title' order by e ->> 'starts_at') from jsonb_array_elements(tests.var('events')::jsonb -> 'events') e),
  array['Letzten Monat', 'Bowling', 'Kino', 'Abgesagtes Grillen'],
  'Pläne der eigenen Crew ab 60 Tagen zurück, auch abgesagte; ohne den abgesagten Teilnahme und ohne fremde Crews');
select is(
  (select e ->> 'attendance' from jsonb_array_elements(tests.var('events')::jsonb -> 'events') e where e ->> 'title' = 'Bowling'),
  'maybe', 'eigene Antwort steht dabei');
select is(
  (select e ->> 'attendance' from jsonb_array_elements(tests.var('events')::jsonb -> 'events') e where e ->> 'title' = 'Kino'),
  'invited', 'ohne Antwort: invited');
select is(
  (select e ->> 'crew' from jsonb_array_elements(tests.var('events')::jsonb -> 'events') e where e ->> 'title' = 'Bowling'),
  'Weekend Crew', 'Crew-Name steht dabei');
select is(
  (select e ->> 'address' from jsonb_array_elements(tests.var('events')::jsonb -> 'events') e where e ->> 'title' = 'Bowling'),
  'Bahnstraße 1, Leipzig', 'Adresse für den eigenen Kalender');
select is(
  (select array_agg(k order by k) from jsonb_array_elements(tests.var('events')::jsonb -> 'events') e, jsonb_object_keys(e) k where e ->> 'title' = 'Bowling'),
  array['address', 'attendance', 'created_at', 'crew', 'ends_at', 'id', 'meeting_point', 'starts_at', 'status', 'title', 'updated_at'],
  'je Termin nur Titel, Zeiten, Ort, Treffpunkt, Status, eigene Antwort, Crew und Plan-ID');
select ok(tests.var('events') !~* '(Schlüssel|cost|Alice|Bob|Mallory|Geheimweg|example\.test)', 'keine Notizen, Kosten, Namen, E-Mails, fremden Pläne');
select throws_ok('select * from public.plans', '42501', null, 'der Abruf macht keinen Plan direkt lesbar');

select tests.logout();
select ok((select last_used_at from public.calendar_feeds where user_id = tests.uid('bob')) is not null, 'Abruf setzt „zuletzt abgerufen“');

-- Wer die Crew verlässt, sieht ihre Pläne nicht mehr.
select tests.login('bob');
select public.leave_crew(tests.var('crew')::uuid);
select tests.login_anon();
select is(jsonb_array_length(public.calendar_feed_events(tests.var('token')) -> 'events'), 0, 'nach dem Austritt: keine Termine der Crew mehr');
select tests.logout();
insert into public.crew_members (crew_id, user_id, role) values (tests.var('crew')::uuid, tests.uid('bob'), 'member');

-- ---- Neuer Link ersetzt den alten, Abo beenden ---------------------------------------------------
select tests.login('bob');
select tests.set_var('token2', public.renew_calendar_feed() ->> 'token');
select isnt(tests.var('token2'), tests.var('token'), 'neuer Link ist ein anderer');
select tests.login_anon();
select is(public.calendar_feed_events(tests.var('token')), '{"status": "not_found"}'::jsonb, 'alter Link liefert nichts mehr');
select is(public.calendar_feed_events(tests.var('token2')) ->> 'status', 'valid', 'neuer Link funktioniert');

select tests.login('bob');
select lives_ok('select public.revoke_calendar_feed()', 'Abo beenden');
select is(public.my_calendar_feed(), null, 'danach kein Link mehr');
select lives_ok('select public.revoke_calendar_feed()', 'zweimal beenden ist kein Fehler');
select tests.login_anon();
select is(public.calendar_feed_events(tests.var('token2')), '{"status": "not_found"}'::jsonb, 'beendetes Abo liefert nichts');

select tests.logout();
select is((select array_agg(action order by created_at, action) from public.audit_log where actor_id = tests.uid('bob') and action like 'calendar_feed%'),
          array['calendar_feed_created', 'calendar_feed_renewed', 'calendar_feed_revoked'], 'Anlegen, Ersetzen und Beenden stehen im Audit-Log');

-- ---- Ungültige Links verraten nichts ------------------------------------------------------------
select tests.login_anon();
select is(public.calendar_feed_events(repeat('0', 64)), '{"status": "not_found"}'::jsonb, 'unbekannter Token: not_found');
select is(public.calendar_feed_events(null), '{"status": "not_found"}'::jsonb, 'kein Token: not_found');
select is(public.calendar_feed_events(''), '{"status": "not_found"}'::jsonb, 'leerer Token: not_found');
select is(public.calendar_feed_events(upper(tests.var('alice_token'))), '{"status": "not_found"}'::jsonb, 'Token nur in Kleinbuchstaben');
select is(public.calendar_feed_events(left(tests.var('alice_token'), 32)), '{"status": "not_found"}'::jsonb, 'halber Token: not_found');
select is(public.calendar_feed_events('x'' or 1=1 --'), '{"status": "not_found"}'::jsonb, 'Unsinn wird gar nicht gesucht');

-- Mallory kann mit ihrem eigenen Abo nichts von anderen Crews sehen.
select tests.login('mallory');
select tests.set_var('mallory_token', public.renew_calendar_feed() ->> 'token');
select tests.login_anon();
select is(
  (select array_agg(e ->> 'title') from jsonb_array_elements(public.calendar_feed_events(tests.var('mallory_token')) -> 'events') e),
  array['Mallorys Abend'], 'Mallory sieht nur ihre eigene Crew');

-- ---- Rate Limits ----------------------------------------------------------------------------------
select tests.logout();
delete from public.rate_limit_hits;
select tests.set_var('hits_before', (select count(*) from public.rate_limit_hits)::text);
select tests.login_anon();
select is((select count(*)::int from (select public.calendar_feed_events(repeat('a', 64)) from generate_series(1, 20)) s), 20, '20 Abrufe mit ungültigem Token');
select tests.logout();
select is((select count(*) from public.rate_limit_hits)::text, tests.var('hits_before'), 'ungültige Tokens schreiben keine Zeilen');

select tests.login_anon();
select is(
  (select count(*)::int from (select public.calendar_feed_events(tests.var('alice_token')) ->> 'status' as s from generate_series(1, 60)) r where r.s = 'valid'),
  60, '60 Abrufe je Link in 10 Minuten sind erlaubt');
select throws_ok($$ select public.calendar_feed_events(tests.var('alice_token')) $$, 'P0001', 'rate_limited', 'der 61. Abruf wird gebremst');

select tests.login('bob');
select is((select count(*)::int from (select public.renew_calendar_feed() from generate_series(1, 10)) s), 10, 'neue Links: 10 je Stunde erlaubt');
select throws_ok('select public.renew_calendar_feed()', 'P0001', 'rate_limited', 'der 11. neue Link in einer Stunde wird gebremst');

-- ---- Export und Kontolöschung -------------------------------------------------------------------
select tests.login('alice');
select is(public.export_my_data() #>> '{calendar_feed,active}', 'true', 'Datenexport nennt das Abo');
select ok(public.export_my_data()::text !~ tests.var('alice_token'), 'Datenexport enthält den Link selbst nicht');
select ok(public.export_my_data() -> 'plan_expenses' is not null, 'Datenexport sonst unverändert');
select lives_ok($$ select public.delete_my_account('DELETE') $$, 'Alice löscht ihr Konto');
select tests.logout();
select is((select count(*)::int from public.calendar_feeds where token = tests.var('alice_token')), 0, 'mit dem Konto verschwindet der Link');

select * from finish();
rollback;
