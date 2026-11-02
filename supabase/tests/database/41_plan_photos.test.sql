-- P10 Etappe 1a: Fotos zum Plan – nur die Crew sieht Fotos (Tabelle und Dateien im Bucket), hochladen nur
-- an selbst reservierte Pfade und erst ab Beginn des Plans, Grenzen je Plan und Person, Bestätigung nur mit
-- Datei, löschen nur durch Berechtigte, Konto gelöscht → Fotos weg; Außenstehende und anon scheitern.
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

-- Carol organisiert; Alice ist Owner der Crew; Bob ist einfaches Mitglied.
select tests.logout();
insert into public.plans (crew_id, created_by, title, starts_at, status) values
  (tests.var('crew')::uuid, tests.uid('carol'), 'Bowling', now() - interval '2 hours', 'confirmed'),
  (tests.var('crew')::uuid, tests.uid('carol'), 'Kino', now() + interval '2 days', 'confirmed'),
  (tests.var('crew')::uuid, tests.uid('carol'), 'Abgesagt', now() - interval '1 day', 'cancelled'),
  (tests.var('crew')::uuid, tests.uid('carol'), 'Voll', now() - interval '1 day', 'completed'),
  (tests.var('mallory_crew')::uuid, tests.uid('mallory'), 'Fremder Abend', now() - interval '1 hour', 'confirmed');
select tests.set_var(lower(title), id::text) from public.plans where title in ('Bowling', 'Kino', 'Abgesagt', 'Voll', 'Fremder Abend');

-- ---- Struktur und Rechte -----------------------------------------------------------------------
select ok(exists (select 1 from storage.buckets where id = 'plan-photos'), 'Bucket plan-photos existiert');
select ok(
  not exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'public')
  or (select not (to_jsonb(b) ->> 'public')::boolean from storage.buckets b where b.id = 'plan-photos'),
  'Bucket ist nicht öffentlich');
select ok((select c.relrowsecurity from pg_class c where c.oid = 'storage.objects'::regclass), 'storage.objects hat RLS');
select ok(not has_function_privilege('anon', 'public.reserve_plan_photo(uuid, integer, integer, text)', 'execute'), 'anon reserviert nichts');
select ok(not has_function_privilege('anon', 'public.confirm_plan_photo(uuid)', 'execute'), 'anon bestätigt nichts');
select ok(not has_function_privilege('anon', 'public.delete_plan_photo(uuid)', 'execute'), 'anon löscht nichts');
select ok(not has_function_privilege('anon', 'app_private.plan_photo_allowed(text, text)', 'execute'), 'anon nutzt die Policy-Prüfung nicht');
select ok(not has_table_privilege('authenticated', 'public.plan_photos', 'insert'), 'Fotos nicht direkt eintragbar');
select ok(not has_table_privilege('authenticated', 'public.plan_photos', 'update'), 'Fotos nicht direkt änderbar');
select ok(not has_table_privilege('authenticated', 'public.plan_photos', 'delete'), 'Fotos nicht direkt löschbar');
select ok(not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                      and policyname like 'plan_photos%' and cmd = 'UPDATE'), 'keine Update-Policy: Fotos werden nicht überschrieben');

select tests.login_anon();
select throws_ok('select * from public.plan_photos', '42501', null, 'anon liest keine Fotos');
select throws_ok($$ select public.reserve_plan_photo(tests.var('bowling')::uuid, 1600, 1200) $$, '42501', null, 'anon reserviert nichts');

-- ---- Reservieren -------------------------------------------------------------------------------
select tests.login('mallory');
select throws_ok($$ select public.reserve_plan_photo(tests.var('bowling')::uuid, 1600, 1200) $$, '42501', null, 'Außenstehende reservieren nichts');
select throws_ok($$ select public.reserve_plan_photo(gen_random_uuid(), 1600, 1200) $$, '42501', null, 'unbekannter Plan: keine Auskunft');

select tests.login('bob');
select throws_ok($$ select public.reserve_plan_photo(tests.var('kino')::uuid, 1600, 1200) $$, 'P0001', 'plan_photos_not_yet', 'vor Beginn des Plans keine Fotos');
select throws_ok($$ select public.reserve_plan_photo(tests.var('abgesagt')::uuid, 1600, 1200) $$, 'P0001', 'plan_locked', 'abgesagter Plan: keine Fotos');
select throws_ok($$ select public.reserve_plan_photo(tests.var('bowling')::uuid, 1601, 1200) $$, 'P0001', 'invalid_plan_photo', 'über 1600 px abgewiesen');
select throws_ok($$ select public.reserve_plan_photo(tests.var('bowling')::uuid, 0, 1200) $$, 'P0001', 'invalid_plan_photo', '0 px abgewiesen');
select throws_ok($$ select public.reserve_plan_photo(tests.var('bowling')::uuid, null, 1200) $$, 'P0001', 'invalid_plan_photo', 'ohne Maße abgewiesen');
select throws_ok($$ select public.reserve_plan_photo(tests.var('bowling')::uuid, 800, 600, 'image/png') $$, 'P0001', 'invalid_plan_photo', 'nur WebP oder JPEG');

select tests.set_var('r1', public.reserve_plan_photo(tests.var('bowling')::uuid, 1600, 1200)::text);
select tests.set_var('p1', tests.var('r1')::jsonb ->> 'path');
select tests.set_var('f1', tests.var('r1')::jsonb ->> 'id');
select is(tests.var('p1'), tests.var('crew') || '/' || tests.var('bowling') || '/' || tests.var('f1') || '.webp', 'Pfad: <crew>/<plan>/<foto>.webp');
select is((select count(*)::int from public.plan_photos where id = tests.var('f1')::uuid), 1, 'Bob sieht seine laufende Reservierung');

-- Abgeschlossene Pläne nehmen Fotos an (genau dann teilt man sie); JPEG bekommt die Endung .jpg (Safari).
select ok(public.reserve_plan_photo(tests.var('voll')::uuid, 800, 600, 'image/jpeg') ->> 'path' like '%.jpg', 'abgeschlossener Plan nimmt Fotos an, JPEG als .jpg');

select tests.login('carol');
select is((select count(*)::int from public.plan_photos where id = tests.var('f1')::uuid), 0, 'Carol sieht Bobs unbestätigte Reservierung nicht');

-- ---- Hochladen (Policy auf storage.objects) ----------------------------------------------------
select tests.login('mallory');
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('plan-photos', %L) $$, tests.var('p1')),
  '42501', null, 'Außenstehende laden nicht an Bobs Pfad hoch');
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('plan-photos', %L) $$,
         tests.var('crew') || '/' || tests.var('bowling') || '/' || gen_random_uuid() || '.webp'),
  '42501', null, 'Außenstehende laden nicht an selbst erfundene Pfade hoch');
select tests.login('carol');
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('plan-photos', %L) $$, tests.var('p1')),
  '42501', null, 'auch Mitglieder laden nicht an fremde Reservierungen hoch');
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('plan-photos', %L) $$,
         tests.var('crew') || '/' || tests.var('bowling') || '/' || gen_random_uuid() || '.webp'),
  '42501', null, 'ohne Reservierung kein Upload');

select tests.login('bob');
select throws_ok($$ select public.confirm_plan_photo(tests.var('f1')::uuid) $$, 'P0001', 'plan_photo_missing', 'ohne Datei keine Bestätigung');
select lives_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('plan-photos', %L) $$, tests.var('p1')),
  'Bob lädt an seinen reservierten Pfad hoch');

select tests.login('carol');
select throws_ok($$ select public.confirm_plan_photo(tests.var('f1')::uuid) $$, '42501', null, 'nur wer hochlädt, bestätigt');
select tests.login('bob');
select lives_ok($$ select public.confirm_plan_photo(tests.var('f1')::uuid) $$, 'Bob bestätigt');
select ok((select uploaded_at is not null from public.plan_photos where id = tests.var('f1')::uuid), 'Foto ist fertig');
select lives_ok($$ select public.confirm_plan_photo(tests.var('f1')::uuid) $$, 'zweite Bestätigung schadet nicht');
select ok(not app_private.plan_photo_allowed(tests.var('p1'), 'upload'), 'bestätigter Pfad nimmt keinen Upload mehr an');

-- ---- Lesen -------------------------------------------------------------------------------------
select tests.login('carol');
select is((select count(*)::int from public.plan_photos where id = tests.var('f1')::uuid), 1, 'Carol sieht das fertige Foto');
select is((select count(*)::int from storage.objects where bucket_id = 'plan-photos' and name = tests.var('p1')), 1, 'Carol liest die Datei');
select tests.login('mallory');
select is((select count(*)::int from public.plan_photos), 0, 'Außenstehende sehen keine Fotos');
select is((select count(*)::int from storage.objects where bucket_id = 'plan-photos'), 0, 'Außenstehende lesen keine Dateien');

-- ---- Grenzen -----------------------------------------------------------------------------------
select tests.login('bob');
select public.reserve_plan_photo(tests.var('bowling')::uuid, 1200, 1600) from generate_series(1, 9);
select throws_ok($$ select public.reserve_plan_photo(tests.var('bowling')::uuid, 1600, 1200) $$, 'P0001', 'plan_photo_user_limit', 'höchstens 10 Fotos je Person und Plan');

-- Abgebrochene Uploads geben ihren Platz nach einer Stunde frei.
select tests.logout();
update public.plan_photos set created_at = now() - interval '2 hours'
where id = (select id from public.plan_photos where plan_id = tests.var('bowling')::uuid and uploaded_by = tests.uid('bob') and uploaded_at is null limit 1);
select tests.login('bob');
select ok(public.reserve_plan_photo(tests.var('bowling')::uuid, 1600, 1200) ? 'id', 'verfallene Reservierung macht Platz');

-- 50 je Plan: der Plan „Voll“ bekommt 49 weitere Fotos von Alice und Carol (direkt eingetragen).
select tests.logout();
insert into public.plan_photos (id, plan_id, uploaded_by, path, width, height, uploaded_at)
select g.id, tests.var('voll')::uuid, case when n % 2 = 0 then tests.uid('alice') else tests.uid('carol') end,
       tests.var('crew') || '/' || tests.var('voll') || '/' || g.id || '.webp', 800, 600, now()
from (select gen_random_uuid() as id, n from generate_series(1, 49) n) g;
select tests.login('bob');
select throws_ok($$ select public.reserve_plan_photo(tests.var('voll')::uuid, 1600, 1200) $$, 'P0001', 'plan_photo_limit', 'höchstens 50 Fotos je Plan');

-- ---- Löschen -----------------------------------------------------------------------------------
select tests.login('mallory');
select ok(not app_private.plan_photo_allowed(tests.var('p1'), 'delete'), 'Außenstehende dürfen Bobs Datei nicht löschen');
select throws_ok($$ select public.delete_plan_photo(tests.var('f1')::uuid) $$, '42501', null, 'Außenstehende löschen kein Foto');
select tests.login('bob');
select ok(app_private.plan_photo_allowed(tests.var('p1'), 'delete'), 'Bob darf seine Datei löschen');
select tests.login('alice');
select ok(app_private.plan_photo_allowed(tests.var('p1'), 'delete'), 'Owner darf die Datei löschen');
select tests.login('carol');
select ok(app_private.plan_photo_allowed(tests.var('p1'), 'delete'), 'Organisatorin darf die Datei löschen');

-- Zweites Foto von Alice: Bob (einfaches Mitglied) darf es nicht löschen.
select tests.set_var('f_alice', (select id::text from public.plan_photos where plan_id = tests.var('voll')::uuid and uploaded_by = tests.uid('alice') limit 1));
select tests.login('bob');
select throws_ok($$ select public.delete_plan_photo(tests.var('f_alice')::uuid) $$, '42501', null, 'Mitglieder löschen keine fremden Fotos');
select ok(not app_private.plan_photo_allowed((select path from public.plan_photos where id = tests.var('f_alice')::uuid), 'delete'),
          'Mitglieder löschen keine fremden Dateien');
select tests.login('carol');
select lives_ok($$ select public.delete_plan_photo(tests.var('f_alice')::uuid) $$, 'Organisatorin löscht ein fremdes Foto');
select is((select count(*)::int from public.plan_photos where id = tests.var('f_alice')::uuid), 0, 'Foto ist weg');

-- ---- Datenexport -------------------------------------------------------------------------------
select tests.login('bob');
select is(jsonb_array_length(public.export_my_data() -> 'plan_photos'), 1, 'Export enthält Bobs fertiges Foto (keine Reservierungen)');
select is(public.export_my_data() -> 'plan_photos' -> 0 ->> 'path', tests.var('p1'), 'Export nennt den Pfad');

-- ---- Bob löscht sein Foto, danach Kontolöschung ------------------------------------------------
select lives_ok($$ select public.delete_plan_photo(tests.var('f1')::uuid) $$, 'Bob löscht sein Foto');
select tests.login('carol');
select is((select count(*)::int from storage.objects where bucket_id = 'plan-photos' and name = tests.var('p1')), 0,
          'ohne Zeile ist die Datei für die Crew nicht mehr lesbar');

select tests.logout();
delete from auth.users where id = tests.uid('bob');
select is((select count(*)::int from public.plan_photos where uploaded_by = tests.uid('bob')), 0, 'Konto gelöscht → Bobs Fotos weg');

select * from finish();
rollback;
