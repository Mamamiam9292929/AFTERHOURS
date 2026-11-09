-- P30: „Fand’s statt?“ – Abend abschließen mit einem Tipp. `close_plan` schließt ab oder sagt still ab, nur
-- Organisator:in, Owner und Admins, erst ab Beginn. Danach fragt „Wie war’s?“ alle mit Zusage genau einmal –
-- auch die, deren Erinnerung am Morgen danach schon ohne die Frage kam. Die organisierende Person bekommt in
-- dieser Erinnerung bei offenen Plänen „Fand der Abend statt?“ (payload close).
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

-- Alle Abende vor zwei Tagen (der Morgen danach ist sicher vorbei, das Fenster von 3 Tagen offen) –
-- nur „Später“ beginnt erst in einer Stunde.
select tests.logout();
insert into public.plans (crew_id, created_by, title, starts_at, status, created_at) values
  (tests.var('crew')::uuid, tests.uid('alice'), 'Bowling', now() - interval '2 days', 'confirmed', now() - interval '5 days'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Quiz', now() - interval '2 days' + interval '1 minute', 'confirmed', now() - interval '5 days'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Kino', now() - interval '2 days' + interval '2 minutes', 'proposed', now() - interval '5 days'),
  (tests.var('crew')::uuid, tests.uid('bob'), 'Bobs Abend', now() - interval '2 days' + interval '3 minutes', 'confirmed', now() - interval '5 days'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Später', now() + interval '1 hour', 'confirmed', now() - interval '5 days'),
  (tests.var('mallory_crew')::uuid, tests.uid('mallory'), 'Fremder Abend', now() - interval '2 days', 'confirmed', now() - interval '5 days');
select tests.set_var(lower(title), id::text) from public.plans
  where title in ('Bowling', 'Quiz', 'Kino', 'Bobs Abend', 'Später', 'Fremder Abend');

-- Bowling und Quiz: Alice und Bob dabei, Carol „vielleicht“. Kino: nur Bob (Alice organisiert, ohne Zusage).
insert into public.plan_participants (plan_id, user_id, attendance_status) values
  (tests.var('bowling')::uuid, tests.uid('alice'), 'going'),
  (tests.var('bowling')::uuid, tests.uid('bob'), 'going'),
  (tests.var('bowling')::uuid, tests.uid('carol'), 'maybe'),
  (tests.var('quiz')::uuid, tests.uid('alice'), 'going'),
  (tests.var('quiz')::uuid, tests.uid('bob'), 'going'),
  (tests.var('quiz')::uuid, tests.uid('carol'), 'maybe'),
  (tests.var('kino')::uuid, tests.uid('bob'), 'going'),
  (tests.var('bobs abend')::uuid, tests.uid('bob'), 'going'),
  (tests.var('bobs abend')::uuid, tests.uid('carol'), 'going'),
  (tests.var('später')::uuid, tests.uid('alice'), 'going'),
  (tests.var('fremder abend')::uuid, tests.uid('mallory'), 'going');
insert into public.booking_requests (plan_id, created_by, requested_date, requested_time, party_size, status)
values (tests.var('kino')::uuid, tests.uid('alice'), (now() - interval '2 days')::date, '20:00', 2, 'not_started');
delete from public.notifications;

-- ---- Rechte --------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.close_plan(uuid, boolean)', 'execute'), 'anon darf nicht abschließen');
select ok(has_function_privilege('authenticated', 'public.close_plan(uuid, boolean)', 'execute'), 'angemeldete Personen dürfen es versuchen');
select ok(not has_column_privilege('authenticated', 'public.plan_photo_nudges', 'feedback_asked_at', 'select'), 'die Erinnerungsliste bleibt unlesbar');

select tests.login_anon();
select throws_ok($$ select public.close_plan(tests.var('quiz')::uuid, true) $$, '42501', null, 'ohne Konto: verboten');

select tests.login('mallory');
select throws_ok($$ select public.close_plan(tests.var('quiz')::uuid, true) $$, '42501', null, 'Außenstehende schließen nicht ab');
select throws_ok($$ select public.close_plan(tests.var('quiz')::uuid, false) $$, '42501', null, 'Außenstehende sagen nicht ab');
select throws_ok($$ select public.close_plan(gen_random_uuid(), true) $$, '42501', null, 'unbekannter Plan verrät nichts');

select tests.login('bob');
select throws_ok($$ select public.close_plan(tests.var('quiz')::uuid, true) $$, '42501', null, 'einfache Mitglieder schließen fremde Pläne nicht ab');
select throws_ok($$ select public.close_plan(tests.var('kino')::uuid, false) $$, '42501', null, 'einfache Mitglieder sagen fremde Pläne nicht ab');

select tests.login('alice');
select throws_ok($$ select public.close_plan(tests.var('später')::uuid, true) $$, 'P0001', 'plan_not_started', 'vor Beginn: nicht abschließen');
select throws_ok($$ select public.close_plan(tests.var('später')::uuid, false) $$, 'P0001', 'plan_not_started', 'vor Beginn: nicht über diesen Weg absagen');
select throws_ok($$ select public.close_plan(tests.var('quiz')::uuid, null) $$, 'P0001', 'invalid_input', 'ohne Antwort: ungültig');

select tests.logout();
select is((select count(*)::int from public.plans p where p.crew_id = tests.var('crew')::uuid and p.status in ('completed', 'cancelled')), 0,
          'bis hier hat sich nichts geändert');
select is((select count(*)::int from public.notifications), 0, 'und niemand wurde benachrichtigt');

-- ---- Bowling: Alice schließt ab – „Wie war’s?“ sofort an alle mit Zusage --------------------------
select tests.login('alice');
select is(public.close_plan(tests.var('bowling')::uuid, true), 'completed', 'Alice schließt Bowling mit einem Tipp ab');
select tests.logout();
select is((select status::text || ':' || (completed_at is not null) from public.plans where id = tests.var('bowling')::uuid), 'completed:true', 'Bowling ist abgeschlossen');
select is((select count(*)::int from public.reward_transactions t where t.user_id = tests.uid('alice') and t.reason = 'plan_organized'
           and t.related_entity_id = tests.var('bowling')::uuid), 1, 'Punkte fürs Organisieren wie beim Abschluss über „Organisieren“');
select is((select n.payload ->> 'feedback' || ':' || (n.payload ->> 'photos') || ':' || (n.payload ->> 'close') from public.notifications n
           where n.user_id = tests.uid('bob') and n.related_entity_id = tests.var('bowling')::uuid and n.type = 'plan_photo_nudge'),
          'true:true:false', 'Bob: „Wie war’s?“ und Fotos in einer Erinnerung');
select is((select count(*)::int from public.notifications n where n.user_id = tests.uid('alice') and n.related_entity_id = tests.var('bowling')::uuid and n.type = 'plan_photo_nudge'),
          0, 'Alice hat gerade selbst abgeschlossen – keine Erinnerung an sie');
select isnt((select r.feedback_asked_at from public.plan_photo_nudges r where r.plan_id = tests.var('bowling')::uuid and r.user_id = tests.uid('alice')),
            null, 'Alice gilt als gefragt');
select is((select count(*)::int from public.notifications n where n.user_id = tests.uid('carol') and n.type = 'plan_photo_nudge'
           and n.related_entity_id in (tests.var('bowling')::uuid, tests.var('quiz')::uuid)), 0, 'Carol („vielleicht“) bekommt nichts');

-- Derselbe Aufruf hat die übrigen fälligen Erinnerungen der Crew verschickt: offene Pläne fragen ihre
-- Organisator:in, ob der Abend stattfand.
select is((select n.payload ->> 'close' || ':' || (n.payload ->> 'photos') || ':' || (n.payload ->> 'feedback') from public.notifications n
           where n.user_id = tests.uid('alice') and n.related_entity_id = tests.var('quiz')::uuid and n.type = 'plan_photo_nudge'),
          'true:true:false', 'Quiz: Alice wird gefragt, ob der Abend stattfand (und nach Fotos)');
select is((select n.payload ->> 'close' || ':' || (n.payload ->> 'photos') from public.notifications n
           where n.user_id = tests.uid('alice') and n.related_entity_id = tests.var('kino')::uuid and n.type = 'plan_photo_nudge'),
          'true:false', 'Kino: Alice organisiert ohne Zusage – nur „Fand der Abend statt?“');
select is((select n.payload ->> 'close' from public.notifications n
           where n.user_id = tests.uid('bob') and n.related_entity_id = tests.var('quiz')::uuid and n.type = 'plan_photo_nudge'), 'false', 'Bob organisiert das Quiz nicht');
select is((select n.payload ->> 'close' from public.notifications n
           where n.user_id = tests.uid('bob') and n.related_entity_id = tests.var('bobs abend')::uuid and n.type = 'plan_photo_nudge'), 'true', 'Bob organisiert seinen Abend');
select is((select count(*)::int from public.notifications n where n.crew_id = tests.var('mallory_crew')::uuid), 0, 'nichts in fremden Crews');

-- ---- Quiz: Erinnerung kam schon ohne „Wie war’s?“ – nach dem Abschluss genau einmal nachgereicht ---
select tests.login('alice');
select is(public.close_plan(tests.var('quiz')::uuid, true), 'completed', 'Alice schließt das Quiz ab (aus der Erinnerung)');
select tests.logout();
select is((select n.payload ->> 'feedback' || ':' || (n.payload ->> 'photos') || ':' || (n.payload ->> 'close') from public.notifications n
           where n.user_id = tests.uid('bob') and n.related_entity_id = tests.var('quiz')::uuid and n.dedupe_key = 'plan_feedback_ask:' || tests.var('quiz')),
          'true:false:false', 'Bob bekommt „Wie war’s?“ nachgereicht – ohne Fotos, die kamen schon');
select is((select count(*)::int from public.notifications n where n.user_id = tests.uid('bob') and n.related_entity_id = tests.var('quiz')::uuid and n.type = 'plan_photo_nudge'), 2,
          'zwei Benachrichtigungen für Bob: Fotos am Morgen, „Wie war’s?“ nach dem Abschluss');
select is((select count(*)::int from public.notifications n where n.user_id = tests.uid('alice') and n.related_entity_id = tests.var('quiz')::uuid and n.type = 'plan_photo_nudge'), 1,
          'Alice (schließt ab) bekommt keine zweite');

select tests.login('alice');
select is(public.close_plan(tests.var('quiz')::uuid, true), 'completed', 'nochmal abschließen ist harmlos');
select tests.logout();
select is(app_private.send_plan_photo_nudges(tests.uid('alice'), now() + interval '1 hour'), 0, 'genau einmal – danach ist nichts mehr offen');
select is((select count(*)::int from public.notifications n where n.related_entity_id = tests.var('quiz')::uuid and n.type = 'plan_photo_nudge'), 3, 'keine weitere Benachrichtigung');
-- Zieht Bob ein Urteil zurück, fragt niemand erneut.
insert into public.plan_feedback (plan_id, user_id, verdict) values (tests.var('quiz')::uuid, tests.uid('bob'), 'again');
delete from public.plan_feedback where plan_id = tests.var('quiz')::uuid and user_id = tests.uid('bob');
select is(app_private.send_plan_photo_nudges(tests.uid('alice'), now() + interval '2 hours'), 0, 'zurückgezogenes Urteil: keine neue Frage');

-- ---- Kino: „Hat nicht stattgefunden“ – still abgesagt ---------------------------------------------
select tests.login('alice');
select is(public.close_plan(tests.var('kino')::uuid, false), 'cancelled', 'Alice: Kino hat nicht stattgefunden (aus „Vorschlag“)');
select is(public.close_plan(tests.var('kino')::uuid, false), 'cancelled', 'nochmal: harmlos');
select throws_ok($$ select public.close_plan(tests.var('kino')::uuid, true) $$, 'P0001', 'plan_locked', 'abgesagt lässt sich nicht mehr abschließen');
select throws_ok($$ select public.close_plan(tests.var('bowling')::uuid, false) $$, 'P0001', 'plan_locked', 'abgeschlossen lässt sich nicht mehr absagen');
select tests.logout();
select is((select status::text || ':' || (cancelled_at is not null) from public.plans where id = tests.var('kino')::uuid), 'cancelled:true', 'Kino ist abgesagt');
select is((select count(*)::int from public.notifications n where n.type = 'plan_cancelled'), 0, 'niemand bekommt eine Absage-Nachricht');
select is((select status::text from public.booking_requests where plan_id = tests.var('kino')::uuid), 'cancelled_by_user', 'offene Reservierungsanfrage ist mit abgesagt');
select is((select count(*)::int from public.reward_transactions t where t.related_entity_id = tests.var('kino')::uuid), 0, 'keine Punkte für einen Abend, der nicht stattfand');
select is((select meta ->> 'via' || ':' || (meta ->> 'to') from public.audit_log a where a.entity_id = tests.var('kino')::uuid and a.action = 'plan_status_changed'),
          'close_plan:cancelled', 'im Protokoll vermerkt');
select is(app_private.send_plan_photo_nudges(tests.uid('alice'), now() + interval '3 hours'), 0, 'abgesagter Plan: keine Erinnerung mehr');

-- ---- Owner schließt den Plan eines Mitglieds ab; Carol (Mitglied) darf es nicht --------------------
select tests.login('carol');
select throws_ok($$ select public.close_plan(tests.var('bobs abend')::uuid, true) $$, '42501', null, 'Carol (Mitglied, dabei) schließt Bobs Plan nicht ab');
select tests.login('alice');
select is(public.close_plan(tests.var('bobs abend')::uuid, true), 'completed', 'Alice als Owner schließt Bobs Abend ab');
select tests.logout();
select is((select count(*)::int from public.notifications n where n.related_entity_id = tests.var('bobs abend')::uuid and n.dedupe_key = 'plan_feedback_ask:' || tests.var('bobs abend')),
          2, 'Bob und Carol bekommen „Wie war’s?“ nachgereicht (ihre erste Erinnerung kam ohne)');
select is((select count(*)::int from public.notifications n
           where n.user_id = tests.uid('alice') and n.related_entity_id = tests.var('bobs abend')::uuid and n.type = 'plan_photo_nudge'), 0,
          'Alice (Owner, nicht dabei) wird nicht gefragt');

-- ---- Kontolöschung -------------------------------------------------------------------------------
select tests.logout();
delete from auth.users where id = tests.uid('bob');
select is((select count(*)::int from public.plan_photo_nudges r where r.user_id = tests.uid('bob')), 0, 'Kontolöschung entfernt die Erinnerungen');

select * from finish();
rollback;
