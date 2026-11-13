-- P52: Gäste bringen was mit. Gäste mit Zusage/„Vielleicht“ über den Teilen-Link sehen die Mitbring-Liste ohne Namen
-- und übernehmen offene Sachen; eine Sache bringt genau eine Person mit (Mitglied oder Gast); „Kann nicht“,
-- Zurückziehen und Entfernen geben frei; beim Übernehmen ins Konto gehen die Sachen mit; Außenstehende, anon ohne
-- Geheimnis, fremde Geheimnisse und Mitglieder als Gast kommen nicht heran; nach Beginn/abgesagt gesperrt.
begin;
\ir helpers.inc
select no_plan();

-- Stand einer Sache auf der Liste des Gasts (nach Name, die Reihenfolge ist bei gleicher Zeit nicht fest).
create function tests.item_state(p_secret text, p_label text) returns text language sql as $$
  select e ->> 'state' from jsonb_array_elements(public.shared_plan_items(tests.var('token'), p_secret) -> 'items') e
  where e ->> 'label' = p_label;
$$;
grant execute on function tests.item_state(text, text) to anon, authenticated;

select tests.make_user('Alice');
select tests.make_user('Bob');
select tests.make_user('Carol');
select tests.make_user('Gina');
select tests.make_user('Mallory');

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Weekend Crew', '🎳')::text);
select tests.set_var('invite', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob');
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('carol');
select public.accept_crew_invitation(tests.var('invite'));
select tests.login('mallory');
select public.create_crew('Fremde Crew');

-- Bob grillt, lässt Zusagen über den Link zu und schreibt drei Sachen auf.
select tests.login('bob');
select tests.set_var('plan', public.create_plan(tests.var('crew')::uuid, 'Grillen am See', now() + interval '3 days', p_confirmed => true)::text);
select tests.set_var('token', public.plan_share_token(tests.var('plan')::uuid));
select public.set_plan_guests(tests.var('plan')::uuid, true);
select tests.set_var('kohle', public.add_plan_item(tests.var('plan')::uuid, 'Kohle')::text);
select tests.set_var('chips', public.add_plan_item(tests.var('plan')::uuid, 'Chips')::text);
select tests.set_var('bier', public.add_plan_item(tests.var('plan')::uuid, 'Bier', true)::text);

-- ---- Rechte ------------------------------------------------------------------------------------
select ok(has_function_privilege('anon', 'public.shared_plan_items(text, text)', 'execute'), 'Gäste ohne Konto lesen die Liste');
select ok(has_function_privilege('anon', 'public.guest_claim_plan_item(text, text, uuid, boolean)', 'execute'), 'Gäste ohne Konto übernehmen');
select ok(not has_function_privilege('anon', 'app_private.plan_guest_for_items(text, text, boolean)', 'execute'), 'Prüfung nicht direkt aufrufbar');
select ok(not has_function_privilege('anon', 'public.claim_plan_item(uuid, boolean)', 'execute'), 'anon nimmt nicht die Mitglieder-Funktion');
select ok(not has_function_privilege('anon', 'public.claim_plan_guest(uuid, text, boolean)', 'execute'), 'anon übernimmt keine Gast-Antwort');

-- ---- Eingaben und Angriffe ------------------------------------------------------------------------------------
select tests.login_anon();
select throws_ok($$ select public.shared_plan_items('falsch', repeat('e', 64)) $$, 'P0001', 'share_not_found', 'unbekannter Link');
select throws_ok($$ select public.shared_plan_items(tests.var('token'), repeat('e', 64)) $$, 'P0001', 'plan_items_guest_no_answer',
  'ohne Gast-Antwort keine Liste');
select throws_ok($$ select public.shared_plan_items(tests.var('token'), 'kurz') $$, 'P0001', 'invalid_input', 'Geheimnis im falschen Format');
select throws_ok($$ select public.guest_claim_plan_item(tests.var('token'), repeat('e', 64), tests.var('kohle')::uuid, true) $$, 'P0001',
  'plan_items_guest_no_answer', 'ohne Gast-Antwort nichts übernehmen');
select public.guest_rsvp_shared_plan(tests.var('token'), repeat('e', 64), 'Emil', 'declined');
select throws_ok($$ select public.shared_plan_items(tests.var('token'), repeat('e', 64)) $$, 'P0001', 'plan_items_guest_no_answer',
  'bei „Kann nicht“ keine Liste');
select public.guest_rsvp_shared_plan(tests.var('token'), repeat('e', 64), 'Emil', 'maybe');
select is(jsonb_array_length(public.shared_plan_items(tests.var('token'), repeat('e', 64)) -> 'items'), 3, 'bei „Vielleicht“ sieht Emil drei Sachen');
select is(tests.item_state(repeat('e', 64), 'Bier'), 'taken', 'Bier bringt schon jemand');
select is((select count(*)::int from jsonb_array_elements(public.shared_plan_items(tests.var('token'), repeat('e', 64)) -> 'items') e
           where e ? 'id' and e ? 'label' and e ? 'state'), 3, 'je Sache id, Name und Stand');
select ok(position('Bob' in public.shared_plan_items(tests.var('token'), repeat('e', 64))::text) = 0, 'keine Namen der Crew');
select ok((public.shared_plan_items(tests.var('token'), repeat('e', 64)) ->> 'open')::boolean, 'Zusagen über den Link offen');
select throws_ok($$ select public.guest_claim_plan_item(tests.var('token'), repeat('e', 64), tests.var('bier')::uuid, true) $$, 'P0001',
  'plan_item_taken', 'vergebene Sache nicht übernehmen');
select throws_ok($$ select public.guest_claim_plan_item(tests.var('token'), repeat('e', 64), tests.var('bier')::uuid, false) $$, 'P0001',
  'plan_item_taken', 'fremde Sache nicht freigeben');
select throws_ok($$ select public.guest_claim_plan_item(tests.var('token'), repeat('e', 64), null, true) $$, 'P0001', 'invalid_input', 'ohne Sache');
select throws_ok($$ select public.guest_claim_plan_item(tests.var('token'), repeat('e', 64), tests.var('kohle')::uuid, null) $$, 'P0001',
  'invalid_input', 'ohne Richtung');
select throws_ok($$ update public.plan_items set claimed_by_guest = null $$, '42501', null, 'anon schreibt nicht direkt');

-- Sache aus einem fremden Plan über den eigenen Link: gibt es für den Link nicht.
select tests.login('mallory');
select tests.set_var('fremd_plan', public.create_plan((select id from public.crews where name = 'Fremde Crew'), 'Fremd', now() + interval '2 days')::text);
select tests.set_var('fremd', public.add_plan_item(tests.var('fremd_plan')::uuid, 'Fremdes Zeug')::text);
select tests.login_anon();
select throws_ok($$ select public.guest_claim_plan_item(tests.var('token'), repeat('e', 64), tests.var('fremd')::uuid, true) $$, '42501', null,
  'Sache eines anderen Plans nicht über diesen Link');

-- Mitglieder nehmen die App, auch Außenstehende mit Konto sehen nichts ohne Gast-Antwort.
select tests.login('carol');
select throws_ok($$ select public.shared_plan_items(tests.var('token'), repeat('c', 64)) $$, 'P0001', 'plan_guest_member', 'Mitglieder nehmen die App');
select throws_ok($$ select public.guest_claim_plan_item(tests.var('token'), repeat('c', 64), tests.var('kohle')::uuid, true) $$, 'P0001',
  'plan_guest_member', 'Mitglieder übernehmen nicht als Gast');
select tests.login('mallory');
select throws_ok($$ select public.shared_plan_items(tests.var('token'), repeat('a', 64)) $$, 'P0001', 'plan_items_guest_no_answer',
  'Außenstehende ohne Gast-Antwort sehen nichts');
select is((select count(*)::int from public.plan_items where plan_id = tests.var('plan')::uuid), 0, 'Außenstehende lesen die Liste nicht direkt');
select tests.logout();
select is((select count(*)::int from public.plan_items where plan_id = tests.var('plan')::uuid and claimed_by_guest is not null), 0,
  'nach den Angriffen nichts bei einem Gast');

-- ---- Übernehmen und Freigeben ------------------------------------------------------------------------------------
select tests.login_anon();
select lives_ok($$ select public.guest_claim_plan_item(tests.var('token'), repeat('e', 64), tests.var('kohle')::uuid, true) $$, 'Emil bringt die Kohle');
select lives_ok($$ select public.guest_claim_plan_item(tests.var('token'), repeat('e', 64), tests.var('kohle')::uuid, true) $$, 'noch einmal: bleibt so');
select is(tests.item_state(repeat('e', 64), 'Kohle'), 'mine', 'Kohle ist Emils');
select public.guest_rsvp_shared_plan(tests.var('token'), repeat('f', 64), 'Fritz', 'going');
select is(tests.item_state(repeat('f', 64), 'Kohle'), 'taken', 'für Fritz ist die Kohle vergeben');
select throws_ok($$ select public.guest_claim_plan_item(tests.var('token'), repeat('f', 64), tests.var('kohle')::uuid, true) $$, 'P0001',
  'plan_item_taken', 'Fritz bekommt die Kohle nicht');
select throws_ok($$ select public.guest_claim_plan_item(tests.var('token'), repeat('f', 64), tests.var('kohle')::uuid, false) $$, 'P0001',
  'plan_item_taken', 'Fritz gibt Emils Kohle nicht frei');

select tests.login('carol');
select is((select g.display_name from public.plan_items i join public.plan_guests g on g.id = i.claimed_by_guest
           where i.id = tests.var('kohle')::uuid), 'Emil', 'die Crew sieht: Emil (Gast) bringt die Kohle');
select throws_ok($$ select public.claim_plan_item(tests.var('kohle')::uuid, true) $$, 'P0001', 'plan_item_taken', 'Carol bekommt die Kohle nicht');
select throws_ok($$ select public.claim_plan_item(tests.var('kohle')::uuid, false) $$, 'P0001', 'plan_item_taken', 'Carol gibt Emils Kohle nicht frei');
select throws_ok($$ update public.plan_items set claimed_by_guest = null $$, '42501', null, 'Mitglieder schreiben nicht direkt');

select tests.login_anon();
select lives_ok($$ select public.guest_claim_plan_item(tests.var('token'), repeat('e', 64), tests.var('kohle')::uuid, false) $$, 'Emil: doch nicht');
select tests.logout();
select ok((select claimed_by_guest is null and claimed_at is null from public.plan_items where id = tests.var('kohle')::uuid), 'Kohle wieder offen');

-- „Kann nicht“ gibt frei.
select tests.login_anon();
select public.guest_claim_plan_item(tests.var('token'), repeat('f', 64), tests.var('chips')::uuid, true);
select public.guest_rsvp_shared_plan(tests.var('token'), repeat('f', 64), 'Fritz', 'declined');
select tests.logout();
select ok((select claimed_by_guest is null and claimed_at is null from public.plan_items where id = tests.var('chips')::uuid), '„Kann nicht“: Chips wieder offen');

-- Zurückziehen gibt frei.
select tests.login_anon();
select public.guest_rsvp_shared_plan(tests.var('token'), repeat('f', 64), 'Fritz', 'going');
select public.guest_claim_plan_item(tests.var('token'), repeat('f', 64), tests.var('chips')::uuid, true);
select public.guest_rsvp_shared_plan(tests.var('token'), repeat('f', 64), null, null);
select tests.logout();
select ok((select claimed_by_guest is null and claimed_at is null from public.plan_items where id = tests.var('chips')::uuid), 'zurückgezogen: Chips wieder offen');

-- Entfernen durch Bob gibt frei.
select tests.login_anon();
select public.guest_rsvp_shared_plan(tests.var('token'), repeat('d', 64), 'Dana', 'going');
select public.guest_claim_plan_item(tests.var('token'), repeat('d', 64), tests.var('chips')::uuid, true);
select tests.login('bob');
select public.remove_plan_guest((select id from public.plan_guests where display_name = 'Dana'));
select ok((select claimed_by_guest is null and claimed_at is null from public.plan_items where id = tests.var('chips')::uuid), 'Gast entfernt: Chips wieder offen');

-- ---- Übernahme ins Konto ------------------------------------------------------------------------------------
select tests.login_anon();
select public.guest_claim_plan_item(tests.var('token'), repeat('e', 64), tests.var('kohle')::uuid, true);
select tests.login('gina');
select public.accept_crew_invitation(tests.var('invite'));
select is(public.claim_plan_guest(tests.var('plan')::uuid, repeat('e', 64), true) ->> 'status', 'maybe', 'Gina übernimmt Emils „Vielleicht“');
select is((select claimed_by from public.plan_items where id = tests.var('kohle')::uuid), auth.uid(), 'die Kohle bringt jetzt Gina');
select lives_ok($$ select public.claim_plan_item(tests.var('kohle')::uuid, false) $$, 'Gina kann sie als Mitglied freigeben');
select tests.logout();
select ok((select claimed_by is null and claimed_by_guest is null from public.plan_items where id = tests.var('kohle')::uuid), 'Kohle wieder offen');

-- Wer die Gast-Antwort löscht, gibt die Sachen frei.
select tests.login_anon();
select public.guest_rsvp_shared_plan(tests.var('token'), repeat('9', 64), 'Hanna', 'going');
select public.guest_claim_plan_item(tests.var('token'), repeat('9', 64), tests.var('chips')::uuid, true);
select tests.login('gina');
select is(public.claim_plan_guest(tests.var('plan')::uuid, repeat('9', 64), false) ->> 'claimed', 'false', 'Gast-Antwort gelöscht');
select tests.logout();
select ok((select claimed_by is null and claimed_by_guest is null from public.plan_items where id = tests.var('chips')::uuid), 'gelöscht: Chips wieder offen');

-- ---- Gesperrt ------------------------------------------------------------------------------------
select tests.login_anon();
select public.guest_rsvp_shared_plan(tests.var('token'), repeat('8', 64), 'Ida', 'going');
select tests.login('bob');
select public.set_plan_guests(tests.var('plan')::uuid, false);
select tests.login_anon();
select throws_ok($$ select public.shared_plan_items(tests.var('token'), repeat('8', 64)) $$, 'P0001', 'plan_guests_off', 'ohne Freigabe keine Liste');
select throws_ok($$ select public.guest_claim_plan_item(tests.var('token'), repeat('8', 64), tests.var('chips')::uuid, true) $$, 'P0001',
  'plan_guests_off', 'ohne Freigabe nichts übernehmen');
select tests.login('bob');
select public.set_plan_guests(tests.var('plan')::uuid, true);
select tests.logout();
update public.plans set starts_at = now() - interval '1 hour' where id = tests.var('plan')::uuid;
select tests.login_anon();
select ok(not (public.shared_plan_items(tests.var('token'), repeat('8', 64)) ->> 'open')::boolean, 'nach Beginn: Liste nur noch zum Lesen');
select throws_ok($$ select public.guest_claim_plan_item(tests.var('token'), repeat('8', 64), tests.var('chips')::uuid, true) $$, 'P0001',
  'plan_guests_started', 'nach Beginn nichts mehr übernehmen');
select tests.logout();
update public.plans set starts_at = now() + interval '1 day', status = 'cancelled' where id = tests.var('plan')::uuid;
select tests.login_anon();
select throws_ok($$ select public.guest_claim_plan_item(tests.var('token'), repeat('8', 64), tests.var('chips')::uuid, true) $$, 'P0001',
  'plan_locked', 'abgesagt: gesperrt');

select * from finish();
rollback;
