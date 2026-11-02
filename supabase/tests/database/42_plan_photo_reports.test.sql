-- P10 Etappe 2a: Fotos melden – für die meldende Person sofort weg, für die Crew ausgeblendet bis zur
-- Entscheidung, Verwaltende erfahren es ohne Namen und entscheiden (wieder zeigen oder löschen); eigene
-- Fotos nicht meldbar und nicht selbst freigebbar; Außenstehende und anon scheitern.
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

-- Carol organisiert; Alice ist Owner; Bob und Dave sind einfache Mitglieder.
select tests.logout();
insert into public.plans (crew_id, created_by, title, starts_at, status) values
  (tests.var('crew')::uuid, tests.uid('carol'), 'Bowling', now() - interval '2 hours', 'confirmed');
select tests.set_var('plan', (select id::text from public.plans where title = 'Bowling'));

-- Fotos: f1 von Bob, f2 von Dave, f3 von Carol (Organisatorin), r1 eine unbestätigte Reservierung von Bob.
select tests.set_var('f1', gen_random_uuid()::text);
select tests.set_var('f2', gen_random_uuid()::text);
select tests.set_var('f3', gen_random_uuid()::text);
select tests.set_var('r1', gen_random_uuid()::text);
insert into public.plan_photos (id, plan_id, uploaded_by, path, width, height, uploaded_at)
select v.id::uuid, tests.var('plan')::uuid, v.who, tests.var('crew') || '/' || tests.var('plan') || '/' || v.id || '.webp', 800, 600, v.done
from (values (tests.var('f1'), tests.uid('bob'), now()), (tests.var('f2'), tests.uid('dave'), now()),
             (tests.var('f3'), tests.uid('carol'), now()), (tests.var('r1'), tests.uid('bob'), null::timestamptz)) v(id, who, done);
insert into storage.objects (bucket_id, name)
select 'plan-photos', path from public.plan_photos where plan_id = tests.var('plan')::uuid and uploaded_at is not null;
select tests.set_var('p1', (select path from public.plan_photos where id = tests.var('f1')::uuid));

-- ---- Struktur und Rechte -----------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.report_plan_photo(uuid, text)', 'execute'), 'anon meldet nichts');
select ok(not has_function_privilege('anon', 'public.keep_plan_photo(uuid)', 'execute'), 'anon gibt nichts frei');
select ok(not has_function_privilege('anon', 'public.plan_photo_reports(uuid)', 'execute'), 'anon liest keine Meldungen');
select ok(not has_function_privilege('anon', 'app_private.plan_photo_visible(uuid, uuid, uuid)', 'execute'), 'anon nutzt die Sichtbarkeitsprüfung nicht');

select tests.login_anon();
select throws_ok($$ select public.report_plan_photo(tests.var('f1')::uuid, 'Bin drauf, will ich nicht') $$, '42501', null, 'anon meldet kein Foto');

-- ---- Melden: Abwehr ----------------------------------------------------------------------------
select tests.login('mallory');
select throws_ok($$ select public.report_plan_photo(tests.var('f1')::uuid, 'Bin drauf, will ich nicht') $$, '42501', null, 'Außenstehende melden kein Foto');
select throws_ok($$ select public.report_plan_photo(gen_random_uuid(), 'Bin drauf, will ich nicht') $$, '42501', null, 'unbekanntes Foto: keine Auskunft');
select throws_ok($$ select public.plan_photo_reports(tests.var('plan')::uuid) $$, '42501', null, 'Außenstehende lesen keine Meldungen');
select throws_ok($$ select public.keep_plan_photo(tests.var('f1')::uuid) $$, '42501', null, 'Außenstehende geben nichts frei');

select tests.login('dave');
select throws_ok($$ select public.report_plan_photo(tests.var('r1')::uuid, 'Bin drauf, will ich nicht') $$, '42501', null, 'unbestätigte Reservierung ist nicht meldbar');
select throws_ok($$ select public.report_plan_photo(tests.var('f2')::uuid, 'Bin drauf, will ich nicht') $$, 'P0001', 'plan_photo_own', 'eigenes Foto ist nicht meldbar');
select throws_ok($$ select public.report_plan_photo(tests.var('f1')::uuid, 'kurz') $$, 'P0001', 'invalid_report', 'Grund unter 5 Zeichen abgewiesen');
select throws_ok($$ select public.report_plan_photo(tests.var('f1')::uuid, null) $$, 'P0001', 'invalid_report', 'ohne Grund abgewiesen');

-- Vorher: alle sehen alle drei Fotos.
select is((select count(*)::int from public.plan_photos where plan_id = tests.var('plan')::uuid and uploaded_at is not null), 3, 'Dave sieht vor der Meldung drei Fotos');

-- ---- Dave meldet Bobs Foto ---------------------------------------------------------------------
select lives_ok($$ select public.report_plan_photo(tests.var('f1')::uuid, 'Ich bin drauf und will das nicht') $$, 'Dave meldet Bobs Foto');
select lives_ok($$ select public.report_plan_photo(tests.var('f1')::uuid, 'Ich bin drauf und will das nicht') $$, 'zweites Melden schadet nicht');
select is((select count(*)::int from public.reports where entity_type = 'plan_photo' and entity_id = tests.var('f1')::uuid), 1, 'genau eine Meldung von Dave');

select is((select count(*)::int from public.plan_photos where id = tests.var('f1')::uuid), 0, 'für Dave ist das Foto weg');
select is((select count(*)::int from storage.objects where bucket_id = 'plan-photos' and name = tests.var('p1')), 0, 'Dave liest die Datei nicht mehr');
select is(public.plan_photo_reports(tests.var('plan')::uuid), '[]'::jsonb, 'Dave sieht keine Meldungsdetails');

select tests.login('alice');
select is((select count(*)::int from public.plan_photos where id = tests.var('f1')::uuid), 1, 'Owner sieht das gemeldete Foto');
select is((select count(*)::int from storage.objects where bucket_id = 'plan-photos' and name = tests.var('p1')), 1, 'Owner liest die Datei');
select is(public.plan_photo_reports(tests.var('plan')::uuid) -> 0 ->> 'photo_id', tests.var('f1'), 'Owner sieht die Meldung');
select is(public.plan_photo_reports(tests.var('plan')::uuid) -> 0 -> 'reasons' ->> 0, 'Ich bin drauf und will das nicht', 'Owner sieht den Grund');
select is((public.plan_photo_reports(tests.var('plan')::uuid) -> 0 ->> 'can_review')::boolean, true, 'Owner darf entscheiden');
select ok(not (public.plan_photo_reports(tests.var('plan')::uuid)::text ~ tests.uid('dave')::text), 'Meldung nennt Dave nicht');

select tests.login('carol');
select is((select count(*)::int from public.plan_photos where id = tests.var('f1')::uuid), 1, 'Organisatorin sieht das gemeldete Foto');

select tests.login('bob');
select is((select count(*)::int from public.plan_photos where id = tests.var('f1')::uuid), 1, 'Bob sieht sein gemeldetes Foto weiter');
select is((select count(*)::int from storage.objects where bucket_id = 'plan-photos' and name = tests.var('p1')), 1, 'Bob liest seine Datei');
select is((public.plan_photo_reports(tests.var('plan')::uuid) -> 0 ->> 'count')::int, 1, 'Bob erfährt, dass sein Foto gemeldet ist');
select is(public.plan_photo_reports(tests.var('plan')::uuid) -> 0 -> 'reasons', '[]'::jsonb, 'Bob sieht keine Gründe');
select is((public.plan_photo_reports(tests.var('plan')::uuid) -> 0 ->> 'can_review')::boolean, false, 'Bob entscheidet nicht');
select throws_ok($$ select public.keep_plan_photo(tests.var('f1')::uuid) $$, '42501', null, 'Mitglieder geben nichts frei');

-- Benachrichtigungen: Organisatorin und Owner, ohne auslösende Person; nicht Dave, nicht Bob.
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'plan_photo_reported'), 2, 'zwei Benachrichtigungen');
select is((select count(*)::int from public.notifications where type = 'plan_photo_reported' and user_id in (tests.uid('alice'), tests.uid('carol'))), 2, 'an Owner und Organisatorin');
select is((select count(*)::int from public.notifications where type = 'plan_photo_reported' and actor_id is not null), 0, 'ohne Namen der meldenden Person');
select is((select related_entity_id::text from public.notifications where type = 'plan_photo_reported' limit 1), tests.var('plan'), 'zeigt auf den Plan');

-- Ein Gast? Nein: Mallory (Außenstehende) sah das Foto nie.
select tests.login('mallory');
select is((select count(*)::int from public.plan_photos), 0, 'Außenstehende sehen weiterhin keine Fotos');

-- ---- Carol (Organisatorin) zeigt es wieder ------------------------------------------------------
select tests.login('carol');
select lives_ok($$ select public.keep_plan_photo(tests.var('f1')::uuid) $$, 'Organisatorin zeigt das Foto wieder');
select is((select status::text from public.reports where entity_type = 'plan_photo' and entity_id = tests.var('f1')::uuid), 'dismissed', 'Meldung abgelehnt');
select is(public.plan_photo_reports(tests.var('plan')::uuid), '[]'::jsonb, 'keine offene Meldung mehr');

select tests.login('dave');
select is((select count(*)::int from public.plan_photos where id = tests.var('f1')::uuid), 0, 'für Dave bleibt das Foto weg');
select tests.login('alice');
select is((select count(*)::int from public.plan_photos where plan_id = tests.var('plan')::uuid and uploaded_at is not null), 3, 'die übrige Crew sieht es wieder');

-- ---- Eigene Fotos: Verwaltende entscheiden nicht über sich selbst ------------------------------
select tests.login('bob');
select lives_ok($$ select public.report_plan_photo(tests.var('f3')::uuid, 'Unangemessen für die Crew') $$, 'Bob meldet Carols Foto');
select tests.login('carol');
select is((select count(*)::int from public.plan_photos where id = tests.var('f3')::uuid), 1, 'Carol sieht ihr gemeldetes Foto');
select is((public.plan_photo_reports(tests.var('plan')::uuid) -> 0 ->> 'can_review')::boolean, false, 'Carol entscheidet nicht über ihr eigenes Foto');
select throws_ok($$ select public.keep_plan_photo(tests.var('f3')::uuid) $$, 'P0001', 'plan_photo_own_review', 'Carol gibt ihr eigenes Foto nicht frei');
select tests.logout();
select is((select (payload ->> 'own')::boolean from public.notifications where type = 'plan_photo_reported' and user_id = tests.uid('carol')
           and payload ->> 'photo_id' = tests.var('f3')), true, 'Carols Benachrichtigung sagt: dein eigenes Foto');

-- Alice (Owner) löscht es: Datei und Zeile weg, Meldung erledigt.
select tests.login('alice');
select is((public.plan_photo_reports(tests.var('plan')::uuid) -> 0 ->> 'can_review')::boolean, true, 'Owner entscheidet über Carols Foto');
select lives_ok(
  format($$ delete from storage.objects where bucket_id = 'plan-photos' and name = %L $$,
         (select path from public.plan_photos where id = tests.var('f3')::uuid)),
  'Owner löscht die Datei');
select lives_ok($$ select public.delete_plan_photo(tests.var('f3')::uuid) $$, 'Owner löscht das Foto');
select is((select status::text from public.reports where entity_type = 'plan_photo' and entity_id = tests.var('f3')::uuid), 'resolved', 'Meldung erledigt');

-- ---- Ausgetretene melden nichts mehr ------------------------------------------------------------
select tests.login('dave');
select lives_ok($$ select public.leave_crew(tests.var('crew')::uuid) $$, 'Dave tritt aus');
select throws_ok($$ select public.report_plan_photo(tests.var('f2')::uuid, 'Bin drauf, will ich nicht') $$, '42501', null, 'Ausgetretene melden nichts');

select * from finish();
rollback;
