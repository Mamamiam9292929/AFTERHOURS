-- P3 Etappe 1: Kosten aufteilen – nur die Crew sieht und schreibt Ausgaben, Anteile rechnet der Server,
-- Rückzahlungen nur durch die Beteiligten, Löschen nur durch Berechtigte, Außenstehende scheitern.
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
  (tests.var('crew')::uuid, tests.uid('alice'), 'Bowling', now() - interval '1 day', 'completed'),
  (tests.var('mallory_crew')::uuid, tests.uid('mallory'), 'Fremder Abend', now() + interval '2 days', 'confirmed');
select tests.set_var('plan', (select id::text from public.plans where title = 'Bowling'));
select tests.set_var('mallory_plan', (select id::text from public.plans where title = 'Fremder Abend'));

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.add_plan_expense(uuid, text, integer, uuid, uuid[])', 'execute'), 'anon darf keine Ausgabe eintragen');
select ok(not has_function_privilege('anon', 'public.record_plan_settlement(uuid, uuid, uuid, integer)', 'execute'), 'anon darf keine Rückzahlung eintragen');
select ok(not has_function_privilege('anon', 'public.delete_plan_expense(uuid)', 'execute'), 'anon darf nichts löschen');
select ok(not has_function_privilege('authenticated', 'app_private.is_member_of(uuid, uuid)', 'execute'), 'Hilfsfunktion ist intern');
select ok(not has_table_privilege('authenticated', 'public.plan_expenses', 'insert'), 'Ausgaben nicht direkt schreibbar');
select ok(not has_table_privilege('authenticated', 'public.plan_expense_shares', 'update'), 'Anteile nicht direkt änderbar');

select tests.login_anon();
select throws_ok('select * from public.plan_expenses', '42501', null, 'anon liest keine Ausgaben');
select throws_ok('select * from public.plan_expense_shares', '42501', null, 'anon liest keine Anteile');

-- ---- Eintragen ---------------------------------------------------------------------------------
select tests.login('alice');
select tests.set_var('lane', public.add_plan_expense(tests.var('plan')::uuid, '  Bowling-   bahn ', 4800, null,
  array[tests.uid('alice'), tests.uid('bob')])::text);
select is((select description from public.plan_expenses where id = tests.var('lane')::uuid), 'Bowling- bahn', 'Beschreibung wird bereinigt');
select is((select paid_by from public.plan_expenses where id = tests.var('lane')::uuid), tests.uid('alice'), 'ohne Angabe hat die eintragende Person bezahlt');
select is((select array_agg(amount_cents order by amount_cents) from public.plan_expense_shares where expense_id = tests.var('lane')::uuid), array[2400, 2400], '48 € durch zwei: je 24 €');

select tests.login('bob');
select tests.set_var('drinks', public.add_plan_expense(tests.var('plan')::uuid, 'Getränke', 1000, tests.uid('bob'),
  array[tests.uid('alice'), tests.uid('bob'), tests.uid('carol'), tests.uid('carol'), null])::text);
select is((select count(*)::int from public.plan_expense_shares where expense_id = tests.var('drinks')::uuid), 3, 'doppelte und leere Einträge fallen weg');
select is((select sum(amount_cents)::int from public.plan_expense_shares where expense_id = tests.var('drinks')::uuid), 1000, 'Anteile ergeben genau den Betrag');
select is((select array_agg(amount_cents order by amount_cents) from public.plan_expense_shares where expense_id = tests.var('drinks')::uuid), array[333, 333, 334], '10 € durch drei: ein Rest-Cent');
select is((select count(*)::int from public.plan_expenses), 2, 'Mitglieder sehen alle Ausgaben des Plans');

-- Jemand anderes hat bezahlt: Alice trägt ein, dass Bob das Taxi bezahlt hat, nur für Carol.
select tests.login('alice');
select tests.set_var('taxi', public.add_plan_expense(tests.var('plan')::uuid, 'Taxi', 1200, tests.uid('bob'), array[tests.uid('carol')])::text);
select is((select created_by from public.plan_expenses where id = tests.var('taxi')::uuid), tests.uid('alice'), 'angelegt von Alice');
select is((select paid_by from public.plan_expenses where id = tests.var('taxi')::uuid), tests.uid('bob'), 'bezahlt von Bob');

-- Eingabeprüfung
select throws_ok($$ select public.add_plan_expense(tests.var('plan')::uuid, ' x ', 500, null, array[tests.uid('alice')]) $$, 'P0001', 'invalid_expense_description', 'zu kurze Beschreibung');
select throws_ok($$ select public.add_plan_expense(tests.var('plan')::uuid, 'Pizza', 0, null, array[tests.uid('alice')]) $$, 'P0001', 'invalid_expense_amount', '0 € geht nicht');
select throws_ok($$ select public.add_plan_expense(tests.var('plan')::uuid, 'Pizza', -500, null, array[tests.uid('alice')]) $$, 'P0001', 'invalid_expense_amount', 'negativer Betrag geht nicht');
select throws_ok($$ select public.add_plan_expense(tests.var('plan')::uuid, 'Pizza', 1000001, null, array[tests.uid('alice')]) $$, 'P0001', 'invalid_expense_amount', 'über 10.000 € geht nicht');
select throws_ok($$ select public.add_plan_expense(tests.var('plan')::uuid, 'Pizza', 500, null, '{}') $$, 'P0001', 'invalid_expense_split', 'ohne Beteiligte geht nicht');
select throws_ok($$ select public.add_plan_expense(tests.var('plan')::uuid, 'Pizza', 500, null, null) $$, 'P0001', 'invalid_expense_split', 'Beteiligte fehlen');
select throws_ok($$ select public.add_plan_expense(tests.var('plan')::uuid, 'Pizza', 500, null, array[tests.uid('mallory')]) $$, 'P0001', 'invalid_expense_split', 'Außenstehende können nicht beteiligt werden');
select throws_ok($$ select public.add_plan_expense(tests.var('plan')::uuid, 'Pizza', 500, tests.uid('mallory'), array[tests.uid('alice')]) $$, 'P0001', 'invalid_expense_split', 'Außenstehende können nicht als zahlend eingetragen werden');
select throws_ok($$ select public.add_plan_expense(tests.var('plan')::uuid, 'Pizza', 500, null, array[gen_random_uuid()]) $$, 'P0001', 'invalid_expense_split', 'unbekannte Person');
select is((select count(*)::int from public.plan_expenses), 3, 'abgelehnte Einträge schreiben nichts');

-- ---- Benachrichtigungen --------------------------------------------------------------------------
select tests.login('bob');
select is((select (payload ->> 'share_cents')::int from public.notifications where type = 'plan_expense' and payload ->> 'description' = 'Bowling- bahn'), 2400, 'Bob erfährt seinen Anteil an der Bowlingbahn');
select is((select payload ->> 'you_paid' from public.notifications where type = 'plan_expense' and payload ->> 'description' = 'Taxi'), 'true', 'Bob erfährt, dass Alice ihn als zahlend eingetragen hat');
select tests.login('alice');
select is((select count(*)::int from public.notifications where type = 'plan_expense' and payload ->> 'description' = 'Bowling- bahn'), 0, 'wer einträgt, bekommt keine Benachrichtigung');
select tests.login('carol');
select is((select count(*)::int from public.notifications where type = 'plan_expense'), 2, 'Carol: Getränke und Taxi');

-- ---- Angriffe von außen ----------------------------------------------------------------------------
select tests.login('mallory');
select throws_ok($$ select public.add_plan_expense(tests.var('plan')::uuid, 'Fake', 500, tests.uid('mallory'), array[tests.uid('alice')]) $$, '42501', null, 'Außenstehende tragen nichts in fremde Pläne ein');
select throws_ok($$ select public.add_plan_expense(tests.var('mallory_plan')::uuid, 'Fake', 500, null, array[tests.uid('alice')]) $$, 'P0001', 'invalid_expense_split', 'Fremde lassen sich nicht in den eigenen Plan ziehen');
select throws_ok($$ select public.record_plan_settlement(tests.var('plan')::uuid, tests.uid('alice'), tests.uid('mallory'), 500) $$, '42501', null, 'Außenstehende tragen keine Rückzahlung ein');
select throws_ok($$ select public.delete_plan_expense(tests.var('lane')::uuid) $$, '42501', null, 'Außenstehende löschen nichts');
select is((select count(*)::int from public.plan_expenses), 0, 'Außenstehende sehen keine Ausgaben');
select is((select count(*)::int from public.plan_expense_shares), 0, 'Außenstehende sehen keine Anteile');
select throws_ok($$ insert into public.plan_expenses (plan_id, description, amount_cents, paid_by) values (tests.var('plan')::uuid, 'Fake', 1, tests.uid('mallory')) $$, '42501', null, 'direktes Schreiben scheitert');

select tests.login('bob');
select throws_ok($$ update public.plan_expense_shares set amount_cents = 0 where user_id = tests.uid('bob') $$, '42501', null, 'auch Mitglieder ändern Anteile nicht direkt');
select throws_ok($$ delete from public.plan_expenses where id = tests.var('lane')::uuid $$, '42501', null, 'auch Mitglieder löschen nicht direkt');

-- ---- Rückzahlungen -------------------------------------------------------------------------------
select tests.login('carol');
select throws_ok($$ select public.record_plan_settlement(tests.var('plan')::uuid, tests.uid('bob'), tests.uid('alice'), 1400) $$, '42501', null, 'nur Beteiligte tragen eine Rückzahlung ein');
select tests.login('bob');
select throws_ok($$ select public.record_plan_settlement(tests.var('plan')::uuid, tests.uid('bob'), tests.uid('bob'), 1400) $$, 'P0001', 'invalid_settlement', 'an sich selbst geht nicht');
select throws_ok($$ select public.record_plan_settlement(tests.var('plan')::uuid, tests.uid('bob'), tests.uid('mallory'), 1400) $$, 'P0001', 'invalid_settlement', 'nur an Mitglieder der Crew');
select throws_ok($$ select public.record_plan_settlement(tests.var('plan')::uuid, tests.uid('bob'), tests.uid('alice'), 0) $$, 'P0001', 'invalid_expense_amount', 'Betrag muss stimmen');
select tests.set_var('settle', public.record_plan_settlement(tests.var('plan')::uuid, tests.uid('bob'), tests.uid('alice'), 1400)::text);
select is((select kind || ':' || paid_by::text || ':' || coalesce(description, '-') from public.plan_expenses where id = tests.var('settle')::uuid),
  'settlement:' || tests.uid('bob')::text || ':-', 'Rückzahlung: bezahlt von Bob, ohne Beschreibung');
select is((select user_id::text || ':' || amount_cents from public.plan_expense_shares where expense_id = tests.var('settle')::uuid),
  tests.uid('alice')::text || ':1400', 'Anteil: Alice bekommt 14 €');
select tests.login('alice');
select is((select payload ->> 'direction' from public.notifications where type = 'plan_settlement'), 'paid_you', 'Alice erfährt, dass Bob zurückgezahlt hat');

-- ---- Löschen -------------------------------------------------------------------------------------
select tests.login('carol');
select throws_ok($$ select public.delete_plan_expense(tests.var('lane')::uuid) $$, '42501', null, 'fremde Ausgabe: Carol darf nicht löschen');
select throws_ok($$ select public.delete_plan_expense(tests.var('settle')::uuid) $$, '42501', null, 'fremde Rückzahlung: Carol darf nicht löschen');
select tests.set_var('carol_pizza', public.add_plan_expense(tests.var('plan')::uuid, 'Pizza', 900, null, array[tests.uid('carol')])::text);
select tests.login('bob');
select lives_ok($$ select public.delete_plan_expense(tests.var('taxi')::uuid) $$, 'wer als zahlend eingetragen ist, darf löschen');
select tests.login('alice');
select lives_ok($$ select public.delete_plan_expense(tests.var('settle')::uuid) $$, 'wer das Geld bekommen hat, darf die Rückzahlung löschen');
select lives_ok($$ select public.delete_plan_expense(tests.var('carol_pizza')::uuid) $$, 'Owner darf jede Ausgabe löschen');
select is((select count(*)::int from public.plan_expense_shares where expense_id in (tests.var('taxi')::uuid, tests.var('settle')::uuid, tests.var('carol_pizza')::uuid)), 0, 'Anteile verschwinden mit');
select tests.logout();
select is((select count(*)::int from public.audit_log where action = 'plan_expense_deleted'), 3, 'Löschen steht im Audit-Log');
select tests.login('alice');
select throws_ok($$ select public.delete_plan_expense(tests.var('taxi')::uuid) $$, '42501', null, 'schon gelöscht: nichts mehr da');

-- ---- Rate Limit ------------------------------------------------------------------------------------
select tests.logout();
insert into public.rate_limit_hits (user_id, action) select tests.uid('carol'), 'plan_expense' from generate_series(1, 60);
select tests.login('carol');
select throws_ok($$ select public.add_plan_expense(tests.var('plan')::uuid, 'Pizza', 900, null, array[tests.uid('carol')]) $$, 'P0001', 'rate_limited', 'höchstens 60 Einträge pro Stunde');

-- ---- Export, Austritt, Kontolöschung -----------------------------------------------------------------
select tests.login('alice');
select is(jsonb_array_length(public.export_my_data() -> 'plan_expenses'), 1, 'Export enthält die eigene Ausgabe');
select is(jsonb_array_length(public.export_my_data() -> 'plan_expense_shares'), 2, 'Export enthält die eigenen Anteile');

select tests.login('carol');
select lives_ok($$ select public.leave_crew(tests.var('crew')::uuid) $$, 'Carol verlässt die Crew');
select is((select count(*)::int from public.plan_expenses), 0, 'nach dem Austritt sieht Carol nichts mehr');
select tests.logout();
select is((select count(*)::int from public.plan_expense_shares where user_id = tests.uid('carol')), 1, 'ihr Anteil bleibt für die Abrechnung der anderen');

select tests.login('bob');
select lives_ok($$ select public.delete_my_account('DELETE') $$, 'Bob löscht sein Konto');
select tests.logout();
select is((select count(*)::int from public.plan_expenses where paid_by = tests.uid('bob')), 0, 'Bobs Ausgaben sind gelöscht');
select is((select count(*)::int from public.plan_expense_shares where user_id = tests.uid('bob')), 0, 'Bobs Anteile sind gelöscht');
select is((select count(*)::int from public.plan_expenses where id = tests.var('lane')::uuid), 1, 'Alices Ausgabe bleibt');

select * from finish();
rollback;
