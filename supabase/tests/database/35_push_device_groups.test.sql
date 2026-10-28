-- P4 Etappe 3: Je Gerät wählen, was als Push ankommt (push_subscriptions.muted_types, set_push_muted_types).
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

-- Zahl der wartenden Pushs je Gerät und Art.
create function tests.queued(p_endpoint text, p_type text) returns integer
language sql security definer set search_path = '' as $$
  select count(*)::int from app_private.push_outbox o
  join public.push_subscriptions s on s.id = o.subscription_id
  join public.notifications n on n.id = o.notification_id
  where s.endpoint = p_endpoint and n.type = p_type $$;

select tests.make_user('Alice');
select tests.make_user('Mallory');

-- ---- Rechte -----------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.set_push_muted_types(text, text[])', 'execute'), 'anon kann keine Auswahl setzen');
select ok(has_function_privilege('authenticated', 'public.set_push_muted_types(text, text[])', 'execute'), 'Angemeldete setzen die Auswahl über die RPC');
select ok(not has_column_privilege('authenticated', 'public.push_subscriptions', 'muted_types', 'update'), 'die Auswahl ist nicht direkt änderbar');
select ok(has_column_privilege('authenticated', 'public.push_subscriptions', 'muted_types', 'select'), 'die eigene Auswahl ist lesbar');
select ok(not has_column_privilege('authenticated', 'public.push_subscriptions', 'p256dh', 'select'), 'Geräteschlüssel bleiben unlesbar');

select tests.login_anon();
select throws_ok($$ select public.set_push_muted_types('https://fcm.googleapis.com/fcm/send/alice-handy', '{}') $$, '42501', null, 'anon scheitert');
select tests.logout();

-- ---- Zwei Geräte: Handy stumm für Antworten, Laptop bekommt alles -------------------------------
select tests.login('alice');
select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/alice-handy', tests.p256dh('h'), tests.auth_secret('h'), 'Chrome auf Android');
select public.save_push_subscription('https://updates.push.services.mozilla.com/wpush/v2/alice-laptop', tests.p256dh('l'), tests.auth_secret('l'), 'Firefox auf Windows');
select is((select muted_types from public.push_subscriptions where endpoint like '%alice-handy'), '{}'::text[], 'neues Gerät bekommt erst einmal alles');

select throws_ok($$ select public.set_push_muted_types('https://fcm.googleapis.com/fcm/send/alice-handy', null) $$, 'P0001', 'invalid_push_muted_types', 'leere Angabe wird abgelehnt');
select throws_ok($$ select public.set_push_muted_types('https://fcm.googleapis.com/fcm/send/alice-handy', array['poll_vote', 'Robert''); drop table x']) $$,
  'P0001', 'invalid_push_muted_types', 'nur Kleinbuchstaben und Unterstrich');
select throws_ok($$ select public.set_push_muted_types('https://fcm.googleapis.com/fcm/send/alice-handy', array['poll_vote', null]) $$,
  'P0001', 'invalid_push_muted_types', 'keine leeren Einträge');
select throws_ok($$ select public.set_push_muted_types('https://fcm.googleapis.com/fcm/send/alice-handy', array(select 'typ_' || chr(96 + i) from generate_series(1, 26) i) || array(select 'art_' || chr(96 + i) from generate_series(1, 15) i)) $$,
  'P0001', 'invalid_push_muted_types', 'höchstens 40 Arten');
select throws_ok($$ select public.set_push_muted_types('https://fcm.googleapis.com/fcm/send/unbekannt', '{}') $$,
  'P0001', 'push_device_not_found', 'unbekanntes Gerät');

select is(public.set_push_muted_types(' https://fcm.googleapis.com/fcm/send/alice-handy ', array['poll_vote', 'plan_attendance', 'poll_vote', 'reward_earned']),
  array['plan_attendance', 'poll_vote', 'reward_earned'], 'Auswahl gespeichert: sortiert, ohne Dubletten');
select is((select muted_types from public.push_subscriptions where endpoint like '%alice-handy'), array['plan_attendance', 'poll_vote', 'reward_earned'], 'Alice liest die Auswahl ihres Handys');
select is((select muted_types from public.push_subscriptions where endpoint like '%alice-laptop'), '{}'::text[], 'der Laptop bleibt unberührt');
select throws_ok($$ update public.push_subscriptions set muted_types = '{}' $$, '42501', null, 'direktes Ändern scheitert');
select tests.logout();

-- Mallory kann Alices Gerät nicht umstellen – auch nicht mit der richtigen Adresse.
select tests.login('mallory');
select throws_ok($$ select public.set_push_muted_types('https://fcm.googleapis.com/fcm/send/alice-handy', '{}') $$,
  'P0001', 'push_device_not_found', 'fremdes Gerät: wie unbekannt');
select is((select count(*)::int from public.push_subscriptions), 0, 'Mallory sieht Alices Geräte nicht');
select tests.logout();
select is((select muted_types from public.push_subscriptions where endpoint like '%alice-handy'), array['plan_attendance', 'poll_vote', 'reward_earned'], 'Alices Auswahl ist unverändert');

-- ---- Warteschlange ----------------------------------------------------------------------------
insert into public.notifications (user_id, type, actor_id, payload) values (tests.uid('alice'), 'poll_vote', tests.uid('mallory'), '{"title": "X"}');
insert into public.notifications (user_id, type, actor_id, payload) values (tests.uid('alice'), 'poll_created', tests.uid('mallory'), '{"title": "Bowling"}');
select is(tests.queued('https://fcm.googleapis.com/fcm/send/alice-handy', 'poll_vote'), 0, 'stumme Art kommt nicht aufs Handy');
select is(tests.queued('https://updates.push.services.mozilla.com/wpush/v2/alice-laptop', 'poll_vote'), 1, 'aber auf den Laptop');
select is(tests.queued('https://fcm.googleapis.com/fcm/send/alice-handy', 'poll_created'), 1, 'andere Arten kommen weiter aufs Handy');
select is((select count(*)::int from public.notifications where user_id = tests.uid('alice') and type = 'poll_vote'), 1, 'in der App erscheint die Benachrichtigung trotzdem');

-- Wird eine Art stummgeschaltet, geht schon Wartendes für dieses Gerät nicht mehr raus – für andere schon.
insert into public.notifications (user_id, type, actor_id, payload) values (tests.uid('alice'), 'plan_changed', tests.uid('mallory'), '{"title": "Neu"}');
select is(tests.queued('https://fcm.googleapis.com/fcm/send/alice-handy', 'plan_changed'), 1, 'Planänderung wartet fürs Handy');
select tests.login('alice');
select public.set_push_muted_types('https://fcm.googleapis.com/fcm/send/alice-handy', array['plan_changed', 'poll_vote']);
select tests.logout();
select is(tests.queued('https://fcm.googleapis.com/fcm/send/alice-handy', 'plan_changed'), 0, 'frisch stummgeschaltet: Wartendes fällt weg');
select is(tests.queued('https://fcm.googleapis.com/fcm/send/alice-handy', 'poll_created'), 1, 'andere Arten warten weiter');
select is(tests.queued('https://updates.push.services.mozilla.com/wpush/v2/alice-laptop', 'plan_changed'), 1, 'der Laptop bekommt die Planänderung');

select tests.login_service();
select is((select count(*)::int from jsonb_array_elements(public.claim_push_batch(50)) e
           where e ->> 'endpoint' like '%alice-handy' and e -> 'message' ->> 'type' in ('plan_changed', 'poll_vote')),
  0, 'die Function holt für das Handy nichts Stummes ab');
select tests.logout();

-- Wieder alles: neue Benachrichtigungen kommen wieder aufs Handy.
select tests.login('alice');
select is(public.set_push_muted_types('https://fcm.googleapis.com/fcm/send/alice-handy', '{}'), '{}'::text[], '„Alles“ leert die Auswahl');
select tests.logout();
insert into public.notifications (user_id, type, actor_id, payload) values (tests.uid('alice'), 'poll_vote', tests.uid('mallory'), '{"title": "Y"}');
select is(tests.queued('https://fcm.googleapis.com/fcm/send/alice-handy', 'poll_vote'), 1, 'danach kommt die Art wieder aufs Handy');

-- Erneut anmelden (z. B. neue Schlüssel) behält die Auswahl.
select tests.login('alice');
select public.set_push_muted_types('https://fcm.googleapis.com/fcm/send/alice-handy', array['reward_earned']);
select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/alice-handy', tests.p256dh('h2'), tests.auth_secret('h2'), 'Chrome auf Android');
select is((select muted_types from public.push_subscriptions where endpoint like '%alice-handy'), array['reward_earned'], 'neue Schlüssel, gleiche Auswahl');
select tests.logout();

-- Übernimmt eine andere Person das Gerät, beginnt sie ohne die Auswahl der vorigen.
select tests.login('mallory');
select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/alice-handy', tests.p256dh('m'), tests.auth_secret('m'), 'Chrome auf Android');
select is((select muted_types from public.push_subscriptions where endpoint like '%alice-handy'), '{}'::text[], 'neue Besitzerin bekommt erst einmal alles');
select tests.logout();

-- ---- Datenexport ------------------------------------------------------------------------------
select tests.login('alice');
select public.set_push_muted_types('https://updates.push.services.mozilla.com/wpush/v2/alice-laptop', array['reward_earned']);
select is((select d -> 'muted_types' from jsonb_array_elements(public.export_my_data() -> 'push_devices') d where d ->> 'label' = 'Firefox auf Windows'),
  '["reward_earned"]'::jsonb, 'der Export nennt die Auswahl je Gerät');
select ok(not (public.export_my_data()::text ~ 'alice-laptop'), 'ohne Geräteadresse');
select tests.logout();

-- ---- Rate Limit -------------------------------------------------------------------------------
select tests.login('alice');
select throws_ok($$ select public.set_push_muted_types('https://updates.push.services.mozilla.com/wpush/v2/alice-laptop', '{}') from generate_series(1, 70) $$,
  'P0001', 'rate_limited', 'Rate Limit für die Auswahl');
select tests.logout();

select * from finish();
rollback;
