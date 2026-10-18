-- P3 Etappe 2: Ungleich aufteilen – Anteile je Person, Summe muss auf den Cent stimmen, nur Mitglieder,
-- Benachrichtigung mit dem eigenen Anteil, Außenstehende scheitern.
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
  (tests.var('crew')::uuid, tests.uid('alice'), 'Pizzaabend', now() - interval '1 day', 'completed'),
  (tests.var('mallory_crew')::uuid, tests.uid('mallory'), 'Fremder Abend', now() + interval '2 days', 'confirmed');
select tests.set_var('plan', (select id::text from public.plans where title = 'Pizzaabend'));
select tests.set_var('mallory_plan', (select id::text from public.plans where title = 'Fremder Abend'));

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.add_plan_expense_custom(uuid, text, integer, uuid, uuid[], integer[])', 'execute'), 'anon darf nicht ungleich aufteilen');
select ok(has_function_privilege('authenticated', 'public.add_plan_expense_custom(uuid, text, integer, uuid, uuid[], integer[])', 'execute'), 'angemeldete Mitglieder dürfen');

-- ---- Eintragen ---------------------------------------------------------------------------------
-- 30 € Pizza: Alice 12 €, Bob 15 €, Carol nur ein Wasser für 3 €.
select tests.login('alice');
select tests.set_var('pizza', public.add_plan_expense_custom(tests.var('plan')::uuid, ' Pizza  und Wasser ', 3000, null,
  array[tests.uid('alice'), tests.uid('bob'), tests.uid('carol')], array[1200, 1500, 300])::text);
select is((select description || ':' || amount_cents || ':' || kind from public.plan_expenses where id = tests.var('pizza')::uuid),
  'Pizza und Wasser:3000:expense', 'Eintrag mit bereinigter Beschreibung und Gesamtbetrag');
select is((select paid_by from public.plan_expenses where id = tests.var('pizza')::uuid), tests.uid('alice'), 'ohne Angabe hat die eintragende Person bezahlt');
select is((select amount_cents from public.plan_expense_shares where expense_id = tests.var('pizza')::uuid and user_id = tests.uid('carol')), 300, 'Carols Anteil: 3 €');
select is((select amount_cents from public.plan_expense_shares where expense_id = tests.var('pizza')::uuid and user_id = tests.uid('bob')), 1500, 'Bobs Anteil: 15 €');
select is((select sum(amount_cents)::int from public.plan_expense_shares where expense_id = tests.var('pizza')::uuid), 3000, 'Anteile ergeben genau den Betrag');

-- Jemand anderes hat bezahlt, und die zahlende Person ist nicht beteiligt.
select tests.set_var('taxi', public.add_plan_expense_custom(tests.var('plan')::uuid, 'Taxi', 2000, tests.uid('bob'),
  array[tests.uid('carol'), tests.uid('alice')], array[1999, 1])::text);
select is((select paid_by from public.plan_expenses where id = tests.var('taxi')::uuid), tests.uid('bob'), 'bezahlt von Bob');
select is((select count(*)::int from public.plan_expense_shares where expense_id = tests.var('taxi')::uuid and user_id = tests.uid('bob')), 0, 'Bob ist nicht beteiligt');

-- ---- Eingabeprüfung ----------------------------------------------------------------------------
select throws_ok($$ select public.add_plan_expense_custom(tests.var('plan')::uuid, 'Pizza', 3000, null, array[tests.uid('alice'), tests.uid('bob')], array[1000, 1500]) $$,
  'P0001', 'expense_shares_mismatch', 'Anteile ergeben zu wenig');
select throws_ok($$ select public.add_plan_expense_custom(tests.var('plan')::uuid, 'Pizza', 3000, null, array[tests.uid('alice'), tests.uid('bob')], array[1500, 1501]) $$,
  'P0001', 'expense_shares_mismatch', 'Anteile ergeben zu viel');
select throws_ok($$ select public.add_plan_expense_custom(tests.var('plan')::uuid, 'Pizza', 3000, null, array[tests.uid('alice'), tests.uid('bob')], array[3000, 0]) $$,
  'P0001', 'invalid_expense_share', 'Anteil 0 geht nicht');
select throws_ok($$ select public.add_plan_expense_custom(tests.var('plan')::uuid, 'Pizza', 3000, null, array[tests.uid('alice'), tests.uid('bob')], array[3500, -500]) $$,
  'P0001', 'invalid_expense_share', 'negativer Anteil geht nicht (auch wenn die Summe stimmt)');
select throws_ok($$ select public.add_plan_expense_custom(tests.var('plan')::uuid, 'Pizza', 3000, null, array[tests.uid('alice'), tests.uid('bob')], array[3000, null]) $$,
  'P0001', 'invalid_expense_share', 'fehlender Anteil');
select throws_ok($$ select public.add_plan_expense_custom(tests.var('plan')::uuid, 'Pizza', 3000, null, array[tests.uid('alice'), tests.uid('bob')], array[3000]) $$,
  'P0001', 'invalid_expense_split', 'Listen unterschiedlich lang');
select throws_ok($$ select public.add_plan_expense_custom(tests.var('plan')::uuid, 'Pizza', 3000, null, array[tests.uid('alice'), tests.uid('alice')], array[1500, 1500]) $$,
  'P0001', 'invalid_expense_split', 'dieselbe Person zweimal');
select throws_ok($$ select public.add_plan_expense_custom(tests.var('plan')::uuid, 'Pizza', 3000, null, array[tests.uid('alice'), null], array[1500, 1500]) $$,
  'P0001', 'invalid_expense_split', 'leere Person');
select throws_ok($$ select public.add_plan_expense_custom(tests.var('plan')::uuid, 'Pizza', 3000, null, '{}', '{}') $$,
  'P0001', 'invalid_expense_split', 'ohne Beteiligte geht nicht');
select throws_ok($$ select public.add_plan_expense_custom(tests.var('plan')::uuid, 'Pizza', 3000, null, null, null) $$,
  'P0001', 'invalid_expense_split', 'Beteiligte fehlen');
select throws_ok($$ select public.add_plan_expense_custom(tests.var('plan')::uuid, 'Pizza', 3000, null, array[tests.uid('alice'), tests.uid('mallory')], array[1500, 1500]) $$,
  'P0001', 'invalid_expense_split', 'Außenstehende können nicht beteiligt werden');
select throws_ok($$ select public.add_plan_expense_custom(tests.var('plan')::uuid, 'Pizza', 3000, tests.uid('mallory'), array[tests.uid('alice')], array[3000]) $$,
  'P0001', 'invalid_expense_split', 'Außenstehende können nicht als zahlend eingetragen werden');
select throws_ok($$ select public.add_plan_expense_custom(tests.var('plan')::uuid, 'x', 3000, null, array[tests.uid('alice')], array[3000]) $$,
  'P0001', 'invalid_expense_description', 'zu kurze Beschreibung');
select throws_ok($$ select public.add_plan_expense_custom(tests.var('plan')::uuid, 'Pizza', 1000001, null, array[tests.uid('alice')], array[1000001]) $$,
  'P0001', 'invalid_expense_amount', 'über 10.000 € geht nicht');
select throws_ok($$ select public.add_plan_expense_custom(tests.var('plan')::uuid, 'Pizza', 2000000000, null,
    array[tests.uid('alice'), tests.uid('bob'), tests.uid('carol')], array[2000000000, 2000000000, -1000000000]) $$,
  'P0001', 'invalid_expense_amount', 'riesige Beträge scheitern vor jeder Summe');
select is((select count(*)::int from public.plan_expenses), 2, 'abgelehnte Einträge schreiben nichts');

-- ---- Benachrichtigungen --------------------------------------------------------------------------
select tests.login('carol');
select is((select (payload ->> 'share_cents')::int from public.notifications where type = 'plan_expense' and payload ->> 'description' = 'Pizza und Wasser'), 300,
  'Carol erfährt ihren eigenen Anteil: 3 €');
select tests.login('bob');
select is((select (payload ->> 'share_cents')::int from public.notifications where type = 'plan_expense' and payload ->> 'description' = 'Pizza und Wasser'), 1500,
  'Bob erfährt seinen eigenen Anteil: 15 €');
select is((select payload ->> 'you_paid' from public.notifications where type = 'plan_expense' and payload ->> 'description' = 'Taxi'), 'true',
  'Bob erfährt, dass er als zahlend eingetragen wurde');
select tests.login('alice');
select is((select count(*)::int from public.notifications where type = 'plan_expense'), 0, 'wer einträgt, bekommt keine Benachrichtigung');

-- ---- Angriffe von außen ----------------------------------------------------------------------------
select tests.login('mallory');
select throws_ok($$ select public.add_plan_expense_custom(tests.var('plan')::uuid, 'Fake', 500, tests.uid('mallory'), array[tests.uid('alice')], array[500]) $$,
  '42501', null, 'Außenstehende tragen nichts in fremde Pläne ein');
select throws_ok($$ select public.add_plan_expense_custom(tests.var('mallory_plan')::uuid, 'Fake', 500, null, array[tests.uid('alice')], array[500]) $$,
  'P0001', 'invalid_expense_split', 'Fremde lassen sich nicht in den eigenen Plan ziehen');
select is((select count(*)::int from public.plan_expense_shares), 0, 'Außenstehende sehen keine Anteile');

select tests.login_anon();
select throws_ok($$ select public.add_plan_expense_custom(tests.var('plan')::uuid, 'Fake', 500, null, array[tests.uid('alice')], array[500]) $$,
  '42501', null, 'anon scheitert');

-- ---- Rate Limit (gemeinsam mit gleichmäßigem Aufteilen) ---------------------------------------------
select tests.logout();
insert into public.rate_limit_hits (user_id, action) select tests.uid('carol'), 'plan_expense' from generate_series(1, 60);
select tests.login('carol');
select throws_ok($$ select public.add_plan_expense_custom(tests.var('plan')::uuid, 'Wasser', 300, null, array[tests.uid('carol')], array[300]) $$,
  'P0001', 'rate_limited', 'höchstens 60 Einträge pro Stunde, egal wie aufgeteilt');

-- ---- Löschen funktioniert wie bei gleichmäßigen Einträgen ---------------------------------------------
select tests.login('bob');
select lives_ok($$ select public.delete_plan_expense(tests.var('taxi')::uuid) $$, 'Bob (zahlend) löscht das Taxi');
select tests.logout();
select is((select count(*)::int from public.plan_expense_shares where expense_id = tests.var('taxi')::uuid), 0, 'Anteile verschwinden mit');

select * from finish();
rollback;
