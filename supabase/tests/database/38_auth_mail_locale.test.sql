-- P11 Etappe 2d: set_my_locale schreibt die Sprache auch in die Konto-Metadaten (Sprache der Auth-E-Mails).
begin;
\ir helpers.inc
select no_plan();

create function tests.meta(p_name text) returns jsonb
language sql security definer set search_path = '' as $$
  select raw_user_meta_data from auth.users where id = tests.uid(p_name) $$;

select tests.make_user('Alice');
select tests.make_user('Mallory');

-- ---- Rechte: Metadaten nur über die RPC, nie direkt ---------------------------------------------
select ok(not has_table_privilege('authenticated', 'auth.users', 'update'), 'Angemeldete ändern auth.users nicht direkt');
select ok(not has_table_privilege('anon', 'auth.users', 'update'), 'anon ändert auth.users nicht');
select ok(not has_function_privilege('anon', 'public.set_my_locale(text)', 'execute'), 'anon setzt keine Sprache');

select is(tests.meta('alice') ->> 'locale', null, 'neues Konto: keine Sprache in den Metadaten');

-- ---- Wechsel landet in den Metadaten, Rest bleibt --------------------------------------------
select tests.login('alice');
select is(public.set_my_locale('en'), 'en', 'Alice wechselt auf Englisch');
select tests.logout();
select is(tests.meta('alice') ->> 'locale', 'en', 'Metadaten: locale = en');
select is(tests.meta('alice') ->> 'display_name', 'Alice', 'Anzeigename in den Metadaten bleibt');

select tests.login('alice');
select public.set_my_locale('de');
select tests.logout();
select is(tests.meta('alice') ->> 'locale', 'de', 'zurück auf Deutsch: locale = de');

-- Ungültige Werte ändern nichts.
select tests.login('alice');
select throws_ok($$ select public.set_my_locale('fr') $$, 'P0001', 'invalid_locale', 'unbekannte Sprache abgewiesen');
select tests.logout();
select is(tests.meta('alice') ->> 'locale', 'de', 'nach abgewiesenem Wert weiter de');

-- ---- Außenstehende: Mallory ändert nur ihr eigenes Konto --------------------------------------
select tests.login('mallory');
select public.set_my_locale('en');
select tests.logout();
select is(tests.meta('mallory') ->> 'locale', 'en', 'Mallorys Metadaten: en');
select is(tests.meta('alice') ->> 'locale', 'de', 'Alices Metadaten unverändert');

select tests.login_anon();
select throws_ok($$ select public.set_my_locale('en') $$, '42501', null, 'ohne Konto scheitert der Aufruf');
select tests.logout();

-- Konto ohne Metadaten (null) bekommt ein Objekt mit nur der Sprache.
update auth.users set raw_user_meta_data = null where id = tests.uid('mallory');
select tests.login('mallory');
select public.set_my_locale('de');
select tests.logout();
select is(tests.meta('mallory'), '{"locale": "de"}'::jsonb, 'Metadaten null → {"locale": "de"}');

select * from finish();
rollback;
