-- P4 Etappe 1: Web-Push – Geräte anmelden, Warteschlange, Versand nur durch die Edge Function.
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

-- Gültige Schlüssel im Format der Browser (base64url: 65 bzw. 16 Byte).
create function tests.p256dh(p_seed text) returns text language sql immutable as $$
  select left(rtrim(translate(encode(sha512(convert_to(p_seed, 'UTF8')) || sha512(convert_to(p_seed || 'x', 'UTF8')), 'base64'), E'+/\n', '-_'), '='), 87) $$;
create function tests.auth_secret(p_seed text) returns text language sql immutable as $$
  select left(rtrim(translate(encode(sha256(convert_to(p_seed, 'UTF8')), 'base64'), E'+/\n', '-_'), '='), 22) $$;

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Mallory');

-- ---- Rechte -----------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.save_push_subscription(text, text, text, text)', 'execute'), 'anon kann kein Gerät anmelden');
select ok(not has_function_privilege('anon', 'public.delete_push_subscription(text)', 'execute'), 'anon kann kein Gerät abmelden');
select ok(not has_function_privilege('anon', 'public.push_kick()', 'execute'), 'anon kann den Versand nicht anstoßen');
select ok(not has_function_privilege('anon', 'public.claim_push_batch(integer)', 'execute'), 'anon kann keine Nachrichten abholen');
select ok(not has_function_privilege('authenticated', 'public.claim_push_batch(integer)', 'execute'), 'Angemeldete können keine Nachrichten (mit fremden Geräteschlüsseln) abholen');
select ok(not has_function_privilege('authenticated', 'public.report_push_results(jsonb)', 'execute'), 'Angemeldete können keine Versandergebnisse melden');
select ok(has_function_privilege('service_role', 'public.claim_push_batch(integer)', 'execute'), 'die Edge Function holt Nachrichten ab');
select ok(has_function_privilege('service_role', 'public.report_push_results(jsonb)', 'execute'), 'die Edge Function meldet Ergebnisse');
select ok(not has_function_privilege('authenticated', 'app_private.queue_push()', 'execute'), 'der Warteschlangen-Trigger ist nicht aufrufbar');
select ok(not has_table_privilege('authenticated', 'app_private.push_outbox', 'select'), 'die Warteschlange ist für Angemeldete nicht lesbar');
select ok(not has_column_privilege('authenticated', 'public.push_subscriptions', 'p256dh', 'select'), 'Geräteschlüssel sind nicht lesbar');
select ok(not has_column_privilege('authenticated', 'public.push_subscriptions', 'auth', 'select'), 'Auth-Geheimnisse sind nicht lesbar');
select ok(not has_table_privilege('authenticated', 'public.push_subscriptions', 'insert'), 'keine direkten Schreibrechte (insert)');
select ok(not has_table_privilege('authenticated', 'public.push_subscriptions', 'update'), 'keine direkten Schreibrechte (update)');
select ok(not has_table_privilege('authenticated', 'public.push_subscriptions', 'delete'), 'keine direkten Schreibrechte (delete)');

select tests.login_anon();
select throws_ok($$ select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/abcdefgh', 'x', 'y') $$, '42501', null, 'anon scheitert beim Anmelden');
select throws_ok($$ select public.push_kick() $$, '42501', null, 'anon scheitert beim Anstoßen');
select throws_ok($$ select endpoint from public.push_subscriptions $$, '42501', null, 'anon liest keine Geräte');
select tests.logout();

-- ---- Anmelden -----------------------------------------------------------------------------------
select tests.login('alice');
select throws_ok(format($$ select public.save_push_subscription('http://fcm.googleapis.com/fcm/send/abcdefgh', %L, %L) $$, tests.p256dh('a'), tests.auth_secret('a')),
  'P0001', 'invalid_push_subscription', 'nur https-Adressen');
select throws_ok(format($$ select public.save_push_subscription('https://169.254.169.254 /x/abcdefghijk', %L, %L) $$, tests.p256dh('a'), tests.auth_secret('a')),
  'P0001', 'invalid_push_subscription', 'Adressen mit Leerzeichen werden abgelehnt');
select throws_ok(format($$ select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/abcdefgh', 'kurz', %L) $$, tests.auth_secret('a')),
  'P0001', 'invalid_push_subscription', 'unvollständiger Geräteschlüssel wird abgelehnt');
select throws_ok(format($$ select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/abcdefgh', %L, 'nicht/base64url+==') $$, tests.p256dh('a')),
  'P0001', 'invalid_push_subscription', 'ungültiges Auth-Geheimnis wird abgelehnt');

select tests.set_var('sub_a', public.save_push_subscription('https://fcm.googleapis.com/fcm/send/alice-handy-1',
  tests.p256dh('a'), tests.auth_secret('a'), E'Chrome\n auf \u0001Android')::text);
select isnt(tests.var('sub_a'), null, 'Alice meldet ihr Handy an');
select is((select label from public.push_subscriptions where id = tests.var('sub_a')::uuid), 'Chrome auf Android', 'Gerätename wird bereinigt');
select is((select count(*)::int from public.push_subscriptions), 1, 'Alice sieht ihr Gerät');
select throws_ok($$ select p256dh from public.push_subscriptions $$, '42501', null, 'Alice liest auch die eigenen Schlüssel nicht');
select throws_ok($$ insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (auth.uid(), 'https://x.example/abcdefghijklmnop', 'a', 'b') $$,
  '42501', null, 'direktes Eintragen scheitert');
-- Erneut anmelden ändert nichts an der Zahl, aktualisiert aber die Schlüssel.
select is(public.save_push_subscription('https://fcm.googleapis.com/fcm/send/alice-handy-1', tests.p256dh('a2'), tests.auth_secret('a2'), 'Chrome auf Android')::text,
  tests.var('sub_a'), 'dasselbe Gerät behält seine Kennung');
select tests.logout();
select is((select p256dh from public.push_subscriptions where id = tests.var('sub_a')::uuid), tests.p256dh('a2'), 'neue Schlüssel werden übernommen');

select tests.login('bob');
select is((select count(*)::int from public.push_subscriptions), 0, 'Bob sieht Alices Geräte nicht');
select tests.logout();

-- Höchstens 10 Geräte je Person – das älteste fällt weg.
select tests.login('mallory');
select public.save_push_subscription('https://updates.push.services.mozilla.com/wpush/v2/m-' || i, tests.p256dh('m' || i), tests.auth_secret('m' || i), null)
from generate_series(1, 10) i;
select tests.logout();
update public.push_subscriptions set created_at = now() - interval '1 minute' * (20 - substring(endpoint from 'm-([0-9]+)$')::int)
where user_id = tests.uid('mallory');
select tests.login('mallory');
select public.save_push_subscription('https://updates.push.services.mozilla.com/wpush/v2/m-' || i, tests.p256dh('m' || i), tests.auth_secret('m' || i), null)
from generate_series(11, 12) i;
select is((select count(*)::int from public.push_subscriptions), 10, 'höchstens 10 Geräte je Person');
select is((select count(*)::int from public.push_subscriptions where endpoint ~ '/m-[12]$'), 0, 'die ältesten Geräte fallen weg');
-- Mallory kann Alices Gerät weder abmelden noch sehen.
select public.delete_push_subscription('https://fcm.googleapis.com/fcm/send/alice-handy-1');
select tests.logout();
select is((select count(*)::int from public.push_subscriptions where id = tests.var('sub_a')::uuid), 1, 'fremdes Gerät abmelden ändert nichts');

-- Ein Gerät gehört der Person, die es zuletzt angemeldet hat.
select tests.login('bob');
select public.save_push_subscription('https://web.push.apple.com/geteiltes-ipad', tests.p256dh('ipad'), tests.auth_secret('ipad'), 'Safari auf iPad');
select tests.logout();
select tests.login('alice');
select public.save_push_subscription('https://web.push.apple.com/geteiltes-ipad', tests.p256dh('ipad2'), tests.auth_secret('ipad2'), 'Safari auf iPad');
select is((select count(*)::int from public.push_subscriptions), 2, 'Alice hat jetzt Handy und iPad');
select tests.logout();
select is((select user_id from public.push_subscriptions where endpoint = 'https://web.push.apple.com/geteiltes-ipad'), tests.uid('alice'), 'das iPad gehört jetzt Alice');
select is((select count(*)::int from public.push_subscriptions where user_id = tests.uid('bob')), 0, 'Bob bekommt dort nichts mehr');

-- ---- Warteschlange ----------------------------------------------------------------------------
insert into public.notifications (user_id, type, actor_id, entity_type, related_entity_id, payload)
values (tests.uid('alice'), 'poll_created', tests.uid('bob'), 'poll', gen_random_uuid(), jsonb_build_object('title', 'Bowling am Freitag'));
select is((select count(*)::int from app_private.push_outbox o join public.notifications n on n.id = o.notification_id where n.user_id = tests.uid('alice')),
  2, 'eine neue Benachrichtigung geht an beide Geräte von Alice');
insert into public.notifications (user_id, type, actor_id, payload) values (tests.uid('bob'), 'crew_member_joined', tests.uid('alice'), '{}');
select is((select count(*)::int from app_private.push_outbox o join public.notifications n on n.id = o.notification_id where n.user_id = tests.uid('bob')),
  0, 'ohne angemeldetes Gerät entsteht nichts');
-- Abgeschaltete Gruppe: keine Benachrichtigung, also auch kein Push.
update public.user_settings set notification_preferences = '{"poll_vote": false}' where user_id = tests.uid('alice');
select app_private.notify(tests.uid('alice'), 'poll_vote', tests.uid('bob'), null, 'poll', gen_random_uuid(), '{"title": "X"}');
select is((select count(*)::int from app_private.push_outbox o join public.notifications n on n.id = o.notification_id where n.type = 'poll_vote'),
  0, 'abgeschaltete Benachrichtigungen kommen auch nicht als Push');

-- ---- Anstoßen -----------------------------------------------------------------------------------
select tests.login('mallory');
select is(public.push_kick(), true, 'Angemeldete erfahren nur, ob etwas zu verschicken ist');
select tests.logout();

-- ---- Abholen und Ergebnis ---------------------------------------------------------------------
select tests.login('mallory');
select throws_ok($$ select public.claim_push_batch(10) $$, '42501', null, 'Außenstehende holen keine Nachrichten ab');
select throws_ok($$ select public.report_push_results('[]'::jsonb) $$, '42501', null, 'Außenstehende melden keine Ergebnisse');
select tests.logout();

select tests.login_service();
select tests.set_var('batch', public.claim_push_batch(50)::text);
select is(jsonb_array_length(tests.var('batch')::jsonb), 2, 'zwei Nachrichten abgeholt');
select is((select count(*)::int from jsonb_array_elements(tests.var('batch')::jsonb) e
           where e -> 'message' ->> 'type' = 'poll_created' and e -> 'message' ->> 'actor' = 'Bob'
             and e -> 'message' -> 'payload' ->> 'title' = 'Bowling am Freitag' and (e -> 'message' ->> 'unread')::int = 1),
  2, 'jede Nachricht trägt Art, Name der auslösenden Person, Inhalt und Zahl der ungelesenen');
select is((select count(*)::int from jsonb_array_elements(tests.var('batch')::jsonb) e
           where e ->> 'p256dh' ~ '^[A-Za-z0-9_-]{87}$' and e ->> 'auth' ~ '^[A-Za-z0-9_-]{22}$' and e ->> 'urgency' = 'normal'),
  2, 'mit den Schlüsseln des Geräts zum Verschlüsseln');
select ok(not (tests.var('batch') ~ 'example.test'), 'keine E-Mail-Adressen in der Nachricht');
select is(jsonb_array_length(public.claim_push_batch(50)), 0, 'in Arbeit befindliche Nachrichten werden nicht doppelt abgeholt');
select tests.logout();

select tests.login('mallory');
select is(public.push_kick(), false, 'solange alles in Arbeit ist, gibt es nichts anzustoßen');
select tests.logout();

select tests.login_service();
select tests.set_var('handy', (select e ->> 'id' from jsonb_array_elements(tests.var('batch')::jsonb) e where e ->> 'endpoint' like '%alice-handy-1'));
select tests.set_var('ipad', (select e ->> 'id' from jsonb_array_elements(tests.var('batch')::jsonb) e where e ->> 'endpoint' like '%geteiltes-ipad'));
select throws_ok($$ select public.report_push_results('{"id": 1}'::jsonb) $$, 'P0001', 'invalid_push_results', 'Ergebnisse müssen eine Liste sein');
select is(public.report_push_results(jsonb_build_array(
  jsonb_build_object('id', tests.var('handy')::bigint, 'result', 'sent'),
  jsonb_build_object('id', tests.var('ipad')::bigint, 'result', 'retry'),
  jsonb_build_object('id', 999999999, 'result', 'sent'),
  jsonb_build_object('id', 'x', 'result', 'sent'),
  jsonb_build_object('id', tests.var('handy')::bigint, 'result', 'kaputt'))), 2, 'nur bekannte Einträge mit gültigem Ergebnis zählen');
select tests.logout();
select is((select count(*)::int from app_private.push_outbox where id = tests.var('handy')::bigint), 0, 'verschickte Nachricht ist erledigt');
select isnt((select last_success_at from public.push_subscriptions where id = tests.var('sub_a')::uuid), null, 'das Handy hat zuletzt erfolgreich empfangen');
select is((select attempts from app_private.push_outbox where id = tests.var('ipad')::bigint), 1, 'gescheiterte Nachricht bleibt für einen neuen Versuch');

-- Nach zwei Minuten darf ein neuer Lauf sie versuchen; nach drei Versuchen ist Schluss.
update app_private.push_outbox set claimed_at = now() - interval '3 minutes' where id = tests.var('ipad')::bigint;
select tests.login_service();
select is(jsonb_array_length(public.claim_push_batch(50)), 1, 'zweiter Versuch nach zwei Minuten');
select tests.logout();
update app_private.push_outbox set claimed_at = now() - interval '3 minutes', attempts = 3 where id = tests.var('ipad')::bigint;
select tests.login_service();
select is(jsonb_array_length(public.claim_push_batch(50)), 0, 'nach drei Versuchen kein weiterer');
select tests.logout();
select is((select count(*)::int from app_private.push_outbox where id = tests.var('ipad')::bigint), 0, 'und der Eintrag ist aufgeräumt');

-- Gelesene Benachrichtigungen werden nicht mehr verschickt, liegengebliebene nach einem Tag verworfen.
insert into public.notifications (user_id, type, actor_id, payload) values (tests.uid('alice'), 'poll_reminder', tests.uid('bob'), '{"title": "Gelesen"}');
update public.notifications set read_at = now() where type = 'poll_reminder';
insert into public.notifications (user_id, type, actor_id, payload) values (tests.uid('alice'), 'plan_changed', tests.uid('bob'), '{"title": "Alt"}');
update app_private.push_outbox o set created_at = now() - interval '25 hours'
from public.notifications n where n.id = o.notification_id and n.type = 'plan_changed';
insert into public.notifications (user_id, type, actor_id, payload) values (tests.uid('alice'), 'spontaneous_ask', tests.uid('bob'), jsonb_build_object('note', repeat('x', 3000)));
select tests.login_service();
select tests.set_var('batch2', public.claim_push_batch(50)::text);
select tests.logout();
select is((select string_agg(distinct e -> 'message' ->> 'type', ',') from jsonb_array_elements(tests.var('batch2')::jsonb) e), 'spontaneous_ask',
  'gelesene und über einen Tag alte Benachrichtigungen werden nicht verschickt');
select is((select count(*)::int from jsonb_array_elements(tests.var('batch2')::jsonb) e where e ->> 'urgency' = 'high' and e -> 'message' -> 'payload' = '{}'::jsonb),
  2, '„Heute noch wer?“ eilt; zu große Inhalte kommen ohne Einzelheiten');

-- Abgemeldetes Gerät (404/410 beim Push-Dienst): weg, samt Warteschlange.
select tests.login_service();
select public.report_push_results((select jsonb_agg(jsonb_build_object('id', (e ->> 'id')::bigint, 'result', 'gone'))
  from jsonb_array_elements(tests.var('batch2')::jsonb) e where e ->> 'endpoint' like '%geteiltes-ipad'));
select tests.logout();
select is((select count(*)::int from public.push_subscriptions where endpoint like '%geteiltes-ipad'), 0, 'abgemeldetes Gerät wird entfernt');

-- ---- Abmelden ---------------------------------------------------------------------------------
select tests.login('alice');
select public.delete_push_subscription('https://fcm.googleapis.com/fcm/send/alice-handy-1');
select is((select count(*)::int from public.push_subscriptions), 0, 'Alice meldet ihr Handy ab');
select tests.logout();
select is((select count(*)::int from app_private.push_outbox o join public.notifications n on n.id = o.notification_id where n.user_id = tests.uid('alice')),
  0, 'mit dem Gerät verschwindet, was noch für es anstand');

-- ---- Datenexport und Konto löschen ---------------------------------------------------------------
select tests.login('mallory');
select is(jsonb_array_length(public.export_my_data() -> 'push_devices'), 10, 'Export nennt die eigenen Geräte');
select ok(not (public.export_my_data()::text ~ 'mozilla\.com'), 'Export ohne Geräteadresse');
select ok(not (public.export_my_data()::text ~ tests.p256dh('m12')), 'Export ohne Schlüssel');
select tests.logout();
delete from auth.users where id = tests.uid('mallory');
select is((select count(*)::int from public.push_subscriptions where endpoint like '%/m-%'), 0, 'Konto löschen entfernt alle Geräte');

-- ---- Rate Limits --------------------------------------------------------------------------------
select tests.login('bob');
select public.push_kick() from generate_series(1, 60);
select throws_ok($$ select public.push_kick() $$, 'P0001', 'rate_limited', 'Anstoßen höchstens 60-mal in 10 Minuten');
select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/bob-' || i, tests.p256dh('b' || i), tests.auth_secret('b' || i), null)
from generate_series(1, 19) i;
select throws_ok(format($$ select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/bob-x', %L, %L) $$, tests.p256dh('bx'), tests.auth_secret('bx')),
  'P0001', 'rate_limited', 'höchstens 20 Anmeldungen je Stunde');
select tests.logout();

-- Ein Gerät, das immer wieder scheitert (z. B. Schlüssel passen nicht mehr), fällt nach 20 Fehlschlägen weg.
select tests.login('alice');
select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/alice-alt', tests.p256dh('alt'), tests.auth_secret('alt'), null);
select tests.logout();
insert into public.notifications (user_id, type, actor_id, payload) values (tests.uid('alice'), 'plan_created', tests.uid('bob'), '{"title": "Kino"}');
update public.push_subscriptions set failure_count = 18 where endpoint like '%alice-alt';
select tests.login_service();
select tests.set_var('batch3', public.claim_push_batch(50)::text);
select public.report_push_results((select jsonb_agg(jsonb_build_object('id', (e ->> 'id')::bigint, 'result', 'retry')) from jsonb_array_elements(tests.var('batch3')::jsonb) e));
select tests.logout();
select is((select failure_count from public.push_subscriptions where endpoint like '%alice-alt'), 19, 'Fehlschläge werden gezählt');
update app_private.push_outbox set claimed_at = now() - interval '3 minutes';
select tests.login_service();
select tests.set_var('batch3', public.claim_push_batch(50)::text);
select public.report_push_results((select jsonb_agg(jsonb_build_object('id', (e ->> 'id')::bigint, 'result', 'retry')) from jsonb_array_elements(tests.var('batch3')::jsonb) e));
select tests.logout();
select is((select count(*)::int from public.push_subscriptions where endpoint like '%alice-alt'), 0, 'nach 20 Fehlschlägen wird das Gerät entfernt');

select * from finish();
rollback;
