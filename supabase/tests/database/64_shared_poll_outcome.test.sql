-- P28: Nach dem Ende zeigt der Abstimm-Link Gästen, was draus wurde – Gewinner, Plan, Stichwahl.
-- Teilen-Links nur für Gäste, die mitgestimmt haben, und nur, wenn die Crew sie schon erzeugt hat.
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

select tests.login('alice');
select tests.set_var('poll', public.create_poll(
  tests.var('crew')::uuid, 'Was machen wir am Samstag?', now() + interval '2 days',
  jsonb_build_array(
    jsonb_build_object('title', 'Strike Bowling', 'proposed_date', '2031-06-14', 'proposed_time', '19:30'),
    jsonb_build_object('title', 'Kino')),
  p_meeting_point => 'Hinterhof Tür 3')::text);
select tests.set_var('token', public.poll_share_token(tests.var('poll')::uuid));
select public.set_poll_guests(tests.var('poll')::uuid, true);
select tests.set_var('opt1', (select id::text from public.poll_options where poll_id = tests.var('poll')::uuid and position = 1));

select tests.set_var('carla', repeat('c', 64));
select tests.set_var('nobody', repeat('e', 64));

-- ---- Läuft: kein Ergebnis ---------------------------------------------------------------------------
select tests.login_anon();
select lives_ok($$ select public.guest_vote_shared_poll(tests.var('token'), tests.var('carla'), 'Carla', '{"1": "yes"}') $$, 'Carla stimmt als Gast ab');
select ok(public.shared_poll_ballot(tests.var('token'), tests.var('carla')) -> 'outcome' = 'null'::jsonb, 'solange sie läuft: kein Ergebnis');

-- ---- Entschieden, noch kein Plan --------------------------------------------------------------------
select tests.login('alice');
select public.cast_vote(tests.var('opt1')::uuid, 'yes');
select public.close_poll(tests.var('poll')::uuid);
select tests.login_anon();
select tests.set_var('b', public.shared_poll_ballot(tests.var('token'), tests.var('carla'))::text);
select is(tests.var('b')::jsonb #>> '{outcome,winner}', '1', 'Gewinner als Position, keine ID');
select is(tests.var('b')::jsonb #>> '{outcome,tie}', 'false', 'kein Gleichstand');
select ok(tests.var('b')::jsonb #> '{outcome,plan}' = 'null'::jsonb, 'noch kein Plan');
select ok(tests.var('b')::jsonb #> '{outcome,runoff}' = 'null'::jsonb, 'keine Stichwahl');

-- ---- Plan daraus, noch nicht geteilt -------------------------------------------------------------------
select tests.login('alice');
select tests.set_var('plan', public.create_plan_from_poll(tests.var('poll')::uuid, tests.var('opt1')::uuid,
  p_address => 'Bowlingstraße 1', p_notes => 'Schuhe mitbringen')::text);
select tests.login_anon();
select tests.set_var('b', public.shared_poll_ballot(tests.var('token'), tests.var('carla'))::text);
select is(tests.var('b')::jsonb #>> '{outcome,plan,title}', (select title from public.plans where id = tests.var('plan')::uuid), 'Titel des Plans');
select is((tests.var('b')::jsonb #>> '{outcome,plan,starts_at}')::timestamptz, (select starts_at from public.plans where id = tests.var('plan')::uuid), 'Beginn des Plans');
select is(tests.var('b')::jsonb #>> '{outcome,plan,cancelled}', 'false', 'nicht abgesagt');
select ok(tests.var('b')::jsonb #> '{outcome,plan,token}' = 'null'::jsonb, 'ohne geteilten Plan kein Link – die Abstimmung erzeugt keinen');
select ok(tests.var('b') !~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'das Ergebnis enthält keine einzige ID');
select ok(tests.var('b') !~* '(Hinterhof|Bowlingstraße|Schuhe|Weekend|Alice|Bob|example\.test)',
  'kein Treffpunkt, keine Adresse, keine Notiz, kein Crew-Name, keine Namen der Crew');

-- ---- Plan geteilt: Link nur für Gäste, die mitgestimmt haben -----------------------------------------------
select tests.login('alice');
select tests.set_var('plantoken', public.plan_share_token(tests.var('plan')::uuid));
select tests.login_anon();
select is(public.shared_poll_ballot(tests.var('token'), tests.var('carla')) #>> '{outcome,plan,token}', tests.var('plantoken'), 'Carla bekommt den Teilen-Link des Plans');
select ok(public.shared_poll_ballot(tests.var('token')) #> '{outcome,plan,token}' = 'null'::jsonb, 'ohne Geheimnis kein Link');
select ok(public.shared_poll_ballot(tests.var('token'), tests.var('nobody')) #> '{outcome,plan,token}' = 'null'::jsonb, 'fremdes Geheimnis (nicht abgestimmt): kein Link');
select ok(public.shared_poll_ballot(tests.var('token'), 'kurz') #> '{outcome,plan,token}' = 'null'::jsonb, 'kaputtes Geheimnis: kein Link');
select is(public.shared_poll_ballot(tests.var('token')) #>> '{outcome,plan,title}', (select title from public.plans where id = tests.var('plan')::uuid),
  'Titel und Zeit sieht jede:r mit dem Link – wie die Vorschläge');

-- Außenstehende mit Konto: wie anon.
select tests.login('mallory');
select ok(public.shared_poll_ballot(tests.var('token')) #> '{outcome,plan,token}' = 'null'::jsonb, 'Außenstehende ohne Gast-Stimme: kein Link');
select throws_ok('select * from public.plan_share_links', '42501', null, 'Außenstehende lesen Teilen-Links nicht direkt');

-- ---- Abgesagt: Hinweis, kein Link ------------------------------------------------------------------------
select tests.login('alice');
select public.set_plan_status(tests.var('plan')::uuid, 'cancelled');
select tests.login_anon();
select tests.set_var('b', public.shared_poll_ballot(tests.var('token'), tests.var('carla'))::text);
select is(tests.var('b')::jsonb #>> '{outcome,plan,cancelled}', 'true', 'abgesagt steht drin');
select ok(tests.var('b')::jsonb #> '{outcome,plan,token}' = 'null'::jsonb, 'abgesagt: kein Link mehr');

-- ---- Gleichstand: Stichwahl -------------------------------------------------------------------------------
select tests.login('alice');
select tests.set_var('tie', public.create_poll(tests.var('crew')::uuid, 'Und Sonntag?', now() + interval '2 days',
  '[{"title":"Brunch"},{"title":"See"}]')::text);
select tests.set_var('tietoken', public.poll_share_token(tests.var('tie')::uuid));
select public.set_poll_guests(tests.var('tie')::uuid, true);
select public.cast_vote((select id from public.poll_options where poll_id = tests.var('tie')::uuid and position = 1), 'yes');
select tests.login_anon();
select public.guest_vote_shared_poll(tests.var('tietoken'), tests.var('carla'), 'Carla', '{"2": "yes"}');
select tests.login('alice');
select public.close_poll(tests.var('tie')::uuid);
select tests.login_anon();
select tests.set_var('b', public.shared_poll_ballot(tests.var('tietoken'), tests.var('carla'))::text);
select is(tests.var('b')::jsonb #>> '{outcome,tie}', 'true', 'Gleichstand');
select ok(tests.var('b')::jsonb #> '{outcome,winner}' = 'null'::jsonb, 'kein Gewinner');
select ok(tests.var('b')::jsonb #> '{outcome,runoff}' = 'null'::jsonb, 'noch keine Stichwahl');

select tests.login('alice');
select tests.set_var('runoff', public.start_runoff_poll(tests.var('tie')::uuid, 'Stichwahl Sonntag', now() + interval '1 day')::text);
select public.set_poll_guests(tests.var('runoff')::uuid, true);
select tests.login_anon();
select is(public.shared_poll_ballot(tests.var('tietoken'), tests.var('carla')) #>> '{outcome,runoff,open}', 'true', 'Stichwahl läuft');
select ok(public.shared_poll_ballot(tests.var('tietoken'), tests.var('carla')) #> '{outcome,runoff,token}' = 'null'::jsonb, 'Stichwahl nicht geteilt: kein Link');

select tests.login('alice');
select tests.set_var('runofftoken', public.poll_share_token(tests.var('runoff')::uuid));
select tests.login_anon();
select is(public.shared_poll_ballot(tests.var('tietoken'), tests.var('carla')) #>> '{outcome,runoff,token}', tests.var('runofftoken'), 'Carla bekommt den Link zur Stichwahl');
select ok(public.shared_poll_ballot(tests.var('tietoken'), tests.var('nobody')) #> '{outcome,runoff,token}' = 'null'::jsonb, 'fremdes Geheimnis: kein Stichwahl-Link');

select tests.login('alice');
select public.set_poll_guests(tests.var('runoff')::uuid, false);
select tests.login_anon();
select ok(public.shared_poll_ballot(tests.var('tietoken'), tests.var('carla')) #> '{outcome,runoff,token}' = 'null'::jsonb, 'Stichwahl ohne Gäste: kein Link');

-- Aus der Stichwahl wird ein Plan – der ursprüngliche Link zeigt ihn.
select tests.login('alice');
select public.cast_vote((select id from public.poll_options where poll_id = tests.var('runoff')::uuid order by position limit 1), 'yes');
select public.close_poll(tests.var('runoff')::uuid);
select tests.set_var('runoffplan', public.create_plan_from_poll(tests.var('runoff')::uuid,
  (select winning_option_id from public.polls where id = tests.var('runoff')::uuid), p_starts_at => now() + interval '5 days')::text);
select tests.login_anon();
select is(public.shared_poll_ballot(tests.var('tietoken'), tests.var('carla')) #>> '{outcome,plan,title}',
  (select title from public.plans where id = tests.var('runoffplan')::uuid), 'Plan aus der Stichwahl auf dem ursprünglichen Link');
select is(public.shared_poll_ballot(tests.var('tietoken'), tests.var('carla')) #>> '{outcome,runoff,open}', 'false', 'Stichwahl beendet');

-- ---- Rahmen bleibt: ohne Freigabe nichts, Rechte unverändert ------------------------------------------------
select tests.login('alice');
select tests.set_var('off', public.create_poll(tests.var('crew')::uuid, 'Ohne Gäste', now() + interval '2 days', '[{"title":"A"},{"title":"B"}]')::text);
select tests.set_var('offtoken', public.poll_share_token(tests.var('off')::uuid));
select public.close_poll(tests.var('off')::uuid);
select tests.login_anon();
select is(public.shared_poll_ballot(tests.var('offtoken'), tests.var('carla')), '{"status": "guests_off"}'::jsonb, 'ohne Gäste-Freigabe auch nach dem Ende kein Ergebnis');
select ok(has_function_privilege('anon', 'public.shared_poll_ballot(text, text)', 'execute'), 'anon darf den Stimmzettel weiter abrufen');

select * from finish();
rollback;
