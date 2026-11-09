-- P29 Etappe 3: „Wie war’s?“ am Morgen danach – die Erinnerung aus P16 fragt bei abgeschlossenen Plänen
-- auch nach dem Urteil, in derselben einen Benachrichtigung. Sie kommt dann auch, wenn Fotos schon reichen,
-- aber nicht an Personen, die schon geantwortet haben, nicht an „vielleicht“, nicht bei offenen oder
-- abgesagten Plänen und nicht aus fremden Crews.
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

-- Freitag, 6. November 2026 (Berliner Winterzeit). Bowling und Kino sind am Abend selbst abgeschlossen,
-- Billard noch nicht, Quiz wird erst am Sonntag abgeschlossen.
select tests.logout();
insert into public.plans (crew_id, created_by, title, starts_at, status, completed_at, created_at) values
  (tests.var('crew')::uuid, tests.uid('alice'), 'Bowling', '2026-11-06 20:00+01', 'completed', '2026-11-06 23:30+01', '2026-11-01 12:00+01'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Kino', '2026-11-06 21:00+01', 'completed', '2026-11-06 23:45+01', '2026-11-01 12:00+01'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Billard', '2026-11-06 19:00+01', 'confirmed', null, '2026-11-01 12:00+01'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Quiz', '2026-11-06 18:00+01', 'confirmed', null, '2026-11-01 12:00+01'),
  (tests.var('mallory_crew')::uuid, tests.uid('mallory'), 'Fremder Abend', '2026-11-06 20:00+01', 'completed', '2026-11-06 23:00+01', '2026-11-01 12:00+01');
select tests.set_var(lower(title), id::text) from public.plans
  where title in ('Bowling', 'Kino', 'Billard', 'Quiz', 'Fremder Abend');

-- Bowling: Alice, Bob, Dave zugesagt, Carol „vielleicht“. Kino, Billard, Quiz: Alice und Bob.
insert into public.plan_participants (plan_id, user_id, attendance_status) values
  (tests.var('bowling')::uuid, tests.uid('alice'), 'going'),
  (tests.var('bowling')::uuid, tests.uid('bob'), 'going'),
  (tests.var('bowling')::uuid, tests.uid('carol'), 'maybe'),
  (tests.var('bowling')::uuid, tests.uid('dave'), 'going'),
  (tests.var('kino')::uuid, tests.uid('alice'), 'going'),
  (tests.var('kino')::uuid, tests.uid('bob'), 'going'),
  (tests.var('billard')::uuid, tests.uid('alice'), 'going'),
  (tests.var('billard')::uuid, tests.uid('bob'), 'going'),
  (tests.var('quiz')::uuid, tests.uid('alice'), 'going'),
  (tests.var('quiz')::uuid, tests.uid('bob'), 'going'),
  (tests.var('fremder abend')::uuid, tests.uid('mallory'), 'going');

-- Bowling hat schon zwei Fotos (Fotos reichen), Billard auch. Kino hat keine.
insert into public.plan_photos (id, plan_id, uploaded_by, path, width, height, uploaded_at)
select gen_random_uuid(), x.plan_id, x.user_id,
       tests.var('crew') || '/' || x.plan_id::text || '/' || gen_random_uuid()::text || '.webp', 1200, 900, '2026-11-06 23:00+01'
from (values (tests.var('bowling')::uuid, tests.uid('dave')),
             (tests.var('bowling')::uuid, tests.uid('dave')),
             (tests.var('billard')::uuid, tests.uid('alice')),
             (tests.var('billard')::uuid, tests.uid('alice'))) as x(plan_id, user_id);

-- Bob hat zum Bowling schon gesagt, wie es war (am Abend, als der Plan abgeschlossen war).
insert into public.plan_feedback (plan_id, user_id, verdict) values (tests.var('bowling')::uuid, tests.uid('bob'), 'again');
delete from public.notifications;

-- ---- Rechte bleiben wie in P16 -------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'app_private.send_plan_photo_nudges(uuid, timestamptz)', 'execute'), 'Erinnerungen mit eigener Uhrzeit bleiben gesperrt');
select ok(not has_function_privilege('anon', 'app_private.send_plan_photo_nudges(uuid, timestamptz)', 'execute'), 'anon kommt nicht an die interne Funktion');
select ok(not has_table_privilege('authenticated', 'public.plan_feedback', 'select'), 'Urteile bleiben unlesbar');
select tests.login_anon();
select throws_ok($$ select public.send_plan_photo_nudges() $$, '42501', null, 'anon kann nichts anstoßen');

-- ---- Vor 10 Uhr nichts ---------------------------------------------------------------------------
select tests.logout();
select is(app_private.send_plan_photo_nudges(tests.uid('alice'), '2026-11-07 09:59+01'), 0, 'vor 10 Uhr am Morgen danach: nichts');

-- ---- Samstag 10 Uhr ------------------------------------------------------------------------------
select is(app_private.send_plan_photo_nudges(tests.uid('carol'), '2026-11-07 10:00+01'), 6,
          'Bowling an Alice und Dave (nur „Wie war’s?“), Kino an Alice und Bob (beides), Quiz an Alice und Bob (nur Fotos)');

select is((select array_agg(r.user_id order by r.user_id) from public.plan_photo_nudges r where r.plan_id = tests.var('bowling')::uuid),
          (select array_agg(u order by u) from unnest(array[tests.uid('alice'), tests.uid('dave')]) u),
          'Bowling: Fotos reichen, trotzdem an alle mit Zusage ohne Urteil – nicht Bob (hat geantwortet), nicht Carol („vielleicht“)');
select is((select n.payload ->> 'feedback' || ':' || (n.payload ->> 'photos') from public.notifications n
           where n.user_id = tests.uid('dave') and n.related_entity_id = tests.var('bowling')::uuid and n.type = 'plan_photo_nudge'),
          'true:false', 'Dave (eigene Fotos geteilt): nur „Wie war’s?“');
select is((select n.payload ->> 'feedback' || ':' || (n.payload ->> 'photos') from public.notifications n
           where n.user_id = tests.uid('alice') and n.related_entity_id = tests.var('bowling')::uuid and n.type = 'plan_photo_nudge'),
          'true:false', 'Alice beim Bowling: schon zwei Fotos, nur „Wie war’s?“');
select is((select n.payload ->> 'feedback' || ':' || (n.payload ->> 'photos') from public.notifications n
           where n.user_id = tests.uid('bob') and n.related_entity_id = tests.var('kino')::uuid and n.type = 'plan_photo_nudge'),
          'true:true', 'Kino: Fotos und „Wie war’s?“ in einer Benachrichtigung');
select is((select count(*)::int from public.notifications n where n.user_id = tests.uid('bob') and n.related_entity_id = tests.var('kino')::uuid),
          1, 'genau eine Benachrichtigung, keine zweite fürs Urteil');
select is((select n.payload ->> 'yesterday' from public.notifications n
           where n.user_id = tests.uid('bob') and n.related_entity_id = tests.var('kino')::uuid), 'true', 'weiterhin als „gestern“ gekennzeichnet');
select is((select count(*)::int from public.plan_photo_nudges r where r.plan_id = tests.var('billard')::uuid), 0,
          'Billard: nicht abgeschlossen und Fotos reichen – keine Erinnerung');
select is((select count(*)::int from public.plan_photo_nudges r where r.plan_id = tests.var('quiz')::uuid), 2,
          'Quiz: nicht abgeschlossen, keine Fotos – Fotos-Erinnerung wie bisher');
select is((select n.payload ->> 'feedback' || ':' || (n.payload ->> 'photos') from public.notifications n
           where n.user_id = tests.uid('alice') and n.related_entity_id = tests.var('quiz')::uuid), 'false:true',
          'Quiz: ohne „Wie war’s?“, solange nicht abgeschlossen');
select is((select count(*)::int from public.notifications n where n.crew_id = tests.var('mallory_crew')::uuid), 0,
          'Carols Aufruf löst nichts in fremden Crews aus');
select is((select count(*)::int from public.notifications n where n.user_id = tests.uid('mallory')), 0, 'Mallory bekommt nichts');
select is((select count(*)::int from public.notifications n where n.user_id = tests.uid('carol')), 0, 'Carol („vielleicht“) bekommt nichts');

-- Genau einmal.
select is(app_private.send_plan_photo_nudges(tests.uid('alice'), '2026-11-07 12:00+01'), 0, 'zweiter Aufruf: nichts mehr');

-- ---- Billard wird am Sonntag abgeschlossen: jetzt kommt „Wie war’s?“ ---------------------------
update public.plans set status = 'completed', completed_at = '2026-11-08 11:00+01' where id = tests.var('billard')::uuid;
-- Bob hat inzwischen geantwortet (ging erst nach dem Abschluss).
insert into public.plan_feedback (plan_id, user_id, verdict) values (tests.var('billard')::uuid, tests.uid('bob'), 'ok');
select is(app_private.send_plan_photo_nudges(tests.uid('bob'), '2026-11-08 12:00+01'), 1, 'Billard nach dem Abschluss: nur an Alice');
select is((select n.payload ->> 'feedback' || ':' || (n.payload ->> 'photos') || ':' || (n.payload ->> 'yesterday') from public.notifications n
           where n.user_id = tests.uid('alice') and n.related_entity_id = tests.var('billard')::uuid), 'true:false:false',
          'Billard: nur „Wie war’s?“, nicht mehr „gestern“');

-- ---- Fenster von 3 Tagen bleibt -----------------------------------------------------------------
update public.plans set status = 'completed', completed_at = '2026-11-09 22:00+01' where id = tests.var('quiz')::uuid;
delete from public.plan_photo_nudges where plan_id = tests.var('quiz')::uuid;
select is(app_private.send_plan_photo_nudges(tests.uid('alice'), '2026-11-09 22:30+01'), 0, 'mehr als 3 Tage nach dem Abend: nichts mehr');

-- ---- Die App stößt an (öffentliche Funktion) ----------------------------------------------------
select tests.login('mallory');
select lives_ok($$ select public.send_plan_photo_nudges() $$, 'Mallory stößt mit echter Uhrzeit an, ohne Fehler');
select tests.logout();
select is((select count(*)::int from public.notifications n where n.user_id = tests.uid('mallory') and n.crew_id = tests.var('crew')::uuid), 0,
          'Mallory bekommt nichts aus fremden Crews');

select * from finish();
rollback;
