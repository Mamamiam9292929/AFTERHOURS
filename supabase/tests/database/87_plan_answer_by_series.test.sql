-- P48: Frist auch für die nächste Runde – eine Serie übernimmt den Abstand der Antwortfrist zum Beginn
-- (in Berliner Ortszeit, auch über die Zeitumstellung), wenn er noch in der Zukunft und mindestens 1 h vor Beginn
-- liegt. Ohne Frist bleibt alles wie bisher; Aussetzen trägt die Frist weiter; Außenstehende stoßen nichts an.
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
select public.create_crew('Fremde Crew');

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'app_private.plan_series_answer_by(timestamptz, timestamptz, timestamptz, timestamptz)', 'execute'),
  'Rechenfunktion bleibt intern');
select ok(not has_function_privilege('authenticated', 'app_private.plan_series_answer_by_inherit()', 'execute'), 'Trigger-Funktion bleibt intern');
select ok(not has_function_privilege('anon', 'app_private.plan_series_answer_by_inherit()', 'execute'), '… auch für anon');

-- ---- Rechnung in Berliner Ortszeit ---------------------------------------------------------------
select tests.logout();
-- Sa. 17.10. 20:00 mit Frist Do. 15.10. 18:00 → Sa. 31.10. 20:00 (nach der Umstellung am 25.10.) → Do. 29.10. 18:00 Berlin.
select is(app_private.plan_series_answer_by(
    '2026-10-17 20:00 Europe/Berlin', '2026-10-15 18:00 Europe/Berlin', '2026-10-31 20:00 Europe/Berlin', '2026-10-20 12:00 Europe/Berlin'),
  '2026-10-29 18:00 Europe/Berlin'::timestamptz, 'Zeitumstellung zwischen den Runden: gleiche Berliner Uhrzeit');
-- Mo. 26.10. 20:00 (Winterzeit), Frist Sa. 24.10. 18:00 (noch Sommerzeit) – vorige Runde ohne Umstellung dazwischen.
select is(app_private.plan_series_answer_by(
    '2026-10-19 20:00 Europe/Berlin', '2026-10-17 18:00 Europe/Berlin', '2026-10-26 20:00 Europe/Berlin', '2026-10-20 12:00 Europe/Berlin'),
  '2026-10-24 18:00 Europe/Berlin'::timestamptz, 'Zeitumstellung zwischen Frist und Beginn: Tage und Uhrzeit bleiben');
select is(app_private.plan_series_answer_by(
    '2026-10-17 20:00 Europe/Berlin', '2026-10-15 18:00 Europe/Berlin', '2026-10-31 20:00 Europe/Berlin', '2026-10-30 12:00 Europe/Berlin'),
  null, 'Abstand schon verstrichen: keine Frist');
select is(app_private.plan_series_answer_by(
    '2026-10-17 20:00 Europe/Berlin', null, '2026-10-31 20:00 Europe/Berlin', '2026-10-20 12:00 Europe/Berlin'),
  null, 'vorige Runde ohne Frist: keine Frist');
-- Eine Stunde Abstand in der Nacht der Umstellung (25.10.): Das Ergebnis liegt nie näher als 1 h am Beginn.
select ok(coalesce(app_private.plan_series_answer_by(
    '2026-10-18 03:30 Europe/Berlin', '2026-10-18 02:30 Europe/Berlin', '2026-10-25 03:30 Europe/Berlin', '2026-10-20 12:00 Europe/Berlin')
    <= '2026-10-25 03:30 Europe/Berlin'::timestamptz - interval '1 hour', true),
  'nie näher als 1 h am Beginn, auch in der Nacht der Umstellung');

-- ---- Serie mit Frist ----------------------------------------------------------------------------
-- Stammtisch jede Woche, letzter Termin vorgestern 20:00 Berliner Zeit, Frist zwei Tage vorher 18:00.
select tests.logout();
select tests.set_var('today', ((now() at time zone 'Europe/Berlin')::date)::text);
insert into public.plans (crew_id, created_by, title, starts_at, ends_at, status, answer_by) values
  (tests.var('crew')::uuid, tests.uid('alice'), 'Stammtisch',
   ((tests.var('today')::date - 2) + time '20:00') at time zone 'Europe/Berlin',
   ((tests.var('today')::date - 2) + time '23:00') at time zone 'Europe/Berlin', 'confirmed',
   ((tests.var('today')::date - 4) + time '18:00') at time zone 'Europe/Berlin'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Ohne Frist',
   ((tests.var('today')::date - 3) + time '19:00') at time zone 'Europe/Berlin', null, 'confirmed', null);
insert into public.plan_participants (plan_id, user_id)
select p.id, m.user_id from public.plans p join public.crew_members m on m.crew_id = p.crew_id where p.crew_id = tests.var('crew')::uuid;
select tests.set_var('first', (select id::text from public.plans where title = 'Stammtisch'));
select tests.set_var('nodl', (select id::text from public.plans where title = 'Ohne Frist'));

select tests.login('alice');
select public.set_plan_repeat(tests.var('first')::uuid, 'weekly');
select public.set_plan_repeat(tests.var('nodl')::uuid, 'weekly');
select tests.set_var('series', (select series_id::text from public.plans where id = tests.var('first')::uuid));
select tests.set_var('series_nodl', (select series_id::text from public.plans where id = tests.var('nodl')::uuid));

-- „Regelmäßig“ legt die nächste Runde gleich an (der letzte Termin ist vorbei).
select tests.login('mallory');
select is(public.roll_plan_series(), 0, 'Mallory stößt keine fremde Serie an');
select tests.login('bob');
select is(public.roll_plan_series(), 0, 'danach ist nichts mehr fällig');
select tests.logout();
select tests.set_var('second', (select id::text from public.plans where series_id = tests.var('series')::uuid and id <> tests.var('first')::uuid));
select is((select starts_at from public.plans where id = tests.var('second')::uuid),
  ((tests.var('today')::date + 5) + time '20:00') at time zone 'Europe/Berlin', 'nächste Runde in 5 Tagen um 20:00');
select is((select answer_by from public.plans where id = tests.var('second')::uuid),
  ((tests.var('today')::date + 3) + time '18:00') at time zone 'Europe/Berlin', '… mit Frist zwei Tage vorher um 18:00 Berliner Zeit');
select is((select answer_by from public.plans where series_id = tests.var('series_nodl')::uuid and id <> tests.var('nodl')::uuid),
  null, 'Serie ohne Frist: neue Runde ohne Frist (unverändert)');

-- Die Frist der neuen Runde ist eine ganz normale: Erinnerung und Ändern von Hand funktionieren wie bisher.
select tests.login('alice');
select is(public.set_plan_answer_by(tests.var('second')::uuid, null), null, 'Alice entfernt die Frist an dieser Runde');
select tests.logout();
select is((select answer_by from public.plans where id = tests.var('second')::uuid), null, '… sie ist weg');
-- Bob kann die Frist nicht direkt schreiben (wie bisher).
select tests.login('bob');
select throws_ok(format('update public.plans set answer_by = now() + interval ''1 day'' where id = %L', tests.var('second')), '42501', null,
  'Bob schreibt answer_by nicht direkt');

-- ---- Aussetzen trägt die Frist weiter --------------------------------------------------------------
select tests.login('alice');
select public.set_plan_answer_by(tests.var('second')::uuid,
  ((tests.var('today')::date + 4) + time '12:00') at time zone 'Europe/Berlin');
select tests.set_var('skip', public.skip_plan_occurrence(tests.var('second')::uuid)::text);
select tests.logout();
select tests.set_var('third', tests.var('skip')::jsonb ->> 'next_plan_id');
select is((select starts_at from public.plans where id = tests.var('third')::uuid),
  ((tests.var('today')::date + 12) + time '20:00') at time zone 'Europe/Berlin', 'ausgesetzt: nächste Runde eine Woche später');
select is((select answer_by from public.plans where id = tests.var('third')::uuid),
  ((tests.var('today')::date + 11) + time '12:00') at time zone 'Europe/Berlin', '… mit dem Abstand der ausgesetzten Runde (1 Tag vorher, 12:00)');

-- Langer Abstand: 11 Tage vorher – die Frist der nächsten Runde liegt in 8 Tagen und wird übernommen.
select tests.login('alice');
select public.set_plan_answer_by(tests.var('third')::uuid,
  ((tests.var('today')::date + 1) + time '12:00') at time zone 'Europe/Berlin');
select tests.set_var('skip2', public.skip_plan_occurrence(tests.var('third')::uuid)::text);
select tests.logout();
select tests.set_var('fourth', tests.var('skip2')::jsonb ->> 'next_plan_id');
select is((select answer_by from public.plans where id = tests.var('fourth')::uuid),
  ((tests.var('today')::date + 8) + time '12:00') at time zone 'Europe/Berlin', '11 Tage vorher: Frist in 8 Tagen übernommen');

-- Zu knapp: Wäre der Abstand beim Anlegen schon verstrichen, bekommt die neue Runde keine Frist.
update public.plans set answer_by = starts_at - interval '30 days' where id = tests.var('fourth')::uuid;
select tests.login('alice');
select tests.set_var('skip3', public.skip_plan_occurrence(tests.var('fourth')::uuid)::text);
select tests.logout();
select is((select answer_by from public.plans where id = (tests.var('skip3')::jsonb ->> 'next_plan_id')::uuid), null,
  'Abstand schon verstrichen: neue Runde ohne Frist');

-- Mitgegebene Frist bleibt unangetastet (Trigger überschreibt nichts).
insert into public.plans (crew_id, created_by, series_id, title, starts_at, status, answer_by) values
  (tests.var('crew')::uuid, tests.uid('alice'), tests.var('series')::uuid, 'Mit eigener Frist',
   now() + interval '60 days', 'proposed', now() + interval '59 days');
select is((select answer_by from public.plans where title = 'Mit eigener Frist'),
  (select starts_at - interval '1 day' from public.plans where title = 'Mit eigener Frist'), 'eigene Frist beim Anlegen bleibt');

-- Plan ohne Serie: der Trigger tut nichts.
insert into public.plans (crew_id, created_by, title, starts_at, status) values
  (tests.var('crew')::uuid, tests.uid('alice'), 'Einzeln', now() + interval '10 days', 'proposed');
select is((select answer_by from public.plans where title = 'Einzeln'), null, 'Plan ohne Serie: keine Frist');

select * from finish();
rollback;
