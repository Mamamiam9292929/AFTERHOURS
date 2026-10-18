-- P3 Etappe 3a: Offene Beträge der ganzen Crew – Salden je Plan und Person, nur offene Zeilen,
-- ausgeglichene Abende verschwinden, nur Mitglieder lesen, Außenstehende und anon scheitern.
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
  (tests.var('crew')::uuid, tests.uid('alice'), 'Kino', now() - interval '1 day', 'completed'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Ohne Kosten', now() - interval '2 days', 'completed'),
  (tests.var('mallory_crew')::uuid, tests.uid('mallory'), 'Fremder Abend', now() - interval '1 day', 'completed');
select tests.set_var('bowling', (select id::text from public.plans where title = 'Bowling'));
select tests.set_var('kino', (select id::text from public.plans where title = 'Kino'));
select tests.set_var('mallory_plan', (select id::text from public.plans where title = 'Fremder Abend'));

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.crew_open_balances(uuid)', 'execute'), 'anon darf keine Salden lesen');
select ok(has_function_privilege('authenticated', 'public.crew_open_balances(uuid)', 'execute'), 'angemeldete Mitglieder dürfen');

-- ---- Leere Crew ----------------------------------------------------------------------------------
select tests.login('alice');
select is((select count(*)::int from public.crew_open_balances(tests.var('crew')::uuid)), 0, 'ohne Ausgaben ist nichts offen');

-- ---- Ausgaben ------------------------------------------------------------------------------------
-- Bowling: Alice zahlt 48 € für Alice und Bob, Bob zahlt 9 € Getränke für alle drei.
-- Alice: +24 − 3 = +21 €, Bob: −24 + 6 = −18 €, Carol: −3 €.
select ok(public.add_plan_expense(tests.var('bowling')::uuid, 'Bahn', 4800, null, array[tests.uid('alice'), tests.uid('bob')]) is not null, 'Bahn eingetragen');
-- Nur für sich selbst bezahlt: ändert keinen Saldo.
select ok(public.add_plan_expense(tests.var('bowling')::uuid, 'Schuhe', 400, null, array[tests.uid('alice')]) is not null, 'eigene Schuhe eingetragen');
select tests.login('bob');
select ok(public.add_plan_expense(tests.var('bowling')::uuid, 'Getränke', 900, null, array[tests.uid('alice'), tests.uid('bob'), tests.uid('carol')]) is not null, 'Getränke eingetragen');
-- Kino: Carol zahlt 30 € für Alice und sich. Alice −15 €, Carol +15 €.
select tests.login('carol');
select ok(public.add_plan_expense(tests.var('kino')::uuid, 'Tickets', 3000, null, array[tests.uid('alice'), tests.uid('carol')]) is not null, 'Kinotickets eingetragen');
-- Fremde Crew: Mallory hat auch Ausgaben – die dürfen nirgends auftauchen.
select tests.login('mallory');
select ok(public.add_plan_expense(tests.var('mallory_plan')::uuid, 'Geheim', 5000, null, array[tests.uid('mallory')]) is not null, 'Mallory trägt in ihrer Crew ein');

-- ---- Salden --------------------------------------------------------------------------------------
select tests.login('bob');
select is((select count(*)::int from public.crew_open_balances(tests.var('crew')::uuid)), 5, 'fünf offene Zeilen: drei beim Bowling, zwei beim Kino');
select is((select balance_cents from public.crew_open_balances(tests.var('crew')::uuid) b where b.plan_id = tests.var('bowling')::uuid and b.user_id = tests.uid('alice')), 2100, 'Alice bekommt beim Bowling 21 €');
select is((select balance_cents from public.crew_open_balances(tests.var('crew')::uuid) b where b.plan_id = tests.var('bowling')::uuid and b.user_id = tests.uid('bob')), -1800, 'Bob gibt beim Bowling 18 €');
select is((select balance_cents from public.crew_open_balances(tests.var('crew')::uuid) b where b.plan_id = tests.var('bowling')::uuid and b.user_id = tests.uid('carol')), -300, 'Carol gibt beim Bowling 3 €');
select is((select balance_cents from public.crew_open_balances(tests.var('crew')::uuid) b where b.plan_id = tests.var('kino')::uuid and b.user_id = tests.uid('alice')), -1500, 'Alice gibt beim Kino 15 €');
select is((select count(*)::int from (select b.plan_id from public.crew_open_balances(tests.var('crew')::uuid) b group by b.plan_id having sum(b.balance_cents) <> 0) x), 0, 'je Plan ergeben die Salden zusammen 0');
select is((select sum(balance_cents)::int from public.crew_open_balances(tests.var('crew')::uuid) b where b.user_id = tests.uid('alice')), 600, 'Alice steht über alle Abende bei +6 €');
select is((select count(*)::int from public.crew_open_balances(tests.var('crew')::uuid) b where b.plan_id not in (tests.var('bowling')::uuid, tests.var('kino')::uuid)), 0, 'Pläne ohne offene Beträge und fremde Pläne fehlen');

-- ---- Ausgleichen ---------------------------------------------------------------------------------
-- Alice gibt Carol die 15 € fürs Kino: der Abend verschwindet aus der Liste.
select tests.login('alice');
select ok(public.record_plan_settlement(tests.var('kino')::uuid, tests.uid('alice'), tests.uid('carol'), 1500) is not null, 'Rückzahlung eingetragen');
select is((select count(*)::int from public.crew_open_balances(tests.var('crew')::uuid) b where b.plan_id = tests.var('kino')::uuid), 0, 'ausgeglichener Abend ist nicht mehr offen');
select is((select count(*)::int from public.crew_open_balances(tests.var('crew')::uuid)), 3, 'Bowling bleibt offen');

-- ---- Angriffe ------------------------------------------------------------------------------------
select tests.login('mallory');
select throws_ok($$ select * from public.crew_open_balances(tests.var('crew')::uuid) $$, '42501', null, 'Außenstehende lesen keine fremden Salden');
select throws_ok($$ select * from public.crew_open_balances(null) $$, '42501', null, 'ohne Crew gibt es nichts');
select throws_ok($$ select * from public.crew_open_balances(gen_random_uuid()) $$, '42501', null, 'unbekannte Crew wird abgewiesen');
select is((select count(*)::int from public.crew_open_balances(tests.var('mallory_crew')::uuid)), 0, 'Mallorys eigene Crew: nur für sich bezahlt, nichts offen');

-- Wer die Crew verlässt, sieht die Salden nicht mehr.
select tests.login('carol');
select lives_ok($$ select public.leave_crew(tests.var('crew')::uuid) $$, 'Carol verlässt die Crew');
select throws_ok($$ select * from public.crew_open_balances(tests.var('crew')::uuid) $$, '42501', null, 'ehemalige Mitglieder lesen nichts mehr');

select tests.login_anon();
select throws_ok($$ select * from public.crew_open_balances(tests.var('crew')::uuid) $$, '42501', null, 'anon scheitert');

select * from finish();
rollback;
