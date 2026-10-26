-- P8 Etappe 1: Wiederkehrende Pläne – nur wer den Plan verwaltet, stellt die Wiederholung ein; der Server
-- legt den nächsten Termin erst an, wenn der letzte begonnen hat, genau einmal, ohne Zusage für irgendwen.
begin;
\ir helpers.inc
select no_plan();

grant usage on schema tests to service_role;
grant select, insert, update on tests.vars to service_role;
grant select on tests.users to service_role;

create function tests.login_service() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('role', 'service_role', true);
end $$;

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Mallory');

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew', '🎳')::text);
select tests.set_var('invite', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Bob tritt bei');
select tests.login('mallory');
select tests.set_var('mallory_crew', public.create_crew('Andere Crew', '🎲')::text);

-- Stammtisch: in 3 Tagen um 20:00 Berliner Zeit, drei Stunden lang. Direkt angelegt (am RLS vorbei).
select tests.logout();
select tests.set_var('day', ((now() at time zone 'Europe/Berlin')::date + 3)::text);
insert into public.plans (crew_id, created_by, title, starts_at, ends_at, address, meeting_point, notes,
                          estimated_cost_per_person_cents, status)
values (tests.var('crew')::uuid, tests.uid('alice'), 'Stammtisch',
        (tests.var('day')::date + time '20:00') at time zone 'Europe/Berlin',
        (tests.var('day')::date + time '23:00') at time zone 'Europe/Berlin',
        'Karl-Liebknecht-Str. 1', 'Am Tresen', 'Wer zuerst da ist, hält Plätze frei.', 1500, 'confirmed'),
       (tests.var('crew')::uuid, tests.uid('alice'), 'Abgesagt', now() + interval '5 days', null, null, null, null, null, 'cancelled');
insert into public.plan_participants (plan_id, user_id, attendance_status, responded_at)
select p.id, m.user_id, 'going', now() from public.plans p join public.crew_members m on m.crew_id = p.crew_id where p.title = 'Stammtisch';
select tests.set_var('plan', (select id::text from public.plans where title = 'Stammtisch'));
select tests.set_var('cancelled', (select id::text from public.plans where title = 'Abgesagt'));

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.set_plan_repeat(uuid, text)', 'execute'), 'anon stellt keine Wiederholung ein');
select ok(not has_function_privilege('anon', 'public.roll_plan_series()', 'execute'), 'anon legt keine Termine an');
select ok(not has_function_privilege('authenticated', 'app_private.roll_plan_series(uuid)', 'execute'), 'Nutzer rollen keine fremde Serie direkt');
select ok(not has_function_privilege('authenticated', 'app_private.roll_due_plan_series()', 'execute'), 'Nutzer starten den Cron-Lauf nicht');
select ok(has_function_privilege('service_role', 'app_private.roll_due_plan_series()', 'execute'), 'service_role (pg_cron) darf fällige Serien anlegen');
select ok(not has_table_privilege('authenticated', 'public.plan_series', 'insert'), 'Serien sind nicht direkt schreibbar (insert)');
select ok(not has_table_privilege('authenticated', 'public.plan_series', 'update'), 'Serien sind nicht direkt schreibbar (update)');
select ok(not has_table_privilege('anon', 'public.plan_series', 'select'), 'anon liest keine Serien');

select tests.login_anon();
select throws_ok(format('select public.set_plan_repeat(%L, %L)', tests.var('plan'), 'weekly'), '42501', null, 'anon: abgewiesen');

-- ---- Regel: nächster Kalendertag -----------------------------------------------------------------
select tests.logout();
select is(app_private.plan_series_next_on('weekly', 5, null, '2026-10-23'), '2026-10-30'::date, 'jede Woche: +7 Tage');
select is(app_private.plan_series_next_on('biweekly', 5, null, '2026-10-23'), '2026-11-06'::date, 'alle 2 Wochen: +14 Tage');
select is(app_private.plan_series_next_on('monthly_nth', 5, 1, '2026-11-06'), '2026-12-04'::date, '1. Freitag: Dezember');
select is(app_private.plan_series_next_on('monthly_nth', 5, 1, '2026-10-23'), '2026-11-06'::date, '1. Freitag: nach dem 23. Oktober kommt der 6. November');
select is(app_private.plan_series_next_on('monthly_nth', 3, 3, '2026-12-16'), '2027-01-20'::date, '3. Mittwoch über den Jahreswechsel');
select is(app_private.plan_series_next_on('monthly_last', 5, null, '2026-10-30'), '2026-11-27'::date, 'letzter Freitag im November');
select is(app_private.plan_series_next_on('monthly_last', 7, null, '2027-01-31'), '2027-02-28'::date, 'letzter Sonntag im Februar');

-- ---- Angriff: Außenstehende und Mitglieder ohne Verwaltungsrecht ----------------------------------
select tests.login('mallory');
select throws_ok(format('select public.set_plan_repeat(%L, %L)', tests.var('plan'), 'weekly'), '42501', null, 'Mallory (nicht in der Crew) stellt keine Wiederholung ein');
select throws_ok(format('select public.set_plan_repeat(%L, %L)', gen_random_uuid(), 'weekly'), '42501', null, 'unbekannter Plan: gleiche Antwort');
select tests.login('bob');
select throws_ok(format('select public.set_plan_repeat(%L, %L)', tests.var('plan'), 'weekly'), '42501', null, 'Bob (Mitglied, nicht Organisator) stellt keine Wiederholung ein');

-- ---- Eingaben ------------------------------------------------------------------------------------
select tests.login('alice');
select throws_ok(format('select public.set_plan_repeat(%L, %L)', tests.var('plan'), 'daily'), 'P0001', 'invalid_repeat_rule', 'unbekannte Regel: abgelehnt');
select throws_ok(format('select public.set_plan_repeat(%L, %L)', tests.var('cancelled'), 'weekly'), 'P0001', 'plan_locked', 'abgesagter Plan wiederholt sich nicht');
select is(public.set_plan_repeat(tests.var('plan')::uuid, null), null, 'ohne Serie: „nicht wiederholen“ ändert nichts');

-- ---- Wiederholung einstellen ---------------------------------------------------------------------
select tests.set_var('series_json', public.set_plan_repeat(tests.var('plan')::uuid, 'weekly')::text);
select is(tests.var('series_json')::jsonb ->> 'rule', 'weekly', 'Regel gespeichert');
select is(tests.var('series_json')::jsonb ->> 'last_on', tests.var('day'), 'Serie beginnt mit dem Tag des Plans');
select is(tests.var('series_json')::jsonb ->> 'next_on', (tests.var('day')::date + 7)::text, 'nächster Termin eine Woche später');
select is((tests.var('series_json')::jsonb ->> 'weekday')::int, extract(isodow from tests.var('day')::date)::int, 'Wochentag aus dem Plan');
select tests.set_var('series', tests.var('series_json')::jsonb ->> 'id');
select is((select series_id::text from public.plans where id = tests.var('plan')::uuid), tests.var('series'), 'Plan gehört zur Serie');
select is((select count(*)::int from public.plans where series_id = tests.var('series')::uuid), 1, 'solange der Termin ansteht, entsteht kein zweiter');
select is(public.roll_plan_series(), 0, 'roll_plan_series: nichts fällig');

-- Die Crew liest die Serie, Außenstehende nicht.
select tests.login('bob');
select is((select rule from public.plan_series where id = tests.var('series')::uuid), 'weekly', 'Bob (Mitglied) sieht die Serie');
select tests.login('mallory');
select is((select count(*)::int from public.plan_series), 0, 'Mallory sieht keine Serie');
select throws_ok(format('update public.plan_series set active = false where id = %L', tests.var('series')), '42501', null, 'Mallory ändert keine Serie direkt');
select tests.login('bob');
select throws_ok(format('update public.plan_series set rule = %L where id = %L', 'biweekly', tests.var('series')), '42501', null, 'auch Mitglieder ändern Serien nur über die RPC');

-- ---- Monatliche Regeln am Kalender des Plans ------------------------------------------------------
select tests.logout();
insert into public.plans (crew_id, created_by, title, starts_at, status) values
  (tests.var('crew')::uuid, tests.uid('alice'), 'Am 29.', ('2027-01-29'::date + time '19:00') at time zone 'Europe/Berlin', 'confirmed'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Am 8.', ('2027-01-08'::date + time '19:00') at time zone 'Europe/Berlin', 'confirmed');
select tests.login('alice');
select throws_ok(format('select public.set_plan_repeat(%L, %L)', (select id from public.plans where title = 'Am 29.'), 'monthly_nth'),
  'P0001', 'repeat_no_nth', 'am 29. gibt es keinen „5. Freitag“ jeden Monat');
select throws_ok(format('select public.set_plan_repeat(%L, %L)', (select id from public.plans where title = 'Am 8.'), 'monthly_last'),
  'P0001', 'repeat_not_last_week', '„letzter Freitag“ nur in der letzten Woche des Monats');
select is((public.set_plan_repeat((select id from public.plans where title = 'Am 8.'), 'monthly_nth') ->> 'next_on'), '2027-02-12',
  '8. Januar 2027 = 2. Freitag → 12. Februar');
select is((public.set_plan_repeat((select id from public.plans where title = 'Am 29.'), 'monthly_last') ->> 'next_on'), '2027-02-26',
  '29. Januar 2027 = letzter Freitag → 26. Februar');
select is((select count(*)::int from public.plan_series where crew_id = tests.var('crew')::uuid), 3, 'je Plan eine eigene Serie');

-- ---- Der Termin liegt zurück: der nächste entsteht genau einmal -----------------------------------
-- Zeit vergehen lassen: Termin und Serie zwei Wochen zurück. Der Termin vor einer Woche wurde verpasst
-- (niemand hat die App geöffnet) und wird übersprungen. Zurückgesetzt wird in Berliner Ortszeit – zwei Wochen
-- als feste 336 Stunden verschieben die Uhrzeit, wenn dazwischen die Zeitumstellung liegt (20:00 würde 21:00).
select tests.logout();
create function tests.berlin_minus(ts timestamptz, days int) returns timestamptz
language sql immutable as $$ select ((ts at time zone 'Europe/Berlin') - make_interval(days => days)) at time zone 'Europe/Berlin' $$;
update public.plans set starts_at = tests.berlin_minus(starts_at, 14), ends_at = tests.berlin_minus(ends_at, 14) where id = tests.var('plan')::uuid;
update public.plan_series set last_on = last_on - 14 where id = tests.var('series')::uuid;
delete from public.notifications;

select tests.login('mallory');
select is(public.roll_plan_series(), 0, 'Mallory stößt keine fremde Serie an');
select tests.logout();
select is((select count(*)::int from public.plans where series_id = tests.var('series')::uuid), 1, '… und es entsteht nichts');

select tests.login('bob');
select is(public.roll_plan_series(), 1, 'Bob (Mitglied) öffnet die App: ein neuer Termin');
select is(public.roll_plan_series(), 0, 'zweiter Aufruf: nichts mehr fällig');
select tests.logout();
select tests.set_var('next', (select id::text from public.plans where series_id = tests.var('series')::uuid and id <> tests.var('plan')::uuid));
select is((select count(*)::int from public.plans where series_id = tests.var('series')::uuid), 2, 'genau ein neuer Termin – der verpasste fehlt');
select is((select starts_at from public.plans where id = tests.var('next')::uuid),
  (tests.var('day')::date + time '20:00') at time zone 'Europe/Berlin', 'nächster anstehender Termin: in 3 Tagen um 20:00 Berliner Zeit');
select is((select (starts_at at time zone 'Europe/Berlin')::time from public.plans where id = tests.var('next')::uuid), '20:00'::time,
  'Uhrzeit bleibt in Berliner Zeit (auch über die Zeitumstellung)');
select is((select ends_at - starts_at from public.plans where id = tests.var('next')::uuid), interval '3 hours', 'Dauer übernommen');
select is((select row(title, address, meeting_point, notes, estimated_cost_per_person_cents)::text from public.plans where id = tests.var('next')::uuid),
  row('Stammtisch', 'Karl-Liebknecht-Str. 1', 'Am Tresen', 'Wer zuerst da ist, hält Plätze frei.', 1500)::text, 'Titel, Adresse, Treffpunkt, Notizen, Kosten übernommen');
select is((select status::text from public.plans where id = tests.var('next')::uuid), 'proposed', 'neuer Termin ist ein Vorschlag');
select is((select created_by from public.plans where id = tests.var('next')::uuid), tests.uid('alice'), 'Alice bleibt Organisatorin');
select is((select count(*)::int from public.plan_participants where plan_id = tests.var('next')::uuid and attendance_status = 'invited'), 2,
  'alle Mitglieder eingeladen – niemand automatisch zugesagt');
select is((select last_on from public.plan_series where id = tests.var('series')::uuid), tests.var('day')::date, 'Serie merkt sich den neuen Termin');
select is((select count(*)::int from public.notifications where type = 'plan_created' and related_entity_id = tests.var('next')::uuid
           and (payload ->> 'repeat')::boolean and actor_id is null), 2, 'Alice und Bob werden benachrichtigt (ohne auslösende Person)');
select is((select count(*)::int from public.notifications where user_id = tests.uid('mallory')), 0, 'Mallory erfährt nichts');
select is((select count(*)::int from public.audit_log where action = 'plan_series_rolled' and entity_id = tests.var('next')::uuid), 1, 'Audit-Eintrag');

-- ---- Bearbeiten des letzten Termins ändert die folgenden ------------------------------------------
select tests.logout();
update public.plans set title = 'Stammtisch im Hof', starts_at = tests.berlin_minus(starts_at, 14) + interval '30 minutes', ends_at = null
where id = tests.var('next')::uuid;
update public.plan_series set last_on = last_on - 14 where id = tests.var('series')::uuid;
select tests.login_service();
select is(app_private.roll_due_plan_series(), 1, 'pg_cron/service_role legt den fälligen Termin an');
select tests.logout();
select is((select title from public.plans where series_id = tests.var('series')::uuid order by starts_at desc limit 1), 'Stammtisch im Hof', 'Titel vom letzten Termin');
select is((select (starts_at at time zone 'Europe/Berlin')::time from public.plans where series_id = tests.var('series')::uuid order by starts_at desc limit 1),
  '20:30'::time, 'Uhrzeit vom letzten Termin');
select is((select ends_at from public.plans where series_id = tests.var('series')::uuid order by starts_at desc limit 1), null, 'ohne Ende bleibt das Ende offen');

-- ---- Regel ändern und beenden --------------------------------------------------------------------
select tests.login('alice');
select is(public.set_plan_repeat(tests.var('plan')::uuid, 'biweekly') ->> 'rule', 'biweekly', 'Regel lässt sich an jedem Termin der Serie ändern');
select is((select last_on from public.plan_series where id = tests.var('series')::uuid),
  (select (max(starts_at) at time zone 'Europe/Berlin')::date from public.plans where series_id = tests.var('series')::uuid), 'Regel richtet sich am letzten Termin aus');
select ok((public.set_plan_repeat(tests.var('plan')::uuid, 'none') ->> 'active')::boolean is false, '„Nicht mehr wiederholen“ beendet die Serie');
select tests.logout();
update public.plans set starts_at = now() - interval '1 hour', ends_at = null where series_id = tests.var('series')::uuid;
select tests.login('bob');
select is(public.roll_plan_series(), 0, 'beendete Serie legt nichts mehr an');
select tests.login('alice');
select is(public.set_plan_repeat(tests.var('plan')::uuid, 'weekly') ->> 'active', 'true', 'wieder einschalten …');
select tests.logout();
select is((select count(*)::int from public.plans where series_id = tests.var('series')::uuid and starts_at > now()), 1, '… legt sofort den nächsten Termin an, wenn der letzte vorbei ist');

-- ---- Grenze: höchstens 10 aktive Serien je Crew ----------------------------------------------------
select tests.logout();
insert into public.plan_series (crew_id, created_by, rule, weekday, last_on)
select tests.var('crew')::uuid, tests.uid('alice'), 'weekly', 1, current_date from generate_series(1, 7);
insert into public.plans (crew_id, created_by, title, starts_at, status)
values (tests.var('crew')::uuid, tests.uid('alice'), 'Elfte Serie', now() + interval '4 days', 'confirmed');
select tests.login('alice');
select throws_ok(format('select public.set_plan_repeat(%L, %L)', (select id from public.plans where title = 'Elfte Serie'), 'weekly'),
  'P0001', 'too_many_series', 'elfte aktive Serie: abgelehnt');

-- ---- Owner/Admin dürfen auch fremde Pläne verwalten -------------------------------------------------
select tests.logout();
insert into public.plans (crew_id, created_by, title, starts_at, status)
values (tests.var('crew')::uuid, tests.uid('bob'), 'Bobs Abend', now() + interval '6 days', 'confirmed');
select tests.login('alice');
select ok(public.set_plan_repeat((select id from public.plans where title = 'Bobs Abend'), 'none') is null, 'Owner darf Bobs Plan verwalten');

-- ---- Rate Limit ----------------------------------------------------------------------------------
select tests.logout();
insert into public.rate_limit_hits (user_id, action) select tests.uid('bob'), 'plan_series_roll' from generate_series(1, 120);
select tests.login('bob');
select throws_ok('select public.roll_plan_series()', 'P0001', 'rate_limited', 'roll_plan_series: Rate Limit');

select * from finish();
rollback;
