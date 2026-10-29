-- P11 Etappe 2a: Sprache im Profil (user_settings.locale, set_my_locale) – Kalender-Abo und Push liefern sie mit.
begin;
\ir helpers.inc
select no_plan();

grant usage on schema tests to service_role;
grant select, insert, update on tests.vars to service_role;
grant select on tests.users to service_role;

create function tests.login_service() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('role', 'service_role', true);
end $$;

create function tests.p256dh(p_seed text) returns text language sql immutable as $$
  select left(rtrim(translate(encode(sha512(convert_to(p_seed, 'UTF8')) || sha512(convert_to(p_seed || 'x', 'UTF8')), 'base64'), E'+/\n', '-_'), '='), 87) $$;
create function tests.auth_secret(p_seed text) returns text language sql immutable as $$
  select left(rtrim(translate(encode(sha256(convert_to(p_seed, 'UTF8')), 'base64'), E'+/\n', '-_'), '='), 22) $$;

select tests.make_user('Alice');
select tests.make_user('Mallory');

-- ---- Rechte -----------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.set_my_locale(text)', 'execute'), 'anon setzt keine Sprache');
select ok(has_function_privilege('authenticated', 'public.set_my_locale(text)', 'execute'), 'Angemeldete setzen ihre Sprache über die RPC');
select ok(not has_column_privilege('authenticated', 'public.user_settings', 'locale', 'update'), 'die Sprache ist nicht direkt änderbar');
select ok(has_column_privilege('authenticated', 'public.user_settings', 'locale', 'select'), 'die eigene Sprache ist lesbar');

select tests.login_anon();
select throws_ok($$ select public.set_my_locale('en') $$, '42501', null, 'anon scheitert');
select tests.logout();

-- ---- Setzen und lesen -------------------------------------------------------------------------
select is((select locale from public.user_settings where user_id = tests.uid('alice')), null, 'neues Konto: noch keine Sprache');

select tests.login('alice');
select throws_ok($$ select public.set_my_locale(null) $$, 'P0001', 'invalid_locale', 'leer wird abgelehnt');
select throws_ok($$ select public.set_my_locale('fr') $$, 'P0001', 'invalid_locale', 'unbekannte Sprache wird abgelehnt');
select throws_ok($$ select public.set_my_locale('EN') $$, 'P0001', 'invalid_locale', 'nur Kleinbuchstaben');
select throws_ok($$ select public.set_my_locale('en''); drop table public.profiles; --') $$, 'P0001', 'invalid_locale', 'kein eingeschleustes SQL');
select is(public.set_my_locale('en'), 'en', 'Englisch gespeichert');
select is((select locale from public.user_settings where user_id = tests.uid('alice')), 'en', 'Alice liest ihre Sprache');
select throws_ok($$ update public.user_settings set locale = 'de' where user_id = tests.uid('alice') $$, '42501', null, 'direktes Ändern scheitert');
select lives_ok($$ update public.user_settings set typical_budget_cents = 2000 where user_id = tests.uid('alice') $$, 'andere Einstellungen bleiben direkt änderbar');
select is((select locale from public.user_settings where user_id = tests.uid('alice')), 'en', 'und lassen die Sprache stehen');
select tests.logout();

-- Mallory ändert nur ihre eigene Sprache und sieht Alices nicht.
select tests.login('mallory');
select is(public.set_my_locale('de'), 'de', 'Mallory setzt Deutsch');
select is((select count(*)::int from public.user_settings), 1, 'Mallory sieht nur ihre eigenen Einstellungen');
select tests.logout();
select is((select locale from public.user_settings where user_id = tests.uid('alice')), 'en', 'Alices Sprache ist unverändert');
select is((select locale from public.user_settings where user_id = tests.uid('mallory')), 'de', 'Mallorys Sprache gespeichert');

-- Datenexport enthält die Sprache.
select tests.login('alice');
select is(public.export_my_data() -> 'settings' ->> 'locale', 'en', 'Datenexport nennt die Sprache');
select tests.logout();

-- ---- Kalender-Abo -----------------------------------------------------------------------------
select tests.login('alice');
select tests.set_var('alice_token', public.renew_calendar_feed() ->> 'token');
select tests.logout();
select tests.login('mallory');
select tests.set_var('mallory_token', public.renew_calendar_feed() ->> 'token');
select tests.logout();

select tests.login_anon();
select is(public.calendar_feed_events(tests.var('alice_token')) ->> 'locale', 'en', 'Alices Kalender kommt auf Englisch');
select is(public.calendar_feed_events(tests.var('mallory_token')) ->> 'locale', 'de', 'Mallorys Kalender auf Deutsch');
select is(public.calendar_feed_events(tests.var('alice_token')) ->> 'status', 'valid', 'der Kalender bleibt gültig');
select ok(not (public.calendar_feed_events(repeat('0', 64)) ? 'locale'), 'unbekannter Link verrät keine Sprache');
select tests.logout();

-- ---- Push -------------------------------------------------------------------------------------
select tests.login('alice');
select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/alice-handy', tests.p256dh('a'), tests.auth_secret('a'), 'Chrome auf Android');
select tests.logout();
select tests.login('mallory');
select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/mallory-handy', tests.p256dh('m'), tests.auth_secret('m'), 'Chrome auf Android');
select tests.logout();

insert into public.notifications (user_id, type, actor_id, payload) values
  (tests.uid('alice'), 'poll_created', tests.uid('mallory'), '{"title": "Bowling"}'),
  (tests.uid('mallory'), 'poll_created', tests.uid('alice'), '{"title": "Kino"}');

select tests.login('mallory');
select throws_ok($$ select public.claim_push_batch(10) $$, '42501', null, 'Außenstehende holen keine Nachrichten ab');
select tests.logout();

select tests.login_service();
select tests.set_var('batch', public.claim_push_batch(50)::text);
select is((select e -> 'message' ->> 'locale' from jsonb_array_elements(tests.var('batch')::jsonb) e where e ->> 'endpoint' like '%alice-handy'),
  'en', 'Alices Push trägt Englisch');
select is((select e -> 'message' ->> 'locale' from jsonb_array_elements(tests.var('batch')::jsonb) e where e ->> 'endpoint' like '%mallory-handy'),
  'de', 'Mallorys Push trägt Deutsch');
select is((select count(*)::int from jsonb_array_elements(tests.var('batch')::jsonb) e
           where e -> 'message' ->> 'type' = 'poll_created' and e -> 'message' ? 'unread' and e -> 'message' ? 'payload'),
  2, 'der Rest der Nachricht bleibt wie bisher');
select tests.logout();

-- Ohne gesetzte Sprache: null (Service Worker nimmt die Browser-Sprache).
select tests.make_user('Neu');
select tests.login('neu');
select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/neu-handy', tests.p256dh('n'), tests.auth_secret('n'), 'Chrome auf Android');
select tests.logout();
insert into public.notifications (user_id, type, actor_id, payload) values (tests.uid('neu'), 'poll_created', tests.uid('alice'), '{"title": "X"}');
select tests.login_service();
select is((select e -> 'message' -> 'locale' from jsonb_array_elements(public.claim_push_batch(50)) e where e ->> 'endpoint' like '%neu-handy'),
  'null'::jsonb, 'ohne Sprache im Profil: null');
select tests.logout();

-- ---- Rate Limit -------------------------------------------------------------------------------
select tests.login('mallory');
select public.set_my_locale(case when i % 2 = 0 then 'en' else 'de' end) from generate_series(1, 29) i;
select throws_ok($$ select public.set_my_locale('en') $$, 'P0001', 'rate_limited', 'höchstens 30 Wechsel in 10 Minuten');
select tests.logout();

select * from finish();
rollback;
