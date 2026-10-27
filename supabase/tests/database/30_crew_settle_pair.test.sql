-- P3 Etappe 3c: Alles auf einmal ausgleichen – Rückzahlungen über mehrere Abende mit einer Person,
-- gleiche Rechnung wie „Wer gibt wem?“ je Abend, Verrechnung in beide Richtungen, Schutz vor
-- veralteten Beträgen, nur zwischen Mitgliedern; Außenstehende und anon scheitern.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Carol');
select tests.make_user('Mallory');

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew', '🎳')::text);
select tests.set_var('invite', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Bob tritt bei');
select tests.login('carol');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Carol tritt bei');
select tests.login('mallory');
select tests.set_var('mallory_crew', public.create_crew('Fremde Crew')::text);

select tests.logout();
insert into public.plans (crew_id, created_by, title, starts_at, status) values
  (tests.var('crew')::uuid, tests.uid('alice'), 'Bowling', now() - interval '8 days', 'completed'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Kino', now() - interval '3 days', 'completed'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Pizza', now() - interval '1 day', 'completed'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Nur Carol', now() - interval '2 days', 'completed');
select tests.set_var('bowling', (select id::text from public.plans where title = 'Bowling'));
select tests.set_var('kino', (select id::text from public.plans where title = 'Kino'));
select tests.set_var('pizza', (select id::text from public.plans where title = 'Pizza'));
select tests.set_var('carol_plan', (select id::text from public.plans where title = 'Nur Carol'));

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.settle_crew_balances_with(uuid, uuid, integer)', 'execute'), 'anon darf nicht ausgleichen');
select ok(has_function_privilege('authenticated', 'public.settle_crew_balances_with(uuid, uuid, integer)', 'execute'), 'angemeldete Mitglieder dürfen');

-- ---- Ausgaben ------------------------------------------------------------------------------------
-- Bowling: Alice zahlt 48 € für Alice und Bob → Bob gibt Alice 24 €.
-- Kino: Alice zahlt 30 € für Alice, Bob, Carol → Bob gibt Alice 10 €, Carol gibt Alice 10 €.
-- Pizza: Bob zahlt 12 € für Alice und Bob → Alice gibt Bob 6 €.
-- Nur Carol: Carol zahlt 20 € für Alice und Carol → Alice gibt Carol 10 € (Bob nicht beteiligt).
select tests.login('alice');
select ok(public.add_plan_expense(tests.var('bowling')::uuid, 'Bahn', 4800, null, array[tests.uid('alice'), tests.uid('bob')]) is not null, 'Bahn eingetragen');
select ok(public.add_plan_expense(tests.var('kino')::uuid, 'Tickets', 3000, null, array[tests.uid('alice'), tests.uid('bob'), tests.uid('carol')]) is not null, 'Kino eingetragen');
select tests.login('bob');
select ok(public.add_plan_expense(tests.var('pizza')::uuid, 'Pizza', 1200, null, array[tests.uid('alice'), tests.uid('bob')]) is not null, 'Pizza eingetragen');
select tests.login('carol');
select ok(public.add_plan_expense(tests.var('carol_plan')::uuid, 'Eis', 2000, null, array[tests.uid('alice'), tests.uid('carol')]) is not null, 'Eis eingetragen');

-- ---- Angriffe ------------------------------------------------------------------------------------
select tests.login('mallory');
select throws_ok(format($$ select public.settle_crew_balances_with(%L, %L, 0) $$, tests.var('crew'), tests.uid('alice')), '42501', null, 'Außenstehende gleichen in fremden Crews nicht aus');
select throws_ok(format($$ select public.settle_crew_balances_with(%L, %L, 0) $$, tests.var('mallory_crew'), tests.uid('alice')), 'P0001', 'invalid_settlement', 'in der eigenen Crew nur mit Mitgliedern');
select throws_ok($$ select public.settle_crew_balances_with(null, null, 0) $$, '42501', null, 'ohne Crew gibt es nichts');
select tests.login_anon();
select throws_ok(format($$ select public.settle_crew_balances_with(%L, %L, 0) $$, tests.var('crew'), tests.uid('alice')), '42501', null, 'anon scheitert');

select tests.login('bob');
select throws_ok(format($$ select public.settle_crew_balances_with(%L, %L, 0) $$, tests.var('crew'), tests.uid('bob')), 'P0001', 'invalid_settlement', 'nicht mit sich selbst');
select throws_ok(format($$ select public.settle_crew_balances_with(%L, %L, 0) $$, tests.var('crew'), tests.uid('mallory')), 'P0001', 'invalid_settlement', 'nicht mit Außenstehenden');
select throws_ok(format($$ select public.settle_crew_balances_with(%L, null, 0) $$, tests.var('crew')), 'P0001', 'invalid_settlement', 'nicht ohne Person');

-- ---- Veraltete Summe -----------------------------------------------------------------------------
-- Aus Bobs Sicht: −24 − 10 + 6 = −28 €. Wer etwas anderes gesehen hat, trägt nichts ein.
select throws_ok(format($$ select public.settle_crew_balances_with(%L, %L, -3400) $$, tests.var('crew'), tests.uid('alice')), 'P0001', 'settlement_changed', 'abweichende Summe wird abgewiesen');
select is((select count(*)::int from public.plan_expenses e where e.kind = 'settlement'), 0, 'dabei wurde nichts eingetragen');

-- ---- Ausgleichen ---------------------------------------------------------------------------------
select is(public.settle_crew_balances_with(tests.var('crew')::uuid, tests.uid('alice'), -2800),
  jsonb_build_object('plans', 3, 'net_cents', -2800), 'Bob gleicht mit Alice über drei Abende aus: 28 €');
select is((select count(*)::int from public.plan_expenses e where e.kind = 'settlement' and e.created_by = tests.uid('bob')), 3, 'drei Rückzahlungen eingetragen');
select is((select e.amount_cents from public.plan_expenses e where e.kind = 'settlement' and e.plan_id = tests.var('pizza')::uuid and e.paid_by = tests.uid('alice')), 600,
  'bei der Pizza in die andere Richtung: Alice an Bob 6 €');
select is((select count(*)::int from public.crew_open_balances(tests.var('crew')::uuid) b where b.plan_id in (tests.var('bowling')::uuid, tests.var('pizza')::uuid)), 0,
  'Bowling und Pizza sind ausgeglichen');
select is((select balance_cents from public.crew_open_balances(tests.var('crew')::uuid) b where b.plan_id = tests.var('kino')::uuid and b.user_id = tests.uid('carol')), -1000,
  'beim Kino bleibt Carols Anteil offen');
select is((select balance_cents from public.crew_open_balances(tests.var('crew')::uuid) b where b.plan_id = tests.var('carol_plan')::uuid and b.user_id = tests.uid('alice')), -1000,
  'der Abend ohne Bob bleibt unberührt');
select is((select count(*)::int from public.plan_expenses e where e.kind = 'settlement' and e.plan_id = tests.var('carol_plan')::uuid), 0, 'dort wurde nichts eingetragen');

-- Eine Benachrichtigung an Alice, nicht eine je Abend.
select is((select count(*)::int from public.notifications n where n.user_id = tests.uid('alice') and n.type = 'plan_settlement'), 1, 'Alice bekommt genau eine Nachricht');
select is((select n.payload from public.notifications n where n.user_id = tests.uid('alice') and n.type = 'plan_settlement'),
  jsonb_build_object('bundle', true, 'crew_name', 'Weekend Crew', 'amount_cents', 2800, 'plan_count', 3, 'direction', 'paid_you'),
  'mit Summe, Zahl der Abende und Richtung');
select is((select n.entity_type || ':' || n.related_entity_id::text from public.notifications n where n.user_id = tests.uid('alice') and n.type = 'plan_settlement'),
  'crew:' || tests.var('crew'), 'die Nachricht führt zur Crew');

-- Zweiter Tipp: nichts mehr offen.
select throws_ok(format($$ select public.settle_crew_balances_with(%L, %L, 0) $$, tests.var('crew'), tests.uid('alice')), 'P0001', 'nothing_to_settle', 'zweimal geht nicht');

-- ---- Genau verrechnet ----------------------------------------------------------------------------
-- Neuer Abend: Alice zahlt 8 € für Alice und Carol (Carol gibt 4 €), Carol hat beim Kino noch 10 € offen,
-- Alice beim Eis 10 € an Carol. Aus Carols Sicht: −10 + 10 − 4 = −4 €.
select tests.login('alice');
select ok(public.add_plan_expense(tests.var('pizza')::uuid, 'Getränke', 800, null, array[tests.uid('alice'), tests.uid('carol')]) is not null, 'Getränke bei der Pizza eingetragen');
select tests.login('carol');
select is(public.settle_crew_balances_with(tests.var('crew')::uuid, tests.uid('alice'), -400),
  jsonb_build_object('plans', 3, 'net_cents', -400), 'Carol gleicht über drei Abende mit 4 € aus');
select is((select count(*)::int from public.crew_open_balances(tests.var('crew')::uuid)), 0, 'in der ganzen Crew ist nichts mehr offen');

-- Gegenseitig gleich hoch: quitt ohne Überweisung.
select tests.login('alice');
select ok(public.add_plan_expense(tests.var('bowling')::uuid, 'Schuhe', 1000, null, array[tests.uid('alice'), tests.uid('bob')]) is not null, 'Alice: Schuhe, Bob gibt 5 €');
select tests.login('bob');
select ok(public.add_plan_expense(tests.var('kino')::uuid, 'Popcorn', 1000, null, array[tests.uid('alice'), tests.uid('bob')]) is not null, 'Bob: Popcorn, Alice gibt 5 €');
select tests.login('alice');
select is(public.settle_crew_balances_with(tests.var('crew')::uuid, tests.uid('bob'), 0),
  jsonb_build_object('plans', 2, 'net_cents', 0), 'gegenseitig 5 €: verrechnet, quitt');
select is((select n.payload ->> 'direction' from public.notifications n where n.user_id = tests.uid('bob') and n.type = 'plan_settlement' and n.payload ? 'bundle'), 'offset',
  'Bob erfährt, dass verrechnet wurde');
select is((select count(*)::int from public.crew_open_balances(tests.var('crew')::uuid)), 0, 'wieder alles ausgeglichen');

-- Wer die Crew verlassen hat, kann nicht mehr ausgleichen.
select tests.login('carol');
select lives_ok($$ select public.leave_crew(tests.var('crew')::uuid) $$, 'Carol verlässt die Crew');
select throws_ok(format($$ select public.settle_crew_balances_with(%L, %L, 0) $$, tests.var('crew'), tests.uid('alice')), '42501', null, 'ehemalige Mitglieder gleichen nicht mehr aus');

select * from finish();
rollback;
