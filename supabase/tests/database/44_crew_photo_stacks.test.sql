-- P10 Etappe 2c: Fotos im Crew-Rückblick – nur abgeschlossene Abende der eigenen Crew, nur fertige Fotos,
-- nichts mit offener Meldung (auch nicht für Verwaltende), nichts selbst Gemeldetes; höchstens 6 Abende,
-- je Abend die drei neuesten Fotos und die Zahl; anon und Außenstehende scheitern.
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

-- Abende: acht abgeschlossene (A1 jüngster … A8 ältester), ein bestätigter laufender, einer der fremden Crew.
select tests.logout();
insert into public.plans (crew_id, created_by, title, starts_at, status)
select tests.var('crew')::uuid, tests.uid('alice'), 'A' || i, now() - make_interval(days => i * 7), 'completed'
from generate_series(1, 8) i;
insert into public.plans (crew_id, created_by, title, starts_at, status) values
  (tests.var('crew')::uuid, tests.uid('alice'), 'Läuft', now() - interval '1 hour', 'confirmed'),
  (tests.var('mallory_crew')::uuid, tests.uid('mallory'), 'Fremd', now() - interval '3 days', 'completed');

-- Je Abend ein Foto von Bob; A1 bekommt fünf (eins davon nur reserviert), „Läuft“ und „Fremd“ je eins.
create temp table shots (tag text primary key, id uuid not null) on commit drop;
insert into shots
select 'A' || i, gen_random_uuid() from generate_series(1, 8) i
union all select 'A1-' || i, gen_random_uuid() from generate_series(2, 5) i
union all select 'run', gen_random_uuid()
union all select 'foreign', gen_random_uuid();

insert into public.plan_photos (id, plan_id, uploaded_by, path, width, height, uploaded_at)
select s.id, p.id, case when p.title = 'Fremd' then tests.uid('mallory') else tests.uid('bob') end,
       p.crew_id || '/' || p.id || '/' || s.id || '.webp', 800, 600,
       case when s.tag = 'A1-5' then null
            else now() - interval '1 hour' + make_interval(mins => coalesce(nullif(split_part(s.tag, '-', 2), '')::int, 1)) end
from shots s
join public.plans p on p.title = case when s.tag = 'run' then 'Läuft' when s.tag = 'foreign' then 'Fremd' else split_part(s.tag, '-', 1) end;
select tests.set_var('newest', (select id::text from shots where tag = 'A1-4'));
select tests.set_var('pending', (select id::text from shots where tag = 'A1-5'));

-- ---- Struktur und Rechte -----------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.crew_photo_stacks(uuid)', 'execute'), 'anon darf die Funktion nicht aufrufen');
select ok(has_function_privilege('authenticated', 'public.crew_photo_stacks(uuid)', 'execute'), 'Angemeldete dürfen');

select tests.login_anon();
select throws_ok($$ select public.crew_photo_stacks(tests.var('crew')::uuid) $$, '42501', null, 'anon bekommt keine Fotos');

select tests.login('mallory');
select throws_ok($$ select public.crew_photo_stacks(tests.var('crew')::uuid) $$, '42501', null, 'Außenstehende bekommen keine Fotos der Crew');
select throws_ok($$ select public.crew_photo_stacks(null) $$, '42501', null, 'ohne Crew keine Auskunft');
select is(jsonb_array_length(public.crew_photo_stacks(tests.var('mallory_crew')::uuid)), 1, 'Mallory sieht nur ihre eigene Crew');

-- ---- Inhalt ------------------------------------------------------------------------------------
select tests.login('carol');
select tests.set_var('stacks', public.crew_photo_stacks(tests.var('crew')::uuid)::text);
select is(jsonb_array_length(tests.var('stacks')::jsonb), 6, 'höchstens 6 Abende');
select is((select array_agg(e ->> 'title' order by o) from jsonb_array_elements(tests.var('stacks')::jsonb) with ordinality t(e, o)),
          array['A1', 'A2', 'A3', 'A4', 'A5', 'A6'], 'jüngster Abend zuerst, laufender und fremder fehlen');
select is((tests.var('stacks')::jsonb -> 0 ->> 'count')::int, 4, 'A1: vier fertige Fotos, die Reservierung zählt nicht');
select is(jsonb_array_length(tests.var('stacks')::jsonb -> 0 -> 'photos'), 3, 'A1: drei Fotos im Stapel');
select is((tests.var('stacks')::jsonb -> 0 -> 'photos' -> 0 ->> 'id')::uuid, tests.var('newest')::uuid, 'neuestes Foto vorn');
select ok(not (tests.var('stacks')::jsonb -> 0 -> 'photos') @> jsonb_build_array(jsonb_build_object('id', tests.var('pending')::uuid)), 'unbestätigte Reservierung nicht im Stapel');
select is((select array_agg(k order by k) from jsonb_object_keys(tests.var('stacks')::jsonb -> 0 -> 'photos' -> 0) k),
          array['height', 'id', 'path', 'width'], 'je Foto nur ID, Pfad und Größe – keine Person');
select is((select array_agg(k order by k) from jsonb_object_keys(tests.var('stacks')::jsonb -> 0) k),
          array['count', 'photos', 'plan_id', 'starts_at', 'title'], 'je Abend nur Plan, Titel, Beginn, Zahl, Fotos');

-- ---- Meldungen ---------------------------------------------------------------------------------
-- Carol meldet das neueste Foto von A1: für sie weg; offen → für alle weg, auch für Alice (Owner) und Bob.
select lives_ok($$ select public.report_plan_photo(tests.var('newest')::uuid, 'Ich bin drauf und will das nicht') $$, 'Carol meldet ein Foto');
select is((public.crew_photo_stacks(tests.var('crew')::uuid) -> 0 ->> 'count')::int, 3, 'Carol: gemeldetes Foto fehlt');
select tests.login('alice');
select is((public.crew_photo_stacks(tests.var('crew')::uuid) -> 0 ->> 'count')::int, 3, 'Owner: offene Meldung fehlt auch im Rückblick');
select tests.login('bob');
select is((public.crew_photo_stacks(tests.var('crew')::uuid) -> 0 ->> 'count')::int, 3, 'hochladende Person: offene Meldung fehlt im Rückblick');
select ok(not (public.crew_photo_stacks(tests.var('crew')::uuid) -> 0 -> 'photos') @> jsonb_build_array(jsonb_build_object('id', tests.var('newest')::uuid)), 'gemeldetes Foto nicht im Stapel');

-- Alice zeigt es wieder: Crew sieht es, Carol weiter nicht.
select tests.login('alice');
select lives_ok($$ select public.keep_plan_photo(tests.var('newest')::uuid) $$, 'Alice zeigt das Foto wieder');
select is((public.crew_photo_stacks(tests.var('crew')::uuid) -> 0 ->> 'count')::int, 4, 'Owner: nach „Wieder zeigen“ wieder da');
select tests.login('carol');
select is((public.crew_photo_stacks(tests.var('crew')::uuid) -> 0 ->> 'count')::int, 3, 'Carol: selbst gemeldetes Foto bleibt weg');

-- Ohne Fotos: leere Liste. Nach dem Austritt: keine Auskunft mehr.
select tests.logout();
delete from public.plan_photos where plan_id in (select id from public.plans where crew_id = tests.var('crew')::uuid);
select tests.login('bob');
select is(public.crew_photo_stacks(tests.var('crew')::uuid), '[]'::jsonb, 'ohne Fotos eine leere Liste');
select tests.logout();
delete from public.crew_members where crew_id = tests.var('crew')::uuid and user_id = tests.uid('bob');
select tests.login('bob');
select throws_ok($$ select public.crew_photo_stacks(tests.var('crew')::uuid) $$, '42501', null, 'ehemaliges Mitglied bekommt keine Fotos');

select * from finish();
rollback;
