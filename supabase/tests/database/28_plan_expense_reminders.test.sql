-- P3 Etappe 3b: Freundliche Erinnerung an offene Beträge – eine Woche nach Abend und letztem Eintrag,
-- genau einmal je Person und Abend, nur bei offenem Betrag, abschaltbar, nur eigene Erinnerungen per
-- App, alle per Cron; Außenstehende, anon und ehemalige Mitglieder bekommen nichts.
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
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Bob tritt bei');
select tests.login('carol');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Carol tritt bei');
select tests.login('dave');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Dave tritt bei');
select tests.login('mallory');
select tests.set_var('mallory_crew', public.create_crew('Fremde Crew')::text);

select tests.logout();
insert into public.plans (crew_id, created_by, title, starts_at, status) values
  (tests.var('crew')::uuid, tests.uid('alice'), 'Bowling', now() - interval '10 days', 'completed'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Kino', now() - interval '3 days', 'completed'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Nachgetragen', now() - interval '10 days', 'completed'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Uralt', now() - interval '60 days', 'completed'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Ausgeglichen', now() - interval '10 days', 'completed'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Pizza', now() - interval '10 days', 'completed'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Abschied', now() - interval '10 days', 'completed'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Anzahlung', now() + interval '5 days', 'confirmed'),
  (tests.var('mallory_crew')::uuid, tests.uid('mallory'), 'Fremder Abend', now() - interval '10 days', 'completed');
select tests.set_var(lower(title), id::text) from public.plans where title in ('Bowling', 'Kino', 'Nachgetragen', 'Uralt', 'Ausgeglichen', 'Pizza', 'Abschied', 'Anzahlung', 'Fremder Abend');

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.send_my_expense_reminders()', 'execute'), 'anon darf keine Erinnerungen anstoßen');
select ok(has_function_privilege('authenticated', 'public.send_my_expense_reminders()', 'execute'), 'angemeldete Personen dürfen ihre eigenen anstoßen');
select ok(not has_function_privilege('authenticated', 'app_private.send_expense_reminders(uuid)', 'execute'), 'Erinnerungen für andere sind gesperrt');
select ok(not has_function_privilege('authenticated', 'app_private.send_due_expense_reminders()', 'execute'), 'Erinnerungen für alle sind gesperrt');
select ok(not has_table_privilege('authenticated', 'public.plan_expense_reminders', 'select'), 'die Erinnerungsliste ist nicht lesbar');
select ok(not has_table_privilege('authenticated', 'public.plan_expense_reminders', 'insert'), 'die Erinnerungsliste ist nicht beschreibbar');
select ok(not has_table_privilege('anon', 'public.plan_expense_reminders', 'select'), 'anon liest die Erinnerungsliste nicht');
select matches((select pg_get_constraintdef(c.oid) from pg_constraint c where c.conname = 'notifications_type_check'), 'plan_expense_reminder', 'neuer Benachrichtigungstyp erlaubt');
select matches((select pg_get_constraintdef(c.oid) from pg_constraint c where c.conname = 'notifications_type_check'), 'plan_settlement.*reward_earned|reward_earned.*plan_settlement', 'bisherige Typen bleiben erlaubt');

-- ---- Ausgaben ------------------------------------------------------------------------------------
select tests.login('alice');
-- Bowling: Alice zahlt 48 € für Alice und Bob → Bob gibt 24 €, Alice bekommt 24 €.
select ok(public.add_plan_expense(tests.var('bowling')::uuid, 'Bahn', 4800, null, array[tests.uid('alice'), tests.uid('bob')]) is not null, 'Bowling eingetragen');
-- Kino: Abend erst drei Tage her.
select ok(public.add_plan_expense(tests.var('kino')::uuid, 'Tickets', 2000, null, array[tests.uid('alice'), tests.uid('bob')]) is not null, 'Kino eingetragen');
-- Nachgetragen: Abend lange her, aber gestern eingetragen.
select ok(public.add_plan_expense(tests.var('nachgetragen')::uuid, 'Taxi', 1000, null, array[tests.uid('alice'), tests.uid('bob')]) is not null, 'Taxi nachgetragen');
-- Uralt: letzter Eintrag vor 40 Tagen.
select ok(public.add_plan_expense(tests.var('uralt')::uuid, 'Grill', 3000, null, array[tests.uid('alice'), tests.uid('bob')]) is not null, 'Grill eingetragen');
-- Ausgeglichen: Bob hat schon zurückgezahlt.
select ok(public.add_plan_expense(tests.var('ausgeglichen')::uuid, 'Eis', 800, null, array[tests.uid('alice'), tests.uid('bob')]) is not null, 'Eis eingetragen');
select ok(public.record_plan_settlement(tests.var('ausgeglichen')::uuid, tests.uid('bob'), tests.uid('alice'), 400) is not null, 'Eis zurückgezahlt');
-- Anzahlung: Abend steht noch bevor.
select ok(public.add_plan_expense(tests.var('anzahlung')::uuid, 'Anzahlung', 5000, null, array[tests.uid('alice'), tests.uid('bob')]) is not null, 'Anzahlung eingetragen');
-- Abschied: Dave schuldet Alice 10 €, verlässt danach die Crew.
select ok(public.add_plan_expense(tests.var('abschied')::uuid, 'Kuchen', 2000, null, array[tests.uid('alice'), tests.uid('dave')]) is not null, 'Kuchen eingetragen');
-- Pizza: Carol zahlt 20 € für Carol und Bob.
select tests.login('carol');
select ok(public.add_plan_expense(tests.var('pizza')::uuid, 'Pizza', 2000, null, array[tests.uid('carol'), tests.uid('bob')]) is not null, 'Pizza eingetragen');
select tests.login('mallory');
select ok(public.add_plan_expense(tests.var('fremder abend')::uuid, 'Geheim', 5000, null, array[tests.uid('mallory')]) is not null, 'Mallory trägt in ihrer Crew ein');

-- Einträge zurückdatieren (wie nach einer Woche).
select tests.logout();
update public.plan_expenses set created_at = now() - interval '8 days'
  where plan_id in (tests.var('bowling')::uuid, tests.var('kino')::uuid, tests.var('ausgeglichen')::uuid, tests.var('pizza')::uuid,
                    tests.var('abschied')::uuid, tests.var('anzahlung')::uuid, tests.var('fremder abend')::uuid);
update public.plan_expenses set created_at = now() - interval '1 day' where plan_id = tests.var('nachgetragen')::uuid;
update public.plan_expenses set created_at = now() - interval '40 days' where plan_id = tests.var('uralt')::uuid;
delete from public.notifications;

-- ---- anon ----------------------------------------------------------------------------------------
select tests.login_anon();
select throws_ok($$ select public.send_my_expense_reminders() $$, '42501', null, 'anon kann nichts anstoßen');

-- ---- Bob: nur eigene, nur fällige ----------------------------------------------------------------
select tests.login('bob');
select is(public.send_my_expense_reminders(), 2, 'Bob wird für Bowling und Pizza erinnert');
select is((select count(*)::int from public.notifications n where n.type = 'plan_expense_reminder'), 2, 'Bob hat zwei Erinnerungen');
select is((select (n.payload ->> 'balance_cents')::int from public.notifications n where n.type = 'plan_expense_reminder' and n.related_entity_id = tests.var('bowling')::uuid), -2400, 'Bowling: Bob gibt noch 24 €');
select is((select n.payload ->> 'title' from public.notifications n where n.type = 'plan_expense_reminder' and n.related_entity_id = tests.var('bowling')::uuid), 'Bowling', 'mit dem Titel des Abends');
select is((select n.entity_type || ':' || (n.actor_id is null) from public.notifications n where n.type = 'plan_expense_reminder' and n.related_entity_id = tests.var('bowling')::uuid), 'plan:true', 'führt zum Plan, ohne auslösende Person');
select ok(not ((select n.payload from public.notifications n where n.type = 'plan_expense_reminder' and n.related_entity_id = tests.var('pizza')::uuid) ?| array['user_id', 'paid_by', 'name']), 'keine Namen oder IDs anderer in der Erinnerung');
select is((select count(*)::int from public.notifications n where n.type = 'plan_expense_reminder'
           and n.related_entity_id in (tests.var('kino')::uuid, tests.var('nachgetragen')::uuid, tests.var('uralt')::uuid,
                                       tests.var('ausgeglichen')::uuid, tests.var('anzahlung')::uuid)), 0,
          'nichts für zu frische, nachgetragene, uralte, ausgeglichene und anstehende Abende');
select is(public.send_my_expense_reminders(), 0, 'ein zweiter Aufruf erinnert nicht noch einmal');
select is((select count(*)::int from public.notifications n where n.type = 'plan_expense_reminder'), 2, 'weiterhin zwei Erinnerungen');

-- Alice hat noch nichts bekommen: Bobs Aufruf erinnert nur Bob.
select tests.login('alice');
select is((select count(*)::int from public.notifications n where n.type = 'plan_expense_reminder'), 0, 'Bobs Aufruf erinnert nur Bob');
select is(public.send_my_expense_reminders(), 2, 'Alice wird für Bowling und Abschied erinnert');
select is((select (n.payload ->> 'balance_cents')::int from public.notifications n where n.type = 'plan_expense_reminder' and n.related_entity_id = tests.var('bowling')::uuid), 2400, 'Bowling: Alice bekommt noch 24 €');

-- Carol bekommt für Pizza Geld.
select tests.login('carol');
select is(public.send_my_expense_reminders(), 1, 'Carol wird für Pizza erinnert');

-- ---- Auch neue Einträge lösen keine zweite Erinnerung aus ---------------------------------------
select tests.login('alice');
select ok(public.add_plan_expense(tests.var('bowling')::uuid, 'Schuhe', 600, null, array[tests.uid('alice'), tests.uid('bob')]) is not null, 'Schuhe nachgetragen');
select tests.logout();
update public.plan_expenses set created_at = now() - interval '8 days' where plan_id = tests.var('bowling')::uuid;
select tests.login('bob');
select is(public.send_my_expense_reminders(), 0, 'je Abend nur eine Erinnerung – auch nach neuen Einträgen');
-- Gelöschte Benachrichtigung kommt nicht wieder.
delete from public.notifications n where n.type = 'plan_expense_reminder' and n.related_entity_id = tests.var('bowling')::uuid;
select is(public.send_my_expense_reminders(), 0, 'gelöschte Erinnerung kommt nicht wieder');

-- ---- Abgeschaltet --------------------------------------------------------------------------------
select tests.logout();
update public.user_settings set notification_preferences = '{"plan_expense_reminder": false}' where user_id = tests.uid('bob');
update public.plan_expenses set created_at = now() - interval '8 days' where plan_id = tests.var('nachgetragen')::uuid;
select tests.login('bob');
select is(public.send_my_expense_reminders(), 1, 'Nachgetragen ist jetzt fällig');
select is((select count(*)::int from public.notifications n where n.type = 'plan_expense_reminder' and n.related_entity_id = tests.var('nachgetragen')::uuid), 0, 'abgeschaltet: keine Benachrichtigung');
select tests.logout();
update public.user_settings set notification_preferences = '{}' where user_id = tests.uid('bob');
select tests.login('bob');
select is(public.send_my_expense_reminders(), 0, 'wieder eingeschaltet: keine nachträgliche Flut');

-- ---- Ehemalige Mitglieder und Außenstehende ------------------------------------------------------
select tests.login('dave');
select lives_ok($$ select public.leave_crew(tests.var('crew')::uuid) $$, 'Dave verlässt die Crew');
select is(public.send_my_expense_reminders(), 0, 'wer die Crew verlassen hat, wird nicht erinnert');
select tests.login('mallory');
select is(public.send_my_expense_reminders(), 0, 'Mallory: eigene Ausgabe nur für sich, nichts offen');
select is((select count(*)::int from public.notifications n where n.crew_id = tests.var('crew')::uuid), 0, 'Mallory bekommt nichts aus fremden Crews');

-- ---- Cron für alle --------------------------------------------------------------------------------
select tests.logout();
-- Kino wird fällig: Abend jetzt zehn Tage her.
update public.plans set starts_at = now() - interval '10 days' where id = tests.var('kino')::uuid;
select is(app_private.send_due_expense_reminders(), 3, 'Cron erinnert Alice und Bob für Kino und Alice für Nachgetragen');
select is(app_private.send_due_expense_reminders(), 0, 'Cron ein zweites Mal: nichts');
select is((select count(*)::int from public.plan_expense_reminders r where r.user_id = tests.uid('dave')), 0, 'Cron überspringt ehemalige Mitglieder');
select is((select count(*)::int from public.plan_expense_reminders r where r.plan_id = tests.var('uralt')::uuid), 0, 'Cron überspringt uralte Abende');

-- ---- Rate Limit ----------------------------------------------------------------------------------
select tests.login('mallory');
select is((select count(public.send_my_expense_reminders())::int from generate_series(1, 119)), 119, '119 weitere Aufrufe gehen');
select throws_ok($$ select public.send_my_expense_reminders() $$, 'P0001', 'rate_limited', 'mehr als 120 Aufrufe je Stunde werden abgewiesen');

-- ---- Kontolöschung -------------------------------------------------------------------------------
select tests.logout();
delete from auth.users where id = tests.uid('carol');
select is((select count(*)::int from public.plan_expense_reminders r where r.user_id = tests.uid('carol')), 0, 'Kontolöschung entfernt die Erinnerungsliste');

select * from finish();
rollback;
