-- P29 Etappe 2: „Eure Lieblingsabende“ – abgeschlossene Abende der Crew mit den meisten „Nochmal!“.
-- Regel: mindestens zwei „Nochmal!“ und mehr als die Hälfte der Urteile; höchstens drei, meiste zuerst, dann der jüngste;
-- optional nur ein Kalenderjahr (Berliner Zeit). Nur Zahlen, keine Namen; anon, Außenstehende und Ehemalige nichts.
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
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('carol');
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('dave');
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('mallory');
select tests.set_var('other', public.create_crew('Fremde Crew')::text);

-- Fünf Abende, alle mit Alice, Bob, Carol, Dave dabei.
select tests.login('alice');
select tests.set_var('bowling', public.create_plan(tests.var('crew')::uuid, 'Bowling', now() + interval '3 days', p_confirmed => true)::text);
select tests.set_var('kino', public.create_plan(tests.var('crew')::uuid, 'Kino', now() + interval '3 days', p_confirmed => true)::text);
select tests.set_var('karaoke', public.create_plan(tests.var('crew')::uuid, 'Karaoke', now() + interval '3 days', p_confirmed => true)::text);
select tests.set_var('billard', public.create_plan(tests.var('crew')::uuid, 'Billard', now() + interval '3 days', p_confirmed => true)::text);
select tests.set_var('quiz', public.create_plan(tests.var('crew')::uuid, 'Quiz', now() + interval '3 days', p_confirmed => true)::text);
select tests.set_var('offen', public.create_plan(tests.var('crew')::uuid, 'Noch offen', now() + interval '3 days', p_confirmed => true)::text);

do $$
declare
  v_name text;
  v_plan text;
begin
  foreach v_name in array array['alice', 'bob', 'carol', 'dave'] loop
    perform tests.login(v_name);
    foreach v_plan in array array['bowling', 'kino', 'karaoke', 'billard', 'quiz', 'offen'] loop
      perform public.set_attendance(tests.var(v_plan)::uuid, 'going');
    end loop;
  end loop;
end $$;

select tests.logout();
update public.plans set starts_at = now() - interval '10 days' where id = tests.var('bowling')::uuid;
update public.plans set starts_at = now() - interval '5 days' where id = tests.var('kino')::uuid;
update public.plans set starts_at = now() - interval '3 days' where id = tests.var('karaoke')::uuid;
update public.plans set starts_at = now() - interval '2 days' where id = tests.var('billard')::uuid;
update public.plans set starts_at = now() - interval '1 day' where id = tests.var('quiz')::uuid;
update public.plans set starts_at = now() - interval '4 hours' where id = tests.var('offen')::uuid;
select tests.login('alice');
select public.set_plan_status(tests.var(v)::uuid, 'completed') from unnest(array['bowling', 'kino', 'karaoke', 'billard', 'quiz']) v;

-- Urteile:
--   Bowling: 3 × Nochmal, 1 × okay      → Lieblingsabend (3 von 4)
--   Kino:    2 × Nochmal                 → Lieblingsabend (2 von 2)
--   Karaoke: 2 × Nochmal, 2 × eher nicht → nicht (genau die Hälfte)
--   Billard: 1 × Nochmal                 → nicht (nur einer)
--   Quiz:    2 × Nochmal, 1 × okay       → Lieblingsabend (2 von 3)
select tests.login('alice');
select public.set_plan_feedback(tests.var('bowling')::uuid, 'again'), public.set_plan_feedback(tests.var('kino')::uuid, 'again'),
       public.set_plan_feedback(tests.var('karaoke')::uuid, 'again'), public.set_plan_feedback(tests.var('billard')::uuid, 'again'),
       public.set_plan_feedback(tests.var('quiz')::uuid, 'again');
select tests.login('bob');
select public.set_plan_feedback(tests.var('bowling')::uuid, 'again'), public.set_plan_feedback(tests.var('kino')::uuid, 'again'),
       public.set_plan_feedback(tests.var('karaoke')::uuid, 'again'), public.set_plan_feedback(tests.var('quiz')::uuid, 'again');
select tests.login('carol');
select public.set_plan_feedback(tests.var('bowling')::uuid, 'again'), public.set_plan_feedback(tests.var('karaoke')::uuid, 'meh'),
       public.set_plan_feedback(tests.var('quiz')::uuid, 'ok');
select tests.login('dave');
select public.set_plan_feedback(tests.var('bowling')::uuid, 'ok'), public.set_plan_feedback(tests.var('karaoke')::uuid, 'meh');

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.crew_favorite_evenings(uuid, int)', 'execute'), 'anon sieht keine Lieblingsabende');
select ok(has_function_privilege('authenticated', 'public.crew_favorite_evenings(uuid, int)', 'execute'), 'angemeldete dürfen fragen');
select ok(not has_function_privilege('public', 'public.crew_favorite_evenings(uuid, int)', 'execute'), 'public hat kein Recht');
select tests.logout();
select throws_ok($$ select public.crew_favorite_evenings(tests.var('crew')::uuid) $$, '42501', null, 'ohne Konto: verboten');

-- ---- Angriffe ------------------------------------------------------------------------------------
select tests.login('mallory');
select throws_ok($$ select public.crew_favorite_evenings(tests.var('crew')::uuid) $$, '42501', null, 'Außenstehende sehen nichts');
select throws_ok($$ select public.crew_favorite_evenings(tests.var('crew')::uuid, 2026) $$, '42501', null, 'auch nicht für ein Jahr');
select throws_ok($$ select public.crew_favorite_evenings(gen_random_uuid()) $$, '42501', null, 'unbekannte Crew verrät nichts');
select throws_ok($$ select public.crew_favorite_evenings(null) $$, '42501', null, 'ohne Crew: verboten');
select is(public.crew_favorite_evenings(tests.var('other')::uuid), '[]'::jsonb, 'eigene Crew ohne Urteile: leere Liste');

-- ---- Auswahl ------------------------------------------------------------------------------------
select tests.login('dave');
select is((select jsonb_agg(x ->> 'title') from jsonb_array_elements(public.crew_favorite_evenings(tests.var('crew')::uuid)) x),
  '["Bowling", "Quiz", "Kino"]'::jsonb, 'meiste „Nochmal!“ zuerst, bei Gleichstand der jüngste; Karaoke und Billard fehlen');
select is((public.crew_favorite_evenings(tests.var('crew')::uuid) -> 0) - 'starts_at',
  jsonb_build_object('plan_id', tests.var('bowling'), 'title', 'Bowling', 'again', 3, 'total', 4), 'Zahlen je Abend');
select ok(not (public.crew_favorite_evenings(tests.var('crew')::uuid)::text ~* (tests.uid('carol')::text || '|' || tests.uid('alice')::text || '|carol|alice')),
  'die Liste verrät nicht, wer was gesagt hat');
select ok(not (public.crew_favorite_evenings(tests.var('crew')::uuid)::text like '%' || tests.var('offen') || '%'),
  'nicht abgeschlossene Pläne fehlen');

-- Genau die Hälfte reicht nicht – kippt ein Urteil, wird Karaoke zum Lieblingsabend und verdrängt den ältesten mit zwei.
select tests.login('dave');
select public.set_plan_feedback(tests.var('karaoke')::uuid, null);
select is((select jsonb_agg(x ->> 'title') from jsonb_array_elements(public.crew_favorite_evenings(tests.var('crew')::uuid)) x),
  '["Bowling", "Quiz", "Karaoke"]'::jsonb, 'höchstens drei: Karaoke (2 von 3) ist jünger als Kino');
select public.set_plan_feedback(tests.var('karaoke')::uuid, 'meh');

-- Ein Jahr: nur Abende dieses Kalenderjahrs in Berliner Zeit.
select tests.logout();
update public.plans set starts_at = '2025-12-31 22:30:00+00' where id = tests.var('bowling')::uuid; -- in Berlin schon 2026
update public.plans set starts_at = '2025-12-31 21:30:00+00' where id = tests.var('kino')::uuid;    -- in Berlin noch 2025
select tests.login('alice');
select is((select jsonb_agg(x ->> 'title') from jsonb_array_elements(public.crew_favorite_evenings(tests.var('crew')::uuid, 2025)) x),
  '["Kino"]'::jsonb, '2025: nur Kino (Silvester 22:30 Uhr Berliner Zeit)');
select ok(public.crew_favorite_evenings(tests.var('crew')::uuid, 2026) @> jsonb_build_array(jsonb_build_object('title', 'Bowling')),
  'Bowling (Neujahr 0:30 Uhr in Berlin) gehört zu 2026');
select is(public.crew_favorite_evenings(tests.var('crew')::uuid, 1999), '[]'::jsonb, 'Jahr ohne Abende: leere Liste');

-- Abgesagte Abende zählen nicht, auch wenn Urteile in der Tabelle stünden.
select tests.logout();
update public.plans set status = 'cancelled' where id = tests.var('quiz')::uuid;
select tests.login('alice');
select ok(not (public.crew_favorite_evenings(tests.var('crew')::uuid)::text like '%Quiz%'), 'abgesagter Plan fällt heraus');

-- Austritt: Wer die Crew verlässt, sieht die Liste nicht mehr.
select tests.login('bob');
select public.leave_crew(tests.var('crew')::uuid);
select throws_ok($$ select public.crew_favorite_evenings(tests.var('crew')::uuid) $$, '42501', null, 'nach dem Austritt nichts mehr');

select * from finish();
rollback;
