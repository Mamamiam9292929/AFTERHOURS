-- P43 Etappe 2b: „Kommt später“ – sagt jemand „Bin in … Min. da“, bekommen alle, die schon „Bin da“ gesagt haben,
-- einmal Bescheid. Nicht die Person selbst, nicht wer noch nichts gesagt hat, nicht wer abgesagt hat, nie jemand
-- außerhalb der Crew; erneut nur, wenn es mindestens 5 Minuten später wird, höchstens dreimal; abschaltbar.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Carol');
select tests.make_user('Dave');
select tests.make_user('Erin');
select tests.make_user('Mallory');

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew', '🎳')::text);
select tests.set_var('invite', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Bob tritt bei');
select tests.login('carol');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Carol tritt bei');
select tests.login('dave');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Dave tritt bei');
select tests.login('erin');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Erin tritt bei');
select tests.login('mallory');
select tests.set_var('mallory_crew', public.create_crew('Fremde Crew')::text);

select tests.logout();
insert into public.plans (crew_id, created_by, title, starts_at, ends_at, status, created_at) values
  (tests.var('crew')::uuid, tests.uid('alice'), 'Bowling', now() + interval '10 minutes', null, 'confirmed', now() - interval '5 days'),
  (tests.var('mallory_crew')::uuid, tests.uid('mallory'), 'Fremder Abend', now() + interval '10 minutes', null, 'confirmed', now() - interval '5 days');
select tests.set_var(lower(title), id::text) from public.plans where title in ('Bowling', 'Fremder Abend');

-- Alice, Bob, Carol dabei, Erin vielleicht, Dave abgesagt.
insert into public.plan_participants (plan_id, user_id, attendance_status) values
  (tests.var('bowling')::uuid, tests.uid('alice'), 'going'),
  (tests.var('bowling')::uuid, tests.uid('bob'), 'going'),
  (tests.var('bowling')::uuid, tests.uid('carol'), 'going'),
  (tests.var('bowling')::uuid, tests.uid('erin'), 'maybe'),
  (tests.var('bowling')::uuid, tests.uid('dave'), 'declined'),
  (tests.var('fremder abend')::uuid, tests.uid('mallory'), 'going');

-- ---- Rechte ----------------------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'app_private.plan_arrival_late_trigger()', 'execute'), 'Trigger-Funktion bleibt intern');
select ok(not has_function_privilege('anon', 'app_private.plan_arrival_late_trigger()', 'execute'), 'auch für anon');
select has_trigger('public', 'plan_arrivals', 'plan_arrivals_late_notify', 'Trigger hängt an plan_arrivals');

-- ---- Niemand da: niemand bekommt etwas --------------------------------------------------------------
select tests.login('carol');
select lives_ok($$ select public.set_plan_arrival(tests.var('bowling')::uuid, 'late', 10) $$, 'Carol kommt später, als noch niemand da ist');
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'plan_arrival_late'), 0, 'noch niemand da: keine Nachricht');

-- ---- Alice und Erin sind da; Bob hat nichts gesagt; Dave hat abgesagt ----------------------------------
select tests.login('alice');
select lives_ok($$ select public.set_plan_arrival(tests.var('bowling')::uuid, 'here') $$, 'Alice ist da');
select tests.login('erin');
select lives_ok($$ select public.set_plan_arrival(tests.var('bowling')::uuid, 'here') $$, 'Erin (vielleicht) ist auch da');
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'plan_arrival_late'), 0, '„Bin da“ schickt nichts');

-- Mallory steht (über einen Fehler) als „da“ in der Tabelle – bekommt trotzdem nie etwas.
insert into public.plan_arrivals (plan_id, user_id, state) values (tests.var('bowling')::uuid, tests.uid('mallory'), 'here');

select tests.login('bob');
select lives_ok($$ select public.set_plan_arrival(tests.var('bowling')::uuid, 'late', 20) $$, 'Bob kommt in 20 Minuten');
select tests.logout();
select is((select array_agg(p.display_name order by p.display_name) from public.notifications n join public.profiles p on p.id = n.user_id
           where n.type = 'plan_arrival_late'),
          array['Alice', 'Erin'], 'Bescheid bekommen nur die, die schon da sind');
select is((select count(*)::int from public.notifications where type = 'plan_arrival_late' and user_id in (tests.uid('bob'), tests.uid('carol'), tests.uid('dave'), tests.uid('mallory'))),
          0, 'nicht Bob selbst, nicht Carol (unterwegs), nicht Dave (abgesagt), nie Mallory');
select is((select n.actor_id from public.notifications n where n.type = 'plan_arrival_late' and n.user_id = tests.uid('alice')), tests.uid('bob'),
          'die Nachricht nennt Bob');
select is((select n.related_entity_id from public.notifications n where n.type = 'plan_arrival_late' and n.user_id = tests.uid('alice')), tests.var('bowling')::uuid,
          'und führt zum Plan');
select is((select (n.payload ->> 'eta')::timestamptz from public.notifications n where n.type = 'plan_arrival_late' and n.user_id = tests.uid('alice')),
          now() + interval '20 minutes', 'mit Bobs angesagter Uhrzeit');
select is((select n.payload ->> 'later' from public.notifications n where n.type = 'plan_arrival_late' and n.user_id = tests.uid('alice')), 'false',
          'erste Ansage: nicht „noch später“');
select is((select count(*)::int from jsonb_object_keys((select n.payload from public.notifications n where n.type = 'plan_arrival_late' and n.user_id = tests.uid('alice')))),
          3, 'nur Titel, Uhrzeit und „noch später“ – kein Standort');

-- Lesen nur die eigenen.
select tests.login('mallory');
select is((select count(*)::int from public.notifications where type = 'plan_arrival_late'), 0, 'Mallory sieht keine fremden Nachrichten');
select tests.login('alice');
select is((select count(*)::int from public.notifications where type = 'plan_arrival_late'), 1, 'Alice sieht ihre');

-- ---- Nur Neuigkeiten -------------------------------------------------------------------------------
select tests.login('bob');
select lives_ok($$ select public.set_plan_arrival(tests.var('bowling')::uuid, 'late', 20) $$, 'Bob sagt dasselbe noch mal');
select lives_ok($$ select public.set_plan_arrival(tests.var('bowling')::uuid, 'late', 23) $$, 'nur 3 Minuten später');
select lives_ok($$ select public.set_plan_arrival(tests.var('bowling')::uuid, 'late', 10) $$, 'früher');
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'plan_arrival_late' and user_id = tests.uid('alice')), 1,
          'gleiche, kaum spätere oder frühere Zeit: keine neue Nachricht');

select tests.login('bob');
select lives_ok($$ select public.set_plan_arrival(tests.var('bowling')::uuid, 'late', 30) $$, 'Bob wird es 20 Minuten später');
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'plan_arrival_late' and user_id = tests.uid('alice')), 2, '„noch später“ kommt an');
select is((select n.payload ->> 'later' from public.notifications n where n.type = 'plan_arrival_late' and n.user_id = tests.uid('alice')
           order by (n.payload ->> 'eta')::timestamptz desc limit 1), 'true', 'als „noch später“');

-- „Bin da“ und dann wieder später gilt als neue erste Ansage – aber höchstens drei Nachrichten je Person und Abend.
select tests.login('bob');
select lives_ok($$ select public.set_plan_arrival(tests.var('bowling')::uuid, 'here') $$, 'Bob ist da');
select lives_ok($$ select public.set_plan_arrival(tests.var('bowling')::uuid, 'late', 60) $$, 'Bob muss doch noch mal weg');
select lives_ok($$ select public.set_plan_arrival(tests.var('bowling')::uuid, 'late', 90) $$, 'und es dauert');
select lives_ok($$ select public.set_plan_arrival(tests.var('bowling')::uuid, 'late', 120) $$, 'und dauert');
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'plan_arrival_late' and user_id = tests.uid('alice') and actor_id = tests.uid('bob')), 3,
          'höchstens drei Nachrichten über Bob an Alice');

-- ---- Abschaltbar -----------------------------------------------------------------------------------
update public.user_settings set notification_preferences = '{"plan_arrival_late": false}' where user_id = tests.uid('erin');
select tests.login('carol');
select lives_ok($$ select public.set_plan_arrival(tests.var('bowling')::uuid, 'late', 40) $$, 'Carol wird es später');
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'plan_arrival_late' and actor_id = tests.uid('carol') and user_id = tests.uid('alice')), 1,
          'Alice bekommt Carols Ansage');
select is((select count(*)::int from public.notifications where type = 'plan_arrival_late' and actor_id = tests.uid('carol') and user_id = tests.uid('erin')), 0,
          'Erin hat „Wer später kommt“ ausgeschaltet');

-- ---- Wer abgesagt hat oder vor dem Fenster „da“ war, bekommt nichts ------------------------------------
select tests.login('alice');
select lives_ok($$ select public.set_attendance(tests.var('bowling')::uuid, 'declined') $$, 'Alice sagt doch ab (und geht)');
select tests.logout();
update public.plan_arrivals set updated_at = now() - interval '3 hours' where plan_id = tests.var('bowling')::uuid and user_id = tests.uid('erin');
update public.user_settings set notification_preferences = '{}' where user_id = tests.uid('erin');
select tests.login('carol');
select lives_ok($$ select public.set_plan_arrival(tests.var('bowling')::uuid, 'late', 60) $$, 'Carol noch später');
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'plan_arrival_late' and actor_id = tests.uid('carol')), 1,
          'Alice (abgesagt) und Erin (Ansage von vor dem Fenster) bekommen nichts Neues');

select * from finish();
rollback;
