-- P42 Etappe 2: Nimmt jemand anderes (wer die Abstimmung gestartet hat, Owner/Admin) einen nachgereichten Vorschlag
-- mit `remove_poll_option` raus, bekommt die Person, die ihn nachgereicht hat, einen Hinweis (`poll_reminder`,
-- `removed: true`, Termin bzw. Ort im Payload). Nicht beim eigenen Zurückziehen, nicht nach dem Verlassen der Crew,
-- nicht bei abgeschalteter Art, nicht bei gescheitertem Zurückziehen.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');   -- Owner
select tests.make_user('Bob');     -- Mitglied, reicht nach
select tests.make_user('Carol');   -- Mitglied, startet eine Abstimmung
select tests.make_user('Dave');    -- Mitglied, reicht nach und verlässt die Crew
select tests.make_user('Erin');    -- Mitglied, hat „Erinnerungen“ abgeschaltet
select tests.make_user('Mallory'); -- Außenstehende

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew')::text);
select tests.set_var('token', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob'); select public.accept_crew_invitation(tests.var('token'));
select tests.login('carol'); select public.accept_crew_invitation(tests.var('token'));
select tests.login('dave'); select public.accept_crew_invitation(tests.var('token'));
select tests.login('erin'); select public.accept_crew_invitation(tests.var('token'));
select tests.logout();

select tests.set_var('d1', ((now() at time zone 'Europe/Berlin')::date + 3)::text);
select tests.set_var('d2', ((now() at time zone 'Europe/Berlin')::date + 4)::text);
select tests.set_var('d3', ((now() at time zone 'Europe/Berlin')::date + 5)::text);
select tests.set_var('d4', ((now() at time zone 'Europe/Berlin')::date + 6)::text);
select tests.set_var('d5', ((now() at time zone 'Europe/Berlin')::date + 7)::text);

-- Termin-Abstimmung von Carol, Bob reicht zwei Termine nach (einen mit Uhrzeit).
select tests.login('carol');
select tests.set_var('poll', public.create_date_poll(tests.var('crew')::uuid, 'Wann könnt ihr?', now() + interval '1 day',
  format('[{"date":"%s"},{"date":"%s"}]', tests.var('d1'), tests.var('d2'))::jsonb)::text);
select tests.login('bob');
select tests.set_var('slot', public.add_poll_slot(tests.var('poll')::uuid, tests.var('d3')::date, '20:00')::text);
select tests.set_var('slot2', public.add_poll_slot(tests.var('poll')::uuid, tests.var('d4')::date)::text);
select tests.set_var('own', public.add_poll_slot(tests.var('poll')::uuid, tests.var('d5')::date)::text);
select tests.logout();

-- ---- Gescheiterte Versuche lösen nichts aus -------------------------------------------------------------
select tests.login('mallory');
select throws_ok(format($$ select public.remove_poll_option(%L) $$, tests.var('slot')), '42501', 'forbidden', 'Außenstehende scheitern');
select tests.login('dave');
select throws_ok(format($$ select public.remove_poll_option(%L) $$, tests.var('slot')), '42501', 'forbidden', 'einfache Mitglieder scheitern');
select tests.logout();
select is((select count(*)::int from public.notifications where dedupe_key like 'poll_option_removed:%'), 0,
  'gescheiterte Versuche schicken keinen Hinweis');

-- ---- Bob zieht selbst zurück: kein Hinweis an sich selbst ----------------------------------------------
select tests.login('bob');
select public.remove_poll_option(tests.var('own')::uuid);
select tests.logout();
select is((select count(*)::int from public.notifications where dedupe_key = 'poll_option_removed:' || tests.var('own')), 0,
  'eigenes Zurückziehen: kein Hinweis');

-- ---- Carol (hat gestartet) nimmt Bobs Termin raus: Bob bekommt Bescheid --------------------------------
select tests.login('carol');
select lives_ok(format($$ select public.remove_poll_option(%L) $$, tests.var('slot')), 'Carol nimmt Bobs Termin raus');
select tests.logout();
select is((select count(*)::int from public.notifications where dedupe_key = 'poll_option_removed:' || tests.var('slot')), 1,
  'genau ein Hinweis');
select is((select user_id from public.notifications where dedupe_key = 'poll_option_removed:' || tests.var('slot')), tests.uid('bob'),
  'an Bob, der nachgereicht hat');
select is((select type::text || ' ' || actor_id::text || ' ' || entity_type || ' ' || related_entity_id::text || ' ' || crew_id::text
           from public.notifications where dedupe_key = 'poll_option_removed:' || tests.var('slot')),
  'poll_reminder ' || tests.uid('carol') || ' poll ' || tests.var('poll') || ' ' || tests.var('crew'),
  'Art poll_reminder, von Carol, führt zur Abstimmung');
select is((select payload from public.notifications where dedupe_key = 'poll_option_removed:' || tests.var('slot')),
  jsonb_build_object('title', 'Wann könnt ihr?', 'removed', true, 'date', tests.var('d3')::date, 'time', '20:00'),
  'Payload: Titel, removed, Termin mit Uhrzeit');

-- ---- Owner nimmt den Termin ohne Uhrzeit raus -------------------------------------------------------------
select tests.login('alice');
select public.remove_poll_option(tests.var('slot2')::uuid);
select tests.logout();
select is((select payload ->> 'date' || '|' || coalesce(payload ->> 'time', '-') from public.notifications
           where dedupe_key = 'poll_option_removed:' || tests.var('slot2') and user_id = tests.uid('bob')),
  tests.var('d4') || '|-', 'Termin ohne Uhrzeit: time ist leer');
select is((select count(*)::int from public.notifications where dedupe_key like 'poll_option_removed:%' and user_id <> tests.uid('bob')), 0,
  'niemand sonst bekommt den Hinweis');

-- ---- Orte: Ort steht im Payload ----------------------------------------------------------------------
select tests.login('alice');
select tests.set_var('places', public.create_poll(tests.var('crew')::uuid, 'Was machen wir?', now() + interval '1 day',
  '[{"title":"Bowling"},{"title":"Kino"}]'::jsonb)::text);
select tests.login('bob');
select tests.set_var('karaoke', public.add_poll_place(tests.var('places')::uuid, null, 'Karaoke')::text);
select tests.login('dave');
select tests.set_var('bar', public.add_poll_place(tests.var('places')::uuid, null, 'Bar')::text);
select tests.login('erin');
select tests.set_var('minigolf', public.add_poll_place(tests.var('places')::uuid, null, 'Minigolf')::text);
select tests.logout();
select tests.login('alice');
select public.remove_poll_option(tests.var('karaoke')::uuid);
select tests.logout();
select is((select payload from public.notifications where dedupe_key = 'poll_option_removed:' || tests.var('karaoke')),
  jsonb_build_object('title', 'Was machen wir?', 'removed', true, 'place', 'Karaoke'), 'Ort steht im Payload');

-- ---- Wer die Crew verlassen hat, bekommt nichts ------------------------------------------------------
delete from public.crew_members where crew_id = tests.var('crew')::uuid and user_id = tests.uid('dave');
select tests.login('alice');
select lives_ok(format($$ select public.remove_poll_option(%L) $$, tests.var('bar')), 'Owner nimmt den Vorschlag von Dave raus');
select tests.logout();
select is((select count(*)::int from public.notifications where dedupe_key = 'poll_option_removed:' || tests.var('bar')), 0,
  'Dave ist nicht mehr in der Crew – kein Hinweis');

-- ---- Abgeschaltete Art „poll_reminder“ wird beachtet ---------------------------------------------------
insert into public.user_settings (user_id, notification_preferences)
values (tests.uid('erin'), '{"poll_reminder": false}'::jsonb)
on conflict (user_id) do update set notification_preferences = excluded.notification_preferences;
select tests.login('alice');
select public.remove_poll_option(tests.var('minigolf')::uuid);
select tests.logout();
select is((select count(*)::int from public.notifications where dedupe_key = 'poll_option_removed:' || tests.var('minigolf')), 0,
  'Erin hat Erinnerungen abgeschaltet – kein Hinweis');

-- ---- Nur Bob sieht seinen Hinweis (RLS) ----------------------------------------------------------------
select tests.login('carol');
select is((select count(*)::int from public.notifications where dedupe_key like 'poll_option_removed:%'), 0,
  'Carol sieht Bobs Hinweise nicht');
select tests.login('bob');
select is((select count(*)::int from public.notifications where dedupe_key like 'poll_option_removed:%'), 3,
  'Bob sieht seine drei Hinweise');
select tests.logout();

select * from finish();
rollback;
