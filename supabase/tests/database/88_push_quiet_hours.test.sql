-- P49: Nachtruhe fürs Handy – `set_push_quiet_hours` (nur für sich selbst, volle Stunden 0–23, Von ≠ Bis, beide null = aus),
-- Spalten nur über die RPC änderbar und nur für sich lesbar. In der Nachtruhe kommt nichts in die Push-Warteschlange
-- (in der App schon), Wartendes fällt beim Beginn weg (RPC und `claim_push_batch`), andere Personen sind nicht betroffen.
-- Fenster über Mitternacht und über die Zeitumstellung in Berliner Zeit. Export enthält die Einstellung.
begin;
\ir helpers.inc
select no_plan();

create function tests.p256dh(p_seed text) returns text language sql immutable as $$
  select left(rtrim(translate(encode(sha512(convert_to(p_seed, 'UTF8')) || sha512(convert_to(p_seed || 'x', 'UTF8')), 'base64'), E'+/\n', '-_'), '='), 87) $$;
create function tests.auth_secret(p_seed text) returns text language sql immutable as $$
  select left(rtrim(translate(encode(sha256(convert_to(p_seed, 'UTF8')), 'base64'), E'+/\n', '-_'), '='), 22) $$;

create function tests.queued(p_user uuid) returns integer
language sql security definer set search_path = '' as $$
  select count(*)::int from app_private.push_outbox o
  join public.notifications n on n.id = o.notification_id
  where n.user_id = p_user $$;

create function tests.ping(p_user uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, type, payload) values (p_user, 'poll_vote', '{"title": "X"}') $$;

-- Aktuelle Stunde in Berlin (now() steht in der Transaktion fest) und Fenster, die jetzt gelten bzw. nicht gelten.
select tests.set_var('h', extract(hour from now() at time zone 'Europe/Berlin')::int::text);
select tests.set_var('now_from', tests.var('h'));
select tests.set_var('now_to', ((tests.var('h')::int + 1) % 24)::text);
select tests.set_var('later_from', ((tests.var('h')::int + 1) % 24)::text);
select tests.set_var('later_to', ((tests.var('h')::int + 2) % 24)::text);

select tests.make_user('Alice');
select tests.make_user('Bob');

select tests.login('alice');
select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/alice-handy', tests.p256dh('a'), tests.auth_secret('a'), 'Chrome auf Android');
select public.save_push_subscription('https://updates.push.services.mozilla.com/wpush/v2/alice-laptop', tests.p256dh('a2'), tests.auth_secret('a2'), 'Firefox auf Linux');
select tests.login('bob');
select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/bob-handy', tests.p256dh('b'), tests.auth_secret('b'), 'Chrome auf Android');
select tests.logout();

-- ---- Fenster rechnen (Berliner Zeit) ----------------------------------------------------------------
select ok(app_private.in_quiet_hours(23::smallint, 8::smallint, '2026-11-12 23:30+01'), '23–8: 23:30 ist Nachtruhe');
select ok(app_private.in_quiet_hours(23::smallint, 8::smallint, '2026-11-13 07:59+01'), '23–8: 7:59 ist Nachtruhe');
select ok(not app_private.in_quiet_hours(23::smallint, 8::smallint, '2026-11-13 08:00+01'), '23–8: um 8 ist Schluss');
select ok(not app_private.in_quiet_hours(23::smallint, 8::smallint, '2026-11-12 22:59+01'), '23–8: 22:59 noch nicht');
select ok(app_private.in_quiet_hours(23::smallint, 8::smallint, '2026-07-01 21:30+00'), 'Sommerzeit: 21:30 UTC ist 23:30 in Berlin');
select ok(not app_private.in_quiet_hours(23::smallint, 8::smallint, '2026-07-01 06:30+00'), 'Sommerzeit: 6:30 UTC ist 8:30 in Berlin');
select ok(app_private.in_quiet_hours(0::smallint, 9::smallint, '2026-11-13 00:00+01'), '0–9: Mitternacht gehört dazu');
select ok(app_private.in_quiet_hours(13::smallint, 15::smallint, '2026-11-13 14:10+01'), 'tagsüber 13–15: 14:10');
select ok(not app_private.in_quiet_hours(13::smallint, 15::smallint, '2026-11-13 15:00+01'), 'tagsüber 13–15: 15:00 nicht');
select ok(not app_private.in_quiet_hours(null, null, '2026-11-13 02:00+01'), 'ohne Fenster keine Nachtruhe');

-- ---- Rechte ----------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.set_push_quiet_hours(integer, integer)', 'execute'), 'anon darf nichts einstellen');
select ok(has_function_privilege('authenticated', 'public.set_push_quiet_hours(integer, integer)', 'execute'), 'Angemeldete stellen über die RPC ein');
select ok(not has_column_privilege('authenticated', 'public.user_settings', 'push_quiet_from', 'update'), 'Spalte nicht direkt änderbar (von)');
select ok(not has_column_privilege('authenticated', 'public.user_settings', 'push_quiet_to', 'update'), 'Spalte nicht direkt änderbar (bis)');
select ok(not has_function_privilege('authenticated', 'app_private.push_quiet_now(uuid)', 'execute'), 'fremde Nachtruhe nicht abfragbar');

select tests.login_anon();
select throws_ok($$ select public.set_push_quiet_hours(23, 8) $$, '42501', null, 'anon scheitert');
select tests.logout();

-- ---- Eingaben ---------------------------------------------------------------------------------------
select tests.login('bob');
select throws_ok($$ select public.set_push_quiet_hours(23, null) $$, 'P0001', 'invalid_quiet_hours', 'nur Von');
select throws_ok($$ select public.set_push_quiet_hours(null, 8) $$, 'P0001', 'invalid_quiet_hours', 'nur Bis');
select throws_ok($$ select public.set_push_quiet_hours(8, 8) $$, 'P0001', 'invalid_quiet_hours', 'Von = Bis');
select throws_ok($$ select public.set_push_quiet_hours(24, 8) $$, 'P0001', 'invalid_quiet_hours', 'Stunde 24 gibt es nicht');
select throws_ok($$ select public.set_push_quiet_hours(-1, 8) $$, 'P0001', 'invalid_quiet_hours', 'negative Stunde');
select throws_ok($$ update public.user_settings set push_quiet_from = 1, push_quiet_to = 2 $$, '42501', null, 'direktes Ändern scheitert');
select is(public.set_push_quiet_hours(null, null), '{"from": null, "to": null}'::jsonb, 'aus bleibt aus');
select tests.logout();

-- ---- Ohne Nachtruhe wie bisher; Fenster später am Tag stört jetzt nicht ------------------------------
select tests.ping(tests.uid('bob'));
select is(tests.queued(tests.uid('bob')), 1, 'ohne Nachtruhe kommt der Push');

select tests.login('bob');
select is(public.set_push_quiet_hours(tests.var('later_from')::int, tests.var('later_to')::int),
          jsonb_build_object('from', tests.var('later_from')::int, 'to', tests.var('later_to')::int), 'Nachtruhe ab der nächsten Stunde');
select is((select push_quiet_from::int from public.user_settings), tests.var('later_from')::int, 'Bob liest seine Einstellung');
select tests.logout();
select is(tests.queued(tests.uid('bob')), 1, 'beginnt sie erst später, bleibt Wartendes');
select tests.ping(tests.uid('bob'));
select is(tests.queued(tests.uid('bob')), 2, 'und Neues kommt noch');

-- ---- Nachtruhe jetzt: Wartendes weg, Neues nicht in die Warteschlange, in der App schon -----------------
select tests.login('bob');
select public.set_push_quiet_hours(tests.var('now_from')::int, tests.var('now_to')::int);
select tests.logout();
select is(tests.queued(tests.uid('bob')), 0, 'mit Beginn geht Wartendes nicht mehr raus');
select tests.ping(tests.uid('bob'));
select is(tests.queued(tests.uid('bob')), 0, 'in der Nachtruhe kein Push');
select is((select count(*)::int from public.notifications where user_id = tests.uid('bob')), 3, 'in der App kommt alles an');

-- Alice ist nicht betroffen (beide Geräte).
select tests.ping(tests.uid('alice'));
select is(tests.queued(tests.uid('alice')), 2, 'Alice bekommt ihren Push auf beiden Geräten');

-- Alice sieht Bobs Einstellung nicht.
select tests.login('alice');
select is((select count(*)::int from public.user_settings where push_quiet_from is not null), 0, 'Alice sieht Bobs Nachtruhe nicht');
select tests.logout();

-- ---- Wartendes, das in die Nachtruhe gerät, holt `claim_push_batch` nicht mehr ab -----------------------
-- Alice' Pushs warten; dann beginnt ihre Nachtruhe ohne RPC (z. B. weil die Uhr weitergelaufen ist).
update public.user_settings set push_quiet_from = tests.var('now_from')::smallint, push_quiet_to = tests.var('now_to')::smallint
where user_id = tests.uid('alice');
select tests.login('bob');
select public.set_push_quiet_hours(null, null);
select tests.logout();
select tests.ping(tests.uid('bob'));
select is(jsonb_array_length(public.claim_push_batch(50)), 1, 'abgeholt wird nur Bobs Push');
select is(tests.queued(tests.uid('alice')), 0, 'Alice’ Wartendes ist weg');
select is(tests.queued(tests.uid('bob')), 1, 'Bob bekommt wieder Pushs (abgeholt, noch nicht bestätigt)');

-- ---- Export ---------------------------------------------------------------------------------------------
select tests.login('alice');
select is((public.export_my_data() -> 'settings' ->> 'push_quiet_from')::int, tests.var('now_from')::int, 'der Export enthält die Nachtruhe');
select is(public.set_push_quiet_hours(null, null), '{"from": null, "to": null}'::jsonb, 'Alice schaltet sie aus');
select ok(public.export_my_data() -> 'settings' -> 'push_quiet_from' = 'null'::jsonb, 'im Export wieder aus');
select tests.logout();

select * from finish();
rollback;
