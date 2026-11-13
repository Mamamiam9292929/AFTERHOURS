-- P50 Etappe 2b: Stationen auf der Zusagekarte für Gäste (`shared_plan_rsvp`) und im Kalender-Abo
-- (`calendar_feed_events`) – in der Reihenfolge des Abends, nur Name/Uhrzeit/Adresse. Ohne Gäste-Freigabe und in
-- der öffentlichen Vorschau keine Stationen; fremde Abos sehen fremde Stationen nicht.
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
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('mallory');
select tests.set_var('mallory_crew', public.create_crew('Fremde Crew')::text);

-- Bob organisiert „Essen“ (in 3 Tagen, 19 Uhr Berliner Zeit), Mallory in ihrer Crew „Geheim“.
select tests.logout();
insert into public.plans (crew_id, created_by, title, starts_at, status) values
  (tests.var('crew')::uuid, tests.uid('bob'), 'Essen',
   ((current_date + 3)::timestamp + interval '19 hours') at time zone 'Europe/Berlin', 'confirmed'),
  (tests.var('mallory_crew')::uuid, tests.uid('mallory'), 'Geheim', now() + interval '3 days', 'confirmed');
select tests.set_var('plan', (select id::text from public.plans where title = 'Essen'));
select tests.set_var('secret_plan', (select id::text from public.plans where title = 'Geheim'));
select tests.set_var('bar_at', (select (starts_at + interval '3 hours 30 minutes')::text from public.plans where title = 'Essen'));

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'app_private.plan_stops_json(uuid)', 'execute'), 'anon ruft die Hilfe nicht auf');
select ok(not has_function_privilege('authenticated', 'app_private.plan_stops_json(uuid)', 'execute'), 'Angemeldete rufen die Hilfe nicht auf');
select ok(has_function_privilege('anon', 'public.shared_plan_rsvp(text, text)', 'execute'), 'Zusagekarte bleibt ohne Konto abrufbar');
select ok(has_function_privilege('anon', 'public.calendar_feed_events(text)', 'execute'), 'Kalender-Abo bleibt ohne Konto abrufbar');

-- ---- Stationen anlegen (in falscher Reihenfolge eingetragen) -----------------------------------------
select tests.login('bob');
select public.add_plan_stop(tests.var('plan')::uuid, 'Tanzen');
select public.add_plan_stop(tests.var('plan')::uuid, 'Club Ost',
  (select starts_at from public.plans where id = tests.var('plan')::uuid) + interval '5 hours', null);
select public.add_plan_stop(tests.var('plan')::uuid, 'Bar Raval', tests.var('bar_at')::timestamptz, 'Muskauer Str. 9');
select tests.set_var('token', public.plan_share_token(tests.var('plan')::uuid));
select tests.login('mallory');
select public.add_plan_stop(tests.var('secret_plan')::uuid, 'Versteck', null, 'Geheimweg 1');

-- ---- Zusagekarte ohne Gäste-Freigabe: nichts ------------------------------------------------------
select tests.login_anon();
select is(public.shared_plan_rsvp(tests.var('token'), null) ->> 'status', 'guests_off', 'ohne Freigabe: keine Karte, also keine Stationen');
select ok(public.preview_shared_plan(tests.var('token')) -> 'plan' -> 'stops' is null, 'öffentliche Vorschau ohne Stationen');
select ok(public.preview_shared_plan(tests.var('token'))::text not like '%Raval%', 'öffentliche Vorschau nennt keine Station');

-- ---- Zusagekarte mit Freigabe ------------------------------------------------------------------------
select tests.login('bob');
select public.set_plan_guests(tests.var('plan')::uuid, true);
select tests.login_anon();
select tests.set_var('rsvp', public.shared_plan_rsvp(tests.var('token'), null)::text);
select is(jsonb_array_length(tests.var('rsvp')::jsonb #> '{plan,stops}'), 3, 'drei Stationen auf der Zusagekarte');
select is(
  (select array_agg(s ->> 'title' order by o) from jsonb_array_elements(tests.var('rsvp')::jsonb #> '{plan,stops}') with ordinality x (s, o)),
  array['Bar Raval', 'Club Ost', 'Tanzen'],
  'Reihenfolge des Abends: mit Uhrzeit früh → spät, ohne Uhrzeit danach');
select is(tests.var('rsvp')::jsonb #>> '{plan,stops,0,address}', 'Muskauer Str. 9', 'Adresse dabei');
select is((tests.var('rsvp')::jsonb #>> '{plan,stops,0,at}')::timestamptz, tests.var('bar_at')::timestamptz, 'Uhrzeit dabei');
select ok(tests.var('rsvp')::jsonb #> '{plan,stops,2,at}' = 'null'::jsonb, 'ohne Uhrzeit: null');
select is(
  (select array_agg(distinct k order by k) from jsonb_array_elements(tests.var('rsvp')::jsonb #> '{plan,stops}') s, jsonb_object_keys(s) k),
  array['address', 'at', 'title'], 'je Station nur Name, Uhrzeit und Adresse (keine ID)');
select ok(tests.var('rsvp')::text not like '%Versteck%', 'keine Station aus fremden Plänen');

-- Ohne Stationen: leere Liste statt null.
select tests.login('bob');
select public.remove_plan_stop(id) from public.plan_stops where plan_id = tests.var('plan')::uuid and title = 'Tanzen';
select tests.login_anon();
select is(jsonb_array_length(public.shared_plan_rsvp(tests.var('token'), null) #> '{plan,stops}'), 2, 'herausgenommene Station verschwindet');

-- Falscher Token bleibt ohne Inhalt.
select is(public.shared_plan_rsvp(repeat('0', 32), null), '{"status": "not_found"}'::jsonb, 'geratener Token: nichts');

-- ---- Kalender-Abo ----------------------------------------------------------------------------------
select tests.login('alice');
select tests.set_var('alice_feed', public.renew_calendar_feed() ->> 'token');
select tests.login('mallory');
select tests.set_var('mallory_feed', public.renew_calendar_feed() ->> 'token');

select tests.login_anon();
select tests.set_var('events', public.calendar_feed_events(tests.var('alice_feed'))::text);
select is(
  (select array_agg(s ->> 'title' order by o)
   from jsonb_array_elements(tests.var('events')::jsonb -> 'events') e,
        jsonb_array_elements(e -> 'stops') with ordinality x (s, o)
   where e ->> 'title' = 'Essen'),
  array['Bar Raval', 'Club Ost'], 'Abo: Stationen des Plans in der Reihenfolge des Abends');
select is(
  (select e #>> '{stops,0,address}' from jsonb_array_elements(tests.var('events')::jsonb -> 'events') e where e ->> 'title' = 'Essen'),
  'Muskauer Str. 9', 'Abo: Adresse der Station');
select ok(tests.var('events')::text not like '%Versteck%', 'Abo: keine Stationen fremder Crews');

select tests.set_var('mallory_events', public.calendar_feed_events(tests.var('mallory_feed'))::text);
select ok(tests.var('mallory_events')::text not like '%Raval%', 'Mallorys Abo: keine Stationen der Weekend Crew');
select is(
  (select jsonb_array_length(e -> 'stops') from jsonb_array_elements(tests.var('mallory_events')::jsonb -> 'events') e where e ->> 'title' = 'Geheim'),
  1, 'Mallorys Abo: eigene Station');

-- Plan ohne Stationen: leere Liste.
select tests.login('bob');
select public.remove_plan_stop(id) from public.plan_stops where plan_id = tests.var('plan')::uuid;
select tests.login_anon();
select is(
  (select e -> 'stops' from jsonb_array_elements(public.calendar_feed_events(tests.var('alice_feed')) -> 'events') e where e ->> 'title' = 'Essen'),
  '[]'::jsonb, 'Abo: ohne Stationen leere Liste');

select * from finish();
rollback;
