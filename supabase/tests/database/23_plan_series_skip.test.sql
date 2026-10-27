-- P8 Etappe 2: Stammtisch – der nächste Termin steht eine Woche vorher in der App (nicht früher), und wer den
-- Plan verwaltet, setzt einen Termin aus, ohne die Serie zu beenden. Außenstehende und einfache Mitglieder nicht.
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
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Bob tritt bei');
select tests.login('mallory');
select tests.set_var('mallory_crew', public.create_crew('Andere Crew', '🎲')::text);

-- Stammtisch alle zwei Wochen, letzter Termin vorgestern um 20:00 Berliner Zeit; dazu ein einzelner Plan.
select tests.logout();
select tests.set_var('today', ((now() at time zone 'Europe/Berlin')::date)::text);
insert into public.plans (crew_id, created_by, title, starts_at, ends_at, status) values
  (tests.var('crew')::uuid, tests.uid('alice'), 'Stammtisch',
   ((tests.var('today')::date - 2) + time '20:00') at time zone 'Europe/Berlin',
   ((tests.var('today')::date - 2) + time '23:00') at time zone 'Europe/Berlin', 'confirmed'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Einzelner Abend', now() + interval '3 days', null, 'confirmed');
insert into public.plan_participants (plan_id, user_id)
select p.id, m.user_id from public.plans p join public.crew_members m on m.crew_id = p.crew_id where p.crew_id = tests.var('crew')::uuid;
select tests.set_var('first', (select id::text from public.plans where title = 'Stammtisch'));
select tests.set_var('single', (select id::text from public.plans where title = 'Einzelner Abend'));

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.skip_plan_occurrence(uuid)', 'execute'), 'anon setzt nichts aus');
select ok(has_function_privilege('authenticated', 'public.skip_plan_occurrence(uuid)', 'execute'), 'angemeldete Nutzer rufen die RPC auf (Prüfung darin)');
select ok(not has_function_privilege('authenticated', 'app_private.roll_plan_series(uuid)', 'execute'), 'roll_plan_series(uuid) bleibt intern');
select ok(not has_column_privilege('authenticated', 'public.plans', 'skipped_at', 'update'), 'skipped_at ist nicht direkt schreibbar');

-- ---- Früher Bescheid: eine Woche vorher, nicht früher -----------------------------------------------
select tests.login('alice');
select is(public.set_plan_repeat(tests.var('first')::uuid, 'biweekly') ->> 'next_on', (tests.var('today')::date + 12)::text,
  'alle zwei Wochen: nächster Termin in 12 Tagen');
select tests.set_var('series', (select series_id::text from public.plans where id = tests.var('first')::uuid));
select is((select count(*)::int from public.plans where series_id = tests.var('series')::uuid), 1, 'in 12 Tagen: noch kein Termin angelegt');
select tests.login('bob');
select is(public.roll_plan_series(), 0, 'Bob öffnet die App 12 Tage vorher: nichts fällig');

-- Sechs Tage später: der nächste Termin ist sechs Tage entfernt.
select tests.logout();
-- In Berliner Ortszeit verschieben: Ein Abzug in UTC rutscht über die Zeitumstellung hinweg um eine Stunde
-- (20:00 MEZ minus 6 × 24 h = 21:00 MESZ), und die Serie übernimmt die Uhrzeit vom letzten Termin.
update public.plans set
  starts_at = ((starts_at at time zone 'Europe/Berlin') - interval '6 days') at time zone 'Europe/Berlin',
  ends_at = ((ends_at at time zone 'Europe/Berlin') - interval '6 days') at time zone 'Europe/Berlin'
where id = tests.var('first')::uuid;
update public.plan_series set last_on = last_on - 6 where id = tests.var('series')::uuid;
delete from public.notifications;
select tests.login('mallory');
select is(public.roll_plan_series(), 0, 'Mallory stößt keine fremde Serie an');
select tests.login('bob');
select is(public.roll_plan_series(), 1, 'sechs Tage vorher: der nächste Termin steht da');
select is(public.roll_plan_series(), 0, 'zweiter Aufruf: nichts mehr fällig');
select tests.logout();
select tests.set_var('second', (select id::text from public.plans where series_id = tests.var('series')::uuid and id <> tests.var('first')::uuid));
select is((select starts_at from public.plans where id = tests.var('second')::uuid),
  ((tests.var('today')::date + 6) + time '20:00') at time zone 'Europe/Berlin', 'Termin in 6 Tagen um 20:00 Berliner Zeit');
select is((select count(*)::int from public.notifications where type = 'plan_created' and related_entity_id = tests.var('second')::uuid), 2,
  'Alice und Bob werden eine Woche vorher gefragt');

-- ---- Diesmal aussetzen: Angriffe und Eingaben ------------------------------------------------------
select tests.login_anon();
select throws_ok(format('select public.skip_plan_occurrence(%L)', tests.var('second')), '42501', null, 'anon: abgewiesen');
select tests.login('mallory');
select throws_ok(format('select public.skip_plan_occurrence(%L)', tests.var('second')), '42501', null, 'Mallory (nicht in der Crew) setzt nichts aus');
select throws_ok(format('select public.skip_plan_occurrence(%L)', gen_random_uuid()), '42501', null, 'unbekannter Plan: gleiche Antwort');
select tests.login('bob');
select throws_ok(format('select public.skip_plan_occurrence(%L)', tests.var('second')), '42501', null, 'Bob (Mitglied, nicht Organisator) setzt nichts aus');
select throws_ok(format('update public.plans set skipped_at = now() where id = %L', tests.var('second')), '42501', null, 'Bob schreibt skipped_at nicht direkt');
select tests.login('alice');
select throws_ok(format('select public.skip_plan_occurrence(%L)', tests.var('single')), 'P0001', 'series_not_active', 'Plan ohne Serie: nichts auszusetzen');
select throws_ok(format('select public.skip_plan_occurrence(%L)', tests.var('first')), 'P0001', 'skip_too_late', 'vergangener Termin: zu spät');
select tests.logout();
select is((select status::text from public.plans where id = tests.var('second')::uuid), 'proposed', 'nach allen Versuchen: Termin unverändert');

-- ---- Diesmal aussetzen ---------------------------------------------------------------------------
delete from public.notifications;
select tests.login('alice');
select tests.set_var('skip', public.skip_plan_occurrence(tests.var('second')::uuid)::text);
select tests.logout();
select is((select status::text from public.plans where id = tests.var('second')::uuid), 'cancelled', 'Termin ist abgesagt');
select ok((select skipped_at is not null and cancelled_at is not null from public.plans where id = tests.var('second')::uuid), '… als „ausgesetzt“ markiert');
select ok((select active from public.plan_series where id = tests.var('series')::uuid), 'die Serie läuft weiter');
select tests.set_var('third', tests.var('skip')::jsonb ->> 'next_plan_id');
select isnt(tests.var('third'), null, 'Antwort nennt den nächsten Termin');
select is((select starts_at from public.plans where id = tests.var('third')::uuid),
  ((tests.var('today')::date + 20) + time '20:00') at time zone 'Europe/Berlin', 'der nächste steht sofort da – zwei Wochen später, auch wenn das mehr als 7 Tage sind');
select is((tests.var('skip')::jsonb ->> 'next_starts_at')::timestamptz, (select starts_at from public.plans where id = tests.var('third')::uuid), 'Antwort nennt seine Zeit');
select is((select status::text from public.plans where id = tests.var('third')::uuid), 'proposed', 'neuer Termin ist ein Vorschlag');
select is((select count(*)::int from public.plans where series_id = tests.var('series')::uuid and status <> 'cancelled' and starts_at > now()), 1,
  'genau ein anstehender Termin');
select is((select count(*)::int from public.notifications where type = 'plan_cancelled' and related_entity_id = tests.var('second')::uuid
           and user_id = tests.uid('bob') and (payload ->> 'skipped')::boolean and payload ->> 'next_starts_at' is not null), 1,
  'Bob erfährt: diesmal ausgesetzt, mit nächstem Termin');
select is((select count(*)::int from public.notifications where type = 'plan_cancelled' and user_id = tests.uid('alice')), 0, 'Alice benachrichtigt sich nicht selbst');
select is((select count(*)::int from public.notifications where user_id = tests.uid('mallory')), 0, 'Mallory erfährt nichts');
select is((select count(*)::int from public.audit_log where action = 'plan_occurrence_skipped' and entity_id = tests.var('second')::uuid), 1, 'Audit-Eintrag');

select tests.login('alice');
select throws_ok(format('select public.skip_plan_occurrence(%L)', tests.var('second')), 'P0001', 'plan_locked', 'zweimal aussetzen geht nicht');
select tests.login('bob');
select is(public.roll_plan_series(), 0, 'danach ist nichts mehr fällig');

-- ---- Owner/Admin dürfen auch Termine fremder Pläne aussetzen; beendete Serien nicht ----------------
select tests.logout();
update public.plans set created_by = tests.uid('bob') where id = tests.var('third')::uuid;
select tests.login('alice');
select ok((public.skip_plan_occurrence(tests.var('third')::uuid) ->> 'next_plan_id') is not null, 'Owner setzt Bobs Termin aus, die Serie geht weiter');
select tests.set_var('fourth', (select id::text from public.plans where series_id = tests.var('series')::uuid and status <> 'cancelled' and starts_at > now()));
select ok((public.set_plan_repeat(tests.var('fourth')::uuid, 'none') ->> 'active')::boolean is false, 'Serie beenden');
select throws_ok(format('select public.skip_plan_occurrence(%L)', tests.var('fourth')), 'P0001', 'series_not_active', 'beendete Serie: nichts auszusetzen');

-- ---- Rate Limit ----------------------------------------------------------------------------------
select is(public.set_plan_repeat(tests.var('fourth')::uuid, 'biweekly') ->> 'active', 'true', 'Serie wieder eingeschaltet');
select tests.logout();
insert into public.rate_limit_hits (user_id, action) select tests.uid('alice'), 'plan_series' from generate_series(1, 30);
select tests.login('alice');
select throws_ok(format('select public.skip_plan_occurrence(%L)', tests.var('fourth')), 'P0001', 'rate_limited', 'skip_plan_occurrence: Rate Limit');

select * from finish();
rollback;
