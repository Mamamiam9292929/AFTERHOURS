-- P29 Etappe 3: Am Morgen danach fragt die eine Benachrichtigung (P16) auch „Wie war’s?“ – nur bei abgeschlossenen
-- Plänen und fehlendem eigenem Urteil, auch wenn schon genug Fotos da sind; „Abschließen“ als Hinweis nur für alle,
-- die den Plan verwalten dürfen. Weiterhin genau einmal je Person und Plan, nur Zusagen, nicht bei Absagen,
-- abschaltbar, nur eigene Crews, nichts für Außenstehende.
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

-- Freitag, 6. November 2026, abends (Berliner Winterzeit). Alice ist Owner, Bob organisiert „Quiz“, Carol und Dave
-- sind einfache Mitglieder.
select tests.logout();
insert into public.plans (crew_id, created_by, title, starts_at, status, completed_at, created_at) values
  (tests.var('crew')::uuid, tests.uid('alice'), 'Bowling', '2026-11-06 20:00+01', 'completed', '2026-11-06 23:30+01', '2026-11-01 12:00+01'),
  (tests.var('crew')::uuid, tests.uid('bob'), 'Quiz', '2026-11-06 19:00+01', 'confirmed', null, '2026-11-01 12:00+01'),
  (tests.var('crew')::uuid, tests.uid('bob'), 'Kino', '2026-11-06 21:00+01', 'confirmed', null, '2026-11-01 12:00+01'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Abgesagt', '2026-11-06 20:00+01', 'cancelled', null, '2026-11-01 12:00+01'),
  (tests.var('mallory_crew')::uuid, tests.uid('mallory'), 'Fremder Abend', '2026-11-06 20:00+01', 'completed', '2026-11-06 23:00+01', '2026-11-01 12:00+01');
select tests.set_var(lower(title), id::text) from public.plans
  where title in ('Bowling', 'Quiz', 'Kino', 'Abgesagt', 'Fremder Abend');
-- Bowling: alle vier zugesagt außer Dave („vielleicht“). Quiz und Kino: Alice, Bob, Carol. Abgesagt: Alice und Bob.
insert into public.plan_participants (plan_id, user_id, attendance_status) values
  (tests.var('bowling')::uuid, tests.uid('alice'), 'going'),
  (tests.var('bowling')::uuid, tests.uid('bob'), 'going'),
  (tests.var('bowling')::uuid, tests.uid('carol'), 'going'),
  (tests.var('bowling')::uuid, tests.uid('dave'), 'maybe'),
  (tests.var('quiz')::uuid, tests.uid('alice'), 'going'),
  (tests.var('quiz')::uuid, tests.uid('bob'), 'going'),
  (tests.var('quiz')::uuid, tests.uid('carol'), 'going'),
  (tests.var('kino')::uuid, tests.uid('alice'), 'going'),
  (tests.var('kino')::uuid, tests.uid('bob'), 'going'),
  (tests.var('kino')::uuid, tests.uid('carol'), 'going'),
  (tests.var('abgesagt')::uuid, tests.uid('alice'), 'going'),
  (tests.var('abgesagt')::uuid, tests.uid('bob'), 'going'),
  (tests.var('fremder abend')::uuid, tests.uid('mallory'), 'going');
-- Beim Bowling und beim Kino sind schon zwei Fotos geteilt (Fotos reichen), beim Quiz keins.
insert into public.plan_photos (id, plan_id, uploaded_by, path, width, height, uploaded_at)
select gen_random_uuid(), x.plan_id, x.user_id,
       tests.var('crew') || '/' || x.plan_id::text || '/' || gen_random_uuid()::text || '.webp', 1200, 900, '2026-11-06 23:00+01'
from (values (tests.var('bowling')::uuid, tests.uid('alice')),
             (tests.var('bowling')::uuid, tests.uid('alice')),
             (tests.var('kino')::uuid, tests.uid('bob')),
             (tests.var('kino')::uuid, tests.uid('bob'))) as x(plan_id, user_id);
-- Carol hat beim Bowling schon „Nochmal!“ gesagt (direkt eingetragen, die Frist zählt ab dem Abschluss).
insert into public.plan_feedback (plan_id, user_id, verdict) values (tests.var('bowling')::uuid, tests.uid('carol'), 'again');
delete from public.notifications;

-- ---- Keine neuen Rechte ----------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'app_private.send_plan_photo_nudges(uuid, timestamptz)', 'execute'), 'der interne Teil bleibt gesperrt');
select ok(not has_function_privilege('anon', 'app_private.send_plan_photo_nudges(uuid, timestamptz)', 'execute'), 'auch für anon');
select ok(not has_function_privilege('anon', 'public.send_plan_photo_nudges()', 'execute'), 'anon darf weiterhin nichts anstoßen');
select tests.login_anon();
select throws_ok($$ select public.send_plan_photo_nudges() $$, '42501', null, 'anon kann nichts anstoßen');
select throws_ok($$ select count(*) from public.plan_feedback $$, '42501', null, 'anon liest keine Urteile');

-- ---- Zeitfenster bleibt ------------------------------------------------------------------------------
select tests.logout();
select is(app_private.send_plan_photo_nudges(tests.uid('alice'), '2026-11-07 09:30+01'), 0, 'vor 10 Uhr am Morgen danach: nichts');

-- ---- Mallory stößt an: nur ihre Crew ----------------------------------------------------------------
select is(app_private.send_plan_photo_nudges(tests.uid('mallory'), '2026-11-07 10:00+01'), 1, 'Mallory erinnert nur ihre eigene Crew');
select is((select count(*)::int from public.notifications n where n.crew_id = tests.var('crew')::uuid), 0, 'nichts in fremden Crews');
select is((select n.payload ->> 'feedback' from public.notifications n where n.user_id = tests.uid('mallory') and n.type = 'plan_photo_nudge'), 'true',
          'Mallorys eigener abgeschlossener Abend fragt „Wie war’s?“');

-- ---- Carol öffnet um 10 Uhr die App ---------------------------------------------------------------
select is(app_private.send_plan_photo_nudges(tests.uid('carol'), '2026-11-07 10:00+01'), 5,
          'Bowling an Alice und Bob (Urteil fehlt), Quiz an Alice, Bob und Carol (Fotos fehlen)');

-- Bowling: genug Fotos, aber abgeschlossen – „Wie war’s?“ für alle mit „Bin dabei“ ohne Urteil.
select is((select array_agg(r.user_id order by r.user_id) from public.plan_photo_nudges r where r.plan_id = tests.var('bowling')::uuid),
          (select array_agg(u order by u) from unnest(array[tests.uid('alice'), tests.uid('bob')]) u),
          'Bowling: Alice und Bob – nicht Carol (hat geurteilt), nicht Dave („vielleicht“)');
select is((select n.payload ->> 'feedback' || ':' || (n.payload ->> 'photos') || ':' || (n.payload ->> 'close')
           from public.notifications n where n.user_id = tests.uid('bob') and n.related_entity_id = tests.var('bowling')::uuid),
          'true:false:false', 'Bowling an Bob: Wie war’s ja, Fotos nein, Abschließen nein (schon abgeschlossen)');
select is((select n.payload ->> 'yesterday' from public.notifications n where n.user_id = tests.uid('bob') and n.related_entity_id = tests.var('bowling')::uuid),
          'true', 'als „gestern“ gekennzeichnet');

-- Kino: genug Fotos und noch nicht abgeschlossen – nichts, auch nicht für Bob, der abschließen dürfte.
select is((select count(*)::int from public.plan_photo_nudges r where r.plan_id = tests.var('kino')::uuid), 0,
          'Kino: genug Fotos, nicht abgeschlossen – der Hinweis zum Abschließen löst allein nichts aus');
select is((select count(*)::int from public.plan_photo_nudges r where r.plan_id = tests.var('abgesagt')::uuid), 0, 'abgesagter Plan: nichts');

-- Quiz: Fotos fehlen, nicht abgeschlossen. Abschließen-Hinweis für Bob (organisiert) und Alice (Owner), nicht für Carol.
select is((select n.payload ->> 'feedback' || ':' || (n.payload ->> 'photos')
           from public.notifications n where n.user_id = tests.uid('carol') and n.related_entity_id = tests.var('quiz')::uuid),
          'false:true', 'Quiz an Carol: nur Fotos (nicht abgeschlossen, kein Urteil möglich)');
select is((select n.payload ->> 'close' from public.notifications n where n.user_id = tests.uid('bob') and n.related_entity_id = tests.var('quiz')::uuid),
          'true', 'Bob organisiert das Quiz: Hinweis zum Abschließen');
select is((select n.payload ->> 'close' from public.notifications n where n.user_id = tests.uid('alice') and n.related_entity_id = tests.var('quiz')::uuid),
          'true', 'Alice ist Owner: Hinweis zum Abschließen');
select is((select n.payload ->> 'close' from public.notifications n where n.user_id = tests.uid('carol') and n.related_entity_id = tests.var('quiz')::uuid),
          'false', 'Carol darf nicht abschließen: kein Hinweis');

-- Keine Namen, kein Urteil anderer in der Benachrichtigung.
select is((select count(*)::int from public.notifications n where n.type = 'plan_photo_nudge' and (n.actor_id is not null or n.payload ? 'verdict' or n.payload ? 'again')),
          0, 'ohne auslösende Person und ohne Urteile anderer');
select is((select count(*)::int from public.notifications n where n.user_id = tests.uid('mallory') and n.crew_id = tests.var('crew')::uuid), 0,
          'Mallory bekommt nichts aus fremden Crews');

-- ---- Genau einmal ----------------------------------------------------------------------------------
-- Bob urteilt danach und zieht zurück (direkt, damit der Test nicht an der echten Uhr hängt): Es kommt nichts nach.
insert into public.plan_feedback (plan_id, user_id, verdict) values (tests.var('bowling')::uuid, tests.uid('bob'), 'ok');
delete from public.plan_feedback where plan_id = tests.var('bowling')::uuid and user_id = tests.uid('bob');
select is(app_private.send_plan_photo_nudges(tests.uid('bob'), '2026-11-07 12:00+01'), 0, 'ein zweiter Aufruf erinnert nicht noch einmal');

-- Das Kino wird später am Tag abgeschlossen – erst jetzt ist „Wie war’s?“ möglich, und es kommt einmal.
update public.plans set status = 'completed', completed_at = '2026-11-07 13:00+01' where id = tests.var('kino')::uuid;
-- Alice urteilt über das Kino gleich selbst.
insert into public.plan_feedback (plan_id, user_id, verdict) values (tests.var('kino')::uuid, tests.uid('alice'), 'again');
select is(app_private.send_plan_photo_nudges(tests.uid('alice'), '2026-11-07 14:00+01'), 2, 'nach dem Abschluss: Kino an Bob und Carol, nicht an Alice (hat geurteilt)');
select is((select n.payload ->> 'feedback' from public.notifications n where n.user_id = tests.uid('carol') and n.related_entity_id = tests.var('kino')::uuid),
          'true', 'Kino an Carol: Wie war’s?');
select is(app_private.send_plan_photo_nudges(tests.uid('alice'), '2026-11-07 15:00+01'), 0, 'danach nichts mehr offen');

-- ---- Abschalten -----------------------------------------------------------------------------------
-- Dave sagt nachträglich zu und hat die Gruppe abgeschaltet: Er gilt als erinnert, bekommt aber nichts.
update public.plan_participants set attendance_status = 'going' where plan_id = tests.var('bowling')::uuid and user_id = tests.uid('dave');
update public.user_settings set notification_preferences = '{"plan_photo_nudge": false}' where user_id = tests.uid('dave');
select is(app_private.send_plan_photo_nudges(tests.uid('dave'), '2026-11-07 16:00+01'), 1, 'Dave ist dran');
select is((select count(*)::int from public.notifications n where n.user_id = tests.uid('dave') and n.type = 'plan_photo_nudge'), 0, 'abgeschaltet: keine Benachrichtigung');
select is((select count(*)::int from public.plan_photo_nudges r where r.user_id = tests.uid('dave')), 1, 'aber als erinnert vermerkt');

-- ---- Fenster zu ------------------------------------------------------------------------------------
-- Ein abgeschlossener Abend vor vier Tagen ohne Urteil: das Fenster am Morgen danach ist vorbei.
insert into public.plans (crew_id, created_by, title, starts_at, status, completed_at, created_at) values
  (tests.var('crew')::uuid, tests.uid('alice'), 'Alt', '2026-11-03 20:00+01', 'completed', '2026-11-03 23:00+01', '2026-11-01 12:00+01');
insert into public.plan_participants (plan_id, user_id, attendance_status)
select id, tests.uid('bob'), 'going' from public.plans where title = 'Alt';
select is(app_private.send_plan_photo_nudges(tests.uid('bob'), '2026-11-07 17:00+01'), 0, 'drei Tage nach dem Abend: nichts mehr');

-- ---- Aufruf aus der App -----------------------------------------------------------------------------
select tests.login('carol');
select lives_ok($$ select public.send_plan_photo_nudges() $$, 'die App stößt weiterhin an');

select * from finish();
rollback;
