-- P10 Etappe 3: Fotos aufräumen – gelöschte Foto-Zeilen (direkt, über Plan, Crew, Konto) bringen ihre Datei
-- in die Warteschlange, Fotos verfallen 12 Monate nach dem Abend, Reservierungen nach einem Tag; nur
-- service_role holt und erledigt Einträge, und ein Eintrag verschwindet erst, wenn die Datei weg ist.
begin;
\ir helpers.inc
select no_plan();
-- Die Schritte der Edge Function laufen als service_role; die Test-Ablage braucht sie auch.
grant usage on schema tests to service_role;
grant select, insert, update on tests.vars to service_role;

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Mallory');

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew', '🎳')::text);
select tests.set_var('invite', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob');
select is(public.accept_crew_invitation(tests.var('invite')) ->> 'status', 'joined', 'Bob tritt bei');
select tests.login('mallory');
select tests.set_var('mallory_crew', public.create_crew('Fremde Crew')::text);

select tests.logout();
-- Hochgeladene Dateien werden wie von der Storage-API angelegt (Zeile in storage.objects).
create function tests.photo(p_plan text, p_user text, p_age interval, p_confirmed boolean default true, p_file boolean default true) returns text
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_path text := tests.var('crew') || '/' || tests.var(p_plan) || '/' || v_id::text || '.webp';
begin
  insert into public.plan_photos (id, plan_id, uploaded_by, path, width, height, uploaded_at, created_at)
  values (v_id, tests.var(p_plan)::uuid, tests.uid(p_user), v_path, 800, 600,
          case when p_confirmed then now() - p_age end, now() - p_age);
  if p_file then
    insert into storage.objects (bucket_id, name) values ('plan-photos', v_path);
  end if;
  return v_path;
end $$;
-- Wie die Storage-API: Datei weg (gehostet verhindert ein Trigger direktes Löschen ohne diese Einstellung).
create function tests.remove_file(p_path text) returns void
language plpgsql as $$
begin
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'plan-photos' and name = p_path;
end $$;
create function tests.trash() returns text[]
language sql as $$ select coalesce(array_agg(path order by path), '{}') from app_private.plan_photo_trash $$;

insert into public.plans (crew_id, created_by, title, starts_at, ends_at, status) values
  (tests.var('crew')::uuid, tests.uid('alice'), 'Alt', now() - interval '13 months', now() - interval '13 months' + interval '3 hours', 'completed'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Fast ein Jahr', now() - interval '11 months', null, 'completed'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Frisch', now() - interval '2 hours', null, 'confirmed'),
  (tests.var('crew')::uuid, tests.uid('alice'), 'Weg', now() - interval '1 day', null, 'completed');
select tests.set_var(lower(replace(title, ' ', '_')), id::text) from public.plans where crew_id = tests.var('crew')::uuid;

select tests.set_var('p_alt', tests.photo('alt', 'alice', interval '13 months'));
select tests.set_var('p_fast', tests.photo('fast_ein_jahr', 'alice', interval '11 months'));
select tests.set_var('p_frisch', tests.photo('frisch', 'alice', interval '1 hour'));
select tests.set_var('p_bob', tests.photo('frisch', 'bob', interval '1 hour'));
select tests.set_var('p_res_alt', tests.photo('frisch', 'bob', interval '2 days', false, true));
select tests.set_var('p_res_neu', tests.photo('frisch', 'bob', interval '2 hours', false, false));
select tests.set_var('p_weg', tests.photo('weg', 'alice', interval '20 hours'));
select tests.set_var('p_ohne', tests.photo('weg', 'bob', interval '20 hours', true, false));

-- ---- Struktur und Rechte -----------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.plan_photo_cleanup_kick()', 'execute'), 'anon stößt nichts an');
select ok(not has_function_privilege('authenticated', 'public.claim_plan_photo_trash(integer)', 'execute'), 'Angemeldete holen keine Pfade');
select ok(not has_function_privilege('authenticated', 'public.finish_plan_photo_trash(text[])', 'execute'), 'Angemeldete erledigen keine Einträge');
select ok(not has_function_privilege('anon', 'public.claim_plan_photo_trash(integer)', 'execute'), 'anon holt keine Pfade');
select ok(not has_function_privilege('authenticated', 'app_private.expire_plan_photos()', 'execute'), 'Fristen nur intern');
select ok(not has_table_privilege('authenticated', 'app_private.plan_photo_trash', 'select'), 'Warteschlange nicht lesbar');
select ok(exists (select 1 from pg_trigger where tgname = 'plan_photos_queue_file' and tgrelid = 'public.plan_photos'::regclass), 'Trigger auf plan_photos');

select tests.login_anon();
select throws_ok($$ select public.plan_photo_cleanup_kick() $$, '42501', null, 'anon: kein Anstoß');
select tests.login('mallory');
select throws_ok($$ select public.claim_plan_photo_trash(10) $$, '42501', null, 'Außenstehende holen keine Pfade');
select throws_ok($$ select public.finish_plan_photo_trash(array['x']) $$, '42501', null, 'Außenstehende erledigen nichts');
select throws_ok($$ select * from app_private.plan_photo_trash $$, '42501', null, 'Außenstehende lesen die Warteschlange nicht');

-- ---- Löschen bringt die Datei in die Warteschlange ---------------------------------------------
select tests.logout();
select is(tests.trash(), '{}'::text[], 'anfangs leer');

delete from public.plans where id = tests.var('weg')::uuid;
select is(tests.trash(), array[tests.var('p_weg')], 'Plan gelöscht → Datei in der Warteschlange; Zeile ohne Datei nicht');

-- ---- Fristen über den Anstoß -------------------------------------------------------------------
select tests.login('mallory');
select is(public.plan_photo_cleanup_kick(), true, 'Anstoß (auch ohne Crew): es gibt etwas zu löschen');
select tests.logout();
select is((select count(*)::int from public.plan_photos where path = tests.var('p_alt')), 0, '13 Monate nach dem Abend: Foto weg');
select is((select count(*)::int from public.plan_photos where path = tests.var('p_fast')), 1, '11 Monate: Foto bleibt');
select is((select count(*)::int from public.plan_photos where path = tests.var('p_frisch')), 1, 'frisches Foto bleibt');
select is((select count(*)::int from public.plan_photos where path = tests.var('p_res_alt')), 0, 'Reservierung älter als ein Tag: weg');
select is((select count(*)::int from public.plan_photos where path = tests.var('p_res_neu')), 1, 'junge Reservierung bleibt');
select is(tests.trash(), (select array_agg(p order by p) from unnest(array[tests.var('p_weg'), tests.var('p_alt'), tests.var('p_res_alt')]) p),
          'abgelaufenes Foto und verwaiste Datei der Reservierung in der Warteschlange');

-- Konto gelöscht → Bobs Fotos weg, Dateien in die Warteschlange (die Reservierung ohne Datei nicht).
delete from auth.users where id = tests.uid('bob');
select ok(tests.var('p_bob') = any (tests.trash()), 'Konto gelöscht → Datei in der Warteschlange');
select is(cardinality(tests.trash()), 4, 'nur Pfade mit Datei');

-- ---- Abarbeiten (service_role) -----------------------------------------------------------------
select set_config('role', 'service_role', true);
select tests.set_var('claim1', public.claim_plan_photo_trash(2)::text);
select is(cardinality(tests.var('claim1')::text[]), 2, 'Grenze je Runde gilt');
select is(cardinality(public.claim_plan_photo_trash(100)), 2, 'zweite Runde holt den Rest');
select is(public.claim_plan_photo_trash(100), '{}'::text[], 'vorgemerkte Einträge kommen nicht sofort wieder');

select is(public.finish_plan_photo_trash(tests.var('claim1')::text[]), 0, 'Datei noch da → Eintrag bleibt');
select tests.logout();
select tests.remove_file(p) from unnest(tests.var('claim1')::text[]) p;
select set_config('role', 'service_role', true);
select is(public.finish_plan_photo_trash(tests.var('claim1')::text[] || array['fremd/pfad.webp']), 2, 'Dateien weg → Einträge erledigt (Unbekanntes zählt nicht)');
select throws_ok($$ select public.finish_plan_photo_trash(null) $$, 'P0001', 'invalid_plan_photo_trash', 'ohne Liste abgewiesen');

-- Fehlschlag: nach 10 Minuten noch einmal, mit jedem Versuch später.
select tests.logout();
update app_private.plan_photo_trash set claimed_at = now() - interval '11 minutes';
select set_config('role', 'service_role', true);
select is(cardinality(public.claim_plan_photo_trash(100)), 2, 'nach 10 Minuten noch einmal (1. Versuch)');
select tests.logout();
update app_private.plan_photo_trash set claimed_at = now() - interval '11 minutes';
select set_config('role', 'service_role', true);
select is(public.claim_plan_photo_trash(100), '{}'::text[], 'nach dem 2. Versuch erst nach 20 Minuten');
select tests.logout();
update app_private.plan_photo_trash set claimed_at = now() - interval '21 minutes';
select set_config('role', 'service_role', true);
select is(cardinality(public.claim_plan_photo_trash(100)), 2, 'nach 20 Minuten wieder dran');

-- Ein Pfad mit (wieder) gültiger Zeile wird nie gelöscht.
select tests.logout();
insert into app_private.plan_photo_trash (path) values (tests.var('p_frisch'));
select set_config('role', 'service_role', true);
select ok(not (tests.var('p_frisch') = any (public.claim_plan_photo_trash(100))), 'Foto mit Zeile wird nicht herausgegeben');
select tests.logout();
select ok(not (tests.var('p_frisch') = any (tests.trash())), 'und fällt aus der Warteschlange');

-- ---- Rate Limit --------------------------------------------------------------------------------
select tests.login('alice');
select public.plan_photo_cleanup_kick() from generate_series(1, 12);
select throws_ok($$ select public.plan_photo_cleanup_kick() $$, 'P0001', 'rate_limited', 'Anstoß höchstens 12-mal je Stunde');

select * from finish();
rollback;
