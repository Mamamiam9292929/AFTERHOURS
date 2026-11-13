-- P51: „Ich bring wen mit“ – Begleitung zur Zusage. Nur Mitglieder mit „Bin dabei“, 0–3, nur vor Beginn und bei
-- offenen Plänen; Begleitung zählt bei Mindestzahl (Bescheid), Höchstzahl (voll, Nachrückliste) und auf der
-- Zusagekarte für Gäste; jede andere Antwort (auch „Alle neu fragen“) setzt sie zurück; Außenstehende und anon
-- kommen nicht heran.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Carol');
select tests.make_user('Dave');
select tests.make_user('Mallory');

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew', '🎳')::text);
select tests.set_var('invite', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob');
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('carol');
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('dave');
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('mallory');
select public.create_crew('Fremde Crew');

-- Bob legt den Plan an (Organisator, ist dabei).
select tests.login('bob');
select tests.set_var('plan', public.create_plan(tests.var('crew')::uuid, 'Bowling', now() + interval '3 days', p_confirmed => true)::text);
select tests.set_var('token', public.plan_share_token(tests.var('plan')::uuid));
select public.set_plan_guests(tests.var('plan')::uuid, true);

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.set_plan_plus_ones(uuid, integer)', 'execute'), 'anon setzt keine Begleitung');
select ok(has_function_privilege('authenticated', 'public.set_plan_plus_ones(uuid, integer)', 'execute'), 'angemeldete dürfen aufrufen');
select ok(not has_function_privilege('authenticated', 'app_private.plan_participant_plus_ones_reset()', 'execute'), 'Trigger-Funktion ist nicht aufrufbar');
select ok(not has_function_privilege('authenticated', 'app_private.plan_going_count(uuid)', 'execute'), 'Zählung ist nicht direkt aufrufbar');
select tests.logout();
select tests.login_anon();
select throws_ok($$ select public.set_plan_plus_ones(tests.var('plan')::uuid, 1) $$, '42501', null, 'ohne Konto: verboten');

-- ---- Angriffe ------------------------------------------------------------------------------------
select tests.login('mallory');
select throws_ok($$ select public.set_plan_plus_ones(tests.var('plan')::uuid, 1) $$, '42501', null, 'Außenstehende setzen nichts');
select throws_ok($$ select public.set_plan_plus_ones(gen_random_uuid(), 1) $$, '42501', null, 'unbekannter Plan verrät nichts');
select tests.login('bob');
select throws_ok($$ update public.plan_participants set plus_ones = 3 where plan_id = tests.var('plan')::uuid and user_id = auth.uid() $$,
  '42501', null, 'kein direktes Schreiben an der Funktion vorbei');
select tests.logout();
select is((select plus_ones::int from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = tests.uid('bob')), 0,
  'nach den Angriffen keine Begleitung');

-- ---- Eingaben ------------------------------------------------------------------------------------
select tests.login('bob');
select throws_ok($$ select public.set_plan_plus_ones(tests.var('plan')::uuid, 4) $$, 'P0001', 'invalid_input', 'höchstens 3');
select throws_ok($$ select public.set_plan_plus_ones(tests.var('plan')::uuid, -1) $$, 'P0001', 'invalid_input', 'nicht negativ');
select throws_ok($$ select public.set_plan_plus_ones(tests.var('plan')::uuid, null) $$, 'P0001', 'invalid_input', 'nicht leer');
select tests.login('carol');
select throws_ok($$ select public.set_plan_plus_ones(tests.var('plan')::uuid, 1) $$, 'P0001', 'plan_plus_ones_not_going', 'ohne Antwort keine Begleitung');
select public.set_attendance(tests.var('plan')::uuid, 'maybe');
select throws_ok($$ select public.set_plan_plus_ones(tests.var('plan')::uuid, 1) $$, 'P0001', 'plan_plus_ones_not_going', 'bei „Vielleicht“ keine Begleitung');

-- ---- Zählen und Mindestzahl ------------------------------------------------------------------------------------
select tests.login('bob');
select is(public.set_plan_plus_ones(tests.var('plan')::uuid, 2), 2, 'Bob bringt zwei mit');
select is(public.set_plan_plus_ones(tests.var('plan')::uuid, 2), 2, 'noch einmal: bleibt bei zwei');
select tests.logout();
select is(app_private.plan_going_count(tests.var('plan')::uuid), 3, 'Bob zählt mit Begleitung dreifach');
select tests.login('carol');
select is((select plus_ones::int from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = tests.uid('bob')), 2,
  'die Crew sieht „+2“');
select tests.login('mallory');
select is((select count(*)::int from public.plan_participants where plan_id = tests.var('plan')::uuid), 0, 'Außenstehende sehen nichts');

select tests.login('bob');
select public.set_plan_min_going(tests.var('plan')::uuid, 5);
select tests.login('carol');
select public.set_attendance(tests.var('plan')::uuid, 'going');
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'plan_quorum' and related_entity_id = tests.var('plan')::uuid), 0,
  '4 von 5: noch kein „Findet statt“');
select tests.login('carol');
select is(public.set_plan_plus_ones(tests.var('plan')::uuid, 1), 1, 'Carol bringt eine mit');
select tests.logout();
select ok((select min_going_reached_at is not null from public.plans where id = tests.var('plan')::uuid), 'Begleitung erreicht die Mindestzahl');
select ok((select count(*)::int from public.notifications where type = 'plan_quorum' and related_entity_id = tests.var('plan')::uuid) > 0,
  'Crew bekommt „Findet statt“');
select is((select (payload ->> 'going')::int from public.notifications where type = 'plan_quorum' and related_entity_id = tests.var('plan')::uuid limit 1), 5,
  'Nachricht nennt 5 Zusagen');
select tests.login('bob');
select public.set_plan_min_going(tests.var('plan')::uuid, null);

-- ---- Höchstzahl ------------------------------------------------------------------------------------
select tests.login('bob');
select throws_ok($$ select public.set_plan_max_going(tests.var('plan')::uuid, 4) $$, 'P0001', 'plan_max_below_going', 'Höchstzahl nicht unter Zusagen mit Begleitung');
select is(public.set_plan_max_going(tests.var('plan')::uuid, 5), 5, 'höchstens 5: voll');
select tests.login('dave');
select throws_ok($$ select public.set_attendance(tests.var('plan')::uuid, 'going') $$, 'P0001', 'plan_full', 'voll: Dave kommt nicht mehr rein');
select tests.login('carol');
select throws_ok($$ select public.set_plan_plus_ones(tests.var('plan')::uuid, 2) $$, 'P0001', 'plan_full', 'voll: keine weitere Begleitung');
select is((select plus_ones::int from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = auth.uid()), 1,
  'Carol bleibt bei einer');
select tests.login('dave');
select public.set_attendance(tests.var('plan')::uuid, 'maybe');
select is(public.join_plan_waitlist(tests.var('plan')::uuid), 1, 'Dave auf der Nachrückliste');

-- Weniger Begleitung macht Platz: Dave rückt nach.
select tests.login('bob');
select is(public.set_plan_plus_ones(tests.var('plan')::uuid, 0), 0, 'Bob bringt doch niemanden mit');
select tests.logout();
select is((select attendance_status::text from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = tests.uid('dave')),
  'going', 'Dave rückt nach');
select is((select count(*)::int from public.notifications where type = 'plan_waitlist_promoted' and user_id = tests.uid('dave')), 1,
  'Dave bekommt „Du bist nachgerückt“');
select is(app_private.plan_going_count(tests.var('plan')::uuid), 4, 'Bob, Carol mit Begleitung, Dave');

-- ---- Begleitung gehört zur Zusage ------------------------------------------------------------------------------------
select tests.login('carol');
select public.set_attendance(tests.var('plan')::uuid, 'maybe');
select tests.logout();
select is((select plus_ones::int from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = tests.uid('carol')), 0,
  '„Vielleicht“: Begleitung ist weg');
select tests.login('carol');
select public.set_attendance(tests.var('plan')::uuid, 'going');
select is((select plus_ones::int from public.plan_participants where plan_id = tests.var('plan')::uuid and user_id = auth.uid()), 0,
  'wieder dabei: ohne Begleitung');
select tests.login('dave');
select is(public.set_plan_plus_ones(tests.var('plan')::uuid, 1), 1, 'Dave bringt eine mit (4 von 5)');
select tests.login('bob');
select public.ask_plan_again(tests.var('plan')::uuid);
select tests.logout();
select is((select coalesce(sum(plus_ones), 0)::int from public.plan_participants where plan_id = tests.var('plan')::uuid), 0,
  '„Alle neu fragen“: keine Begleitung mehr');

-- ---- Zusagekarte für Gäste ------------------------------------------------------------------------------------
select tests.login('bob');
select public.set_plan_plus_ones(tests.var('plan')::uuid, 3);
select tests.login_anon();
select is((public.shared_plan_rsvp(tests.var('token')) -> 'counts' ->> 'going')::int, 4, 'Gäste sehen 4 dabei (Bob mit drei)');
select public.guest_rsvp_shared_plan(tests.var('token'), repeat('e', 64), 'Emil', 'going');
select throws_ok($$ select public.guest_rsvp_shared_plan(tests.var('token'), repeat('d', 64), 'Dana', 'going') $$, 'P0001', 'plan_full',
  'voll mit Begleitung: auch Gäste nicht');
select tests.logout();

-- ---- Datenexport ------------------------------------------------------------------------------------
select tests.login('bob');
select is((select (e ->> 'plus_ones')::int from jsonb_array_elements(public.export_my_data() -> 'plans') e
           where e ->> 'plan_id' = tests.var('plan')), 3, 'Export nennt die eigene Begleitung');

-- ---- Gesperrt ------------------------------------------------------------------------------------
select tests.logout();
update public.plans set starts_at = now() - interval '1 hour' where id = tests.var('plan')::uuid;
select tests.login('bob');
select throws_ok($$ select public.set_plan_plus_ones(tests.var('plan')::uuid, 1) $$, 'P0001', 'plan_plus_ones_started', 'nach Beginn nicht mehr');
select tests.logout();
update public.plans set starts_at = now() + interval '1 day', status = 'cancelled' where id = tests.var('plan')::uuid;
select tests.login('bob');
select throws_ok($$ select public.set_plan_plus_ones(tests.var('plan')::uuid, 1) $$, 'P0001', 'plan_locked', 'abgesagt: gesperrt');

select * from finish();
rollback;
