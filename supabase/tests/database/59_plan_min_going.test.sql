-- P25: „Findet statt ab 4“ – Mindestzahl für einen Plan. Setzen nur durch Organisator:in, Owner, Admins,
-- nur vor Beginn, nicht bei abgeschlossenen/abgesagten Plänen; Benachrichtigung genau einmal je Mindestzahl,
-- sobald Zusagen von Mitgliedern und Gästen sie erreichen; nicht an Absagen und ehemalige Mitglieder.
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
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('carol');
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('dave');
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('erin');
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('mallory');
select public.create_crew('Fremde Crew');

-- Bob legt den Plan an (Organisator); Alice ist Owner der Crew.
select tests.login('bob');
select tests.set_var('plan', public.create_plan(tests.var('crew')::uuid, 'Bowling', now() + interval '3 days', p_confirmed => true)::text);
select tests.set_var('token', public.plan_share_token(tests.var('plan')::uuid));
select public.set_plan_guests(tests.var('plan')::uuid, true);
select tests.login('alice');
select tests.set_var('other', public.create_plan(tests.var('crew')::uuid, 'Kino', now() + interval '2 days', p_confirmed => true)::text);

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.set_plan_min_going(uuid, integer)', 'execute'), 'anon setzt keine Mindestzahl');
select ok(has_function_privilege('authenticated', 'public.set_plan_min_going(uuid, integer)', 'execute'), 'angemeldete dürfen aufrufen');
select ok(not has_function_privilege('authenticated', 'app_private.check_plan_min_going(uuid)', 'execute'), 'Prüfung ist nicht direkt aufrufbar');
select ok(not has_function_privilege('authenticated', 'app_private.plan_going_count(uuid)', 'execute'), 'Zählung ist nicht direkt aufrufbar');
select ok(not has_function_privilege('authenticated', 'app_private.plan_min_going_trigger()', 'execute'), 'Trigger-Funktion ist nicht aufrufbar');
select tests.logout();
select tests.login_anon();
select throws_ok($$ select public.set_plan_min_going(tests.var('plan')::uuid, 3) $$, '42501', null, 'ohne Konto: verboten');

-- ---- Angriffe ------------------------------------------------------------------------------------
select tests.login('mallory');
select throws_ok($$ select public.set_plan_min_going(tests.var('plan')::uuid, 3) $$, '42501', null, 'Außenstehende setzen nichts');
select throws_ok($$ select public.set_plan_min_going(gen_random_uuid(), 3) $$, '42501', null, 'unbekannter Plan verrät nichts');
select is((select count(*)::int from public.plans where id = tests.var('plan')::uuid), 0, 'Außenstehende sehen den Plan nicht');
select tests.login('carol');
select throws_ok($$ select public.set_plan_min_going(tests.var('plan')::uuid, 3) $$, '42501', null, 'einfache Mitglieder setzen nichts');
select throws_ok($$ update public.plans set min_going = 2 where id = tests.var('plan')::uuid $$, '42501', null,
  'kein direktes Schreiben an der Funktion vorbei');
select tests.logout();
select is((select min_going from public.plans where id = tests.var('plan')::uuid), null, 'nach den Angriffen keine Mindestzahl');

-- ---- Eingaben ------------------------------------------------------------------------------------
select tests.login('bob');
select throws_ok($$ select public.set_plan_min_going(tests.var('plan')::uuid, 1) $$, 'P0001', 'invalid_input', 'mindestens 2');
select throws_ok($$ select public.set_plan_min_going(tests.var('plan')::uuid, 51) $$, 'P0001', 'invalid_input', 'höchstens 50');

-- ---- Mindestzahl erreichen ------------------------------------------------------------------------------------
-- Bob (Organisator) ist dabei; Dave sagt ab.
select tests.login('dave');
select public.set_attendance(tests.var('plan')::uuid, 'declined');
select tests.login('bob');
select is(public.set_plan_min_going(tests.var('plan')::uuid, 4), 1, 'Organisator setzt „ab 4“, liefert die Zusagen (1)');
select tests.login('carol');
select is((select min_going::int from public.plans where id = tests.var('plan')::uuid), 4, 'die Crew sieht die Mindestzahl');
select tests.login('alice');
select public.set_attendance(tests.var('plan')::uuid, 'going');
select tests.login('carol');
select public.set_attendance(tests.var('plan')::uuid, 'maybe');
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'plan_quorum'), 0, '2 dabei, 1 vielleicht: noch keine Nachricht');
select is((select min_going_reached_at from public.plans where id = tests.var('plan')::uuid), null, 'noch nicht erreicht');

-- Ein Gast sagt zu (3), dann noch einer (4): erreicht.
select tests.login_anon();
select public.guest_rsvp_shared_plan(tests.var('token'), repeat('e', 64), 'Emil', 'going');
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'plan_quorum'), 0, '3 von 4: noch keine Nachricht');
select tests.login_anon();
select public.guest_rsvp_shared_plan(tests.var('token'), repeat('d', 64), 'Dana', 'going');
select tests.logout();
select isnt((select min_going_reached_at from public.plans where id = tests.var('plan')::uuid), null, 'Gast-Zusage erreicht die Mindestzahl');
select is((select array_agg(p.display_name order by p.display_name) from public.notifications n join public.profiles p on p.id = n.user_id
           where n.type = 'plan_quorum' and n.related_entity_id = tests.var('plan')::uuid),
          array['Alice', 'Bob', 'Carol', 'Erin'], 'alle ohne Absage bekommen Bescheid – Dave (abgesagt) nicht');
select is((select n.payload ->> 'answered' from public.notifications n where n.type = 'plan_quorum' and n.user_id = tests.uid('erin')), 'false',
  'Erin hat noch nicht geantwortet – „Bist du auch dabei?“');
select is((select (n.payload ->> 'going')::int from public.notifications n where n.type = 'plan_quorum' and n.user_id = tests.uid('alice')), 4,
  'Nachricht nennt die Zusagen');
select is((select n.actor_id from public.notifications n where n.type = 'plan_quorum' and n.user_id = tests.uid('alice')), null,
  'ohne auslösende Person');
select is((select count(*)::int from public.notifications where type = 'plan_quorum' and user_id = tests.uid('mallory')), 0, 'Außenstehende erfahren nichts');
select tests.login('mallory');
select is((select count(*)::int from public.notifications where type = 'plan_quorum'), 0, 'Mallory sieht keine fremden Nachrichten');

-- Genau einmal: Absage und neue Zusage schicken nichts nach.
select tests.login('alice');
select public.set_attendance(tests.var('plan')::uuid, 'maybe');
select public.set_attendance(tests.var('plan')::uuid, 'going');
select tests.login('erin');
select public.set_attendance(tests.var('plan')::uuid, 'going');
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'plan_quorum'), 4, 'genau einmal je Person');

-- Gleiche Zahl noch einmal: nichts ändert sich.
select tests.login('bob');
select is(public.set_plan_min_going(tests.var('plan')::uuid, 4), 5, 'gleiche Zahl: liefert die Zusagen (5)');
select tests.logout();
select isnt((select min_going_reached_at from public.plans where id = tests.var('plan')::uuid), null, 'gleiche Zahl: bleibt erreicht');

-- Höhere Zahl: wieder offen, beim Erreichen neue Nachricht.
select tests.login('alice');
select is(public.set_plan_min_going(tests.var('plan')::uuid, 6), 5, 'Owner setzt „ab 6“');
select tests.logout();
select is((select min_going_reached_at from public.plans where id = tests.var('plan')::uuid), null, 'neue Zahl: wieder offen');
select tests.login('carol');
select public.set_attendance(tests.var('plan')::uuid, 'going');
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'plan_quorum' and (payload ->> 'min_going')::int = 6), 4,
  '„ab 6“ erreicht: neue Nachricht an alle ohne Absage');

-- Zahl, die schon erreicht ist: still als erreicht markiert, keine Nachricht.
select tests.login('bob');
select public.set_plan_min_going(tests.var('plan')::uuid, 3);
select tests.logout();
select isnt((select min_going_reached_at from public.plans where id = tests.var('plan')::uuid), null, 'schon erreicht: gilt als erreicht');
select is((select count(*)::int from public.notifications where type = 'plan_quorum' and (payload ->> 'min_going')::int = 3), 0,
  'schon erreicht: niemand wird angepingt');

-- Entfernen.
select tests.login('bob');
select public.set_plan_min_going(tests.var('plan')::uuid, null);
select tests.logout();
select is((select min_going from public.plans where id = tests.var('plan')::uuid), null, 'Mindestzahl entfernt');
select is((select count(*)::int from public.audit_log where action = 'plan_min_going_set' and entity_id = tests.var('plan')::uuid), 4,
  'jede Änderung im Protokoll');

-- Abgeschaltete Gruppe: keine Nachricht.
select tests.logout();
update public.user_settings set notification_preferences = '{"plan_quorum": false}' where user_id = tests.uid('erin');
select tests.login('alice');
select public.set_plan_min_going(tests.var('other')::uuid, 2);
select tests.login('carol');
select public.set_attendance(tests.var('other')::uuid, 'going');
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'plan_quorum' and related_entity_id = tests.var('other')::uuid
           and user_id = tests.uid('erin')), 0, 'abgeschaltet: Erin bekommt nichts');
select is((select count(*)::int from public.notifications where type = 'plan_quorum' and related_entity_id = tests.var('other')::uuid), 4,
  'die anderen bekommen Bescheid');

-- Ehemalige Mitglieder: keine Nachricht.
select tests.login('alice');
select tests.set_var('third', public.create_plan(tests.var('crew')::uuid, 'Billard', now() + interval '4 days', p_confirmed => true)::text);
select public.set_plan_min_going(tests.var('third')::uuid, 2);
select tests.login('dave');
select public.leave_crew(tests.var('crew')::uuid);
select tests.login('bob');
select public.set_attendance(tests.var('third')::uuid, 'going');
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'plan_quorum' and related_entity_id = tests.var('third')::uuid
           and user_id = tests.uid('dave')), 0, 'ehemaliges Mitglied bekommt nichts');

-- ---- Nach Beginn, abgeschlossen, abgesagt ------------------------------------------------------------------------------------
select tests.logout();
update public.plans set starts_at = now() - interval '1 hour' where id = tests.var('third')::uuid;
select tests.login('alice');
select throws_ok($$ select public.set_plan_min_going(tests.var('third')::uuid, 5) $$, 'P0001', 'plan_min_going_started', 'nach Beginn nicht mehr');
select public.set_plan_status(tests.var('other')::uuid, 'cancelled');
select throws_ok($$ select public.set_plan_min_going(tests.var('other')::uuid, 5) $$, 'P0001', 'plan_locked', 'abgesagt: nicht mehr');

-- Nach Beginn schickt eine Zusage nichts mehr.
select tests.logout();
update public.plans set min_going = 4, min_going_reached_at = null where id = tests.var('third')::uuid;
delete from public.notifications where type = 'plan_quorum' and related_entity_id = tests.var('third')::uuid;
select tests.login('carol');
select public.set_attendance(tests.var('third')::uuid, 'going');
select tests.login('erin');
select public.set_attendance(tests.var('third')::uuid, 'going');
select tests.login('alice');
select public.set_attendance(tests.var('third')::uuid, 'going');
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'plan_quorum' and related_entity_id = tests.var('third')::uuid), 0,
  'nach Beginn: keine Nachricht mehr');

-- Die Spalte lässt nur 2–50 zu.
select throws_ok($$ update public.plans set min_going = 1 where id = tests.var('plan')::uuid $$, '23514', null, 'Spalte: mindestens 2');

select * from finish();
rollback;
