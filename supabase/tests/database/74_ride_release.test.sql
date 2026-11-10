-- P36: „Wer fährt?“ – „Kann nicht“ gibt Fahrten frei, wer abgesagt hat, fährt nicht mit und bietet nichts an, und wer
-- eine bestätigte Mitfahrt zurückzieht, sagt es der fahrenden Person.
begin;
\ir helpers.inc
select no_plan();

select tests.make_user('Alice');   -- fährt
select tests.make_user('Bob');     -- fährt mit
select tests.make_user('Carol');   -- fährt mit
select tests.make_user('Dana');    -- fährt auch
select tests.make_user('Mallory'); -- Außenstehende

select tests.login('alice');
select tests.set_var('crew', public.create_crew('Kart Crew')::text);
select tests.set_var('token', (select token from public.create_crew_invitation(tests.var('crew')::uuid)));
select tests.login('bob');   select public.accept_crew_invitation(tests.var('token'));
select tests.login('carol'); select public.accept_crew_invitation(tests.var('token'));
select tests.login('dana');  select public.accept_crew_invitation(tests.var('token'));
select tests.login('mallory'); select public.create_crew('Fremde Crew');

select tests.login('alice');
select tests.set_var('plan', public.create_plan(tests.var('crew')::uuid, 'Kartbahn am Stadtrand', now() + interval '3 days', p_confirmed => true)::text);
select public.set_attendance(tests.var('plan')::uuid, 'going');
select tests.set_var('offer', public.create_ride_offer(tests.var('plan')::uuid, 'Bahnhof Ostkreuz', now() + interval '3 days' - interval '30 minutes', 3)::text);

-- ---- Rechte: keine neue öffentliche Funktion, interne Funktionen gesperrt ------------------------------------
select ok(not has_function_privilege('authenticated', 'app_private.drop_ride_request(uuid)', 'execute'), 'drop_ride_request ist intern');
select ok(not has_function_privilege('authenticated', 'app_private.has_declined_plan(uuid, uuid)', 'execute'), 'has_declined_plan ist intern');
select ok(not has_function_privilege('anon', 'public.request_ride(uuid, integer)', 'execute'), 'anon fragt keine Fahrt an');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.cancel_ride_request(uuid)'::regprocedure),
  'cancel_ride_request bleibt SECURITY DEFINER mit leerem search_path');

-- ---- Angriffe von außen ----------------------------------------------------------------------------------------
select tests.login_anon();
select throws_ok(format($$ select public.request_ride(%L) $$, tests.var('offer')), '42501', null, 'anon scheitert');
select tests.login('mallory');
select throws_ok(format($$ select public.request_ride(%L) $$, tests.var('offer')), '42501', 'forbidden', 'Außenstehende fragen nicht an');
select throws_ok(format($$ select public.set_attendance(%L, 'declined') $$, tests.var('plan')), '42501', 'forbidden', 'Außenstehende sagen nicht ab');
select is((select count(*)::int from public.ride_offers) + (select count(*)::int from public.ride_requests), 0, 'Außenstehende sehen keine Fahrten');

-- ---- Mitfahrerin sagt ab: bestätigter Platz wird frei, die Fahrerin erfährt es ---------------------------------
select tests.login('bob');
select public.set_attendance(tests.var('plan')::uuid, 'going');
select tests.set_var('req_bob', public.request_ride(tests.var('offer')::uuid)::text);
select tests.login('carol');
select public.set_attendance(tests.var('plan')::uuid, 'maybe');
select tests.set_var('req_carol', public.request_ride(tests.var('offer')::uuid)::text);
select tests.login('alice');
select public.respond_ride_request(tests.var('req_bob')::uuid, true);

select tests.login('bob');
select public.set_attendance(tests.var('plan')::uuid, 'maybe');
select is((select status::text from public.ride_requests where id = tests.var('req_bob')::uuid), 'accepted', '„Vielleicht“ behält den Platz');
select public.set_attendance(tests.var('plan')::uuid, 'declined');
select is((select status::text from public.ride_requests where id = tests.var('req_bob')::uuid), 'cancelled', '„Kann nicht“ gibt Bobs Platz frei');
select tests.logout();
select is((select count(*)::int from public.notifications
           where type = 'ride_request' and user_id = tests.uid('alice') and actor_id = tests.uid('bob') and (payload ->> 'cancelled')::boolean),
  1, 'Alice erfährt: Bob fährt doch nicht mit');

select tests.login('bob');
select public.set_attendance(tests.var('plan')::uuid, 'declined');
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'ride_request' and user_id = tests.uid('alice') and (payload ->> 'cancelled')::boolean),
  1, 'eine zweite Absage meldet nichts doppelt');

-- ---- Wer abgesagt hat, fragt nicht an und bietet nichts an ---------------------------------------------------------
select tests.login('bob');
select throws_ok(format($$ select public.request_ride(%L) $$, tests.var('offer')), 'P0001', 'ride_after_decline', 'Bob (abgesagt) fragt keine Fahrt an');
select throws_ok(format($$ select public.create_ride_offer(%L, 'Bahnhof Lichtenberg', now() + interval '3 days', 2) $$, tests.var('plan')),
  'P0001', 'ride_after_decline', 'Bob (abgesagt) bietet keine Fahrt an');
select public.set_attendance(tests.var('plan')::uuid, 'going');
select lives_ok(format($$ select public.request_ride(%L) $$, tests.var('offer')), 'nach neuer Zusage fragt Bob wieder an');
select is((select status::text from public.ride_requests where id = tests.var('req_bob')::uuid), 'requested', 'dieselbe Anfrage, wieder offen');

-- Nur angefragt: verschwindet still.
select public.set_attendance(tests.var('plan')::uuid, 'declined');
select is((select status::text from public.ride_requests where id = tests.var('req_bob')::uuid), 'cancelled', 'auch eine offene Anfrage wird frei');
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'ride_request' and user_id = tests.uid('alice') and (payload ->> 'cancelled')::boolean),
  1, 'eine nur angefragte Mitfahrt meldet beim Absagen nichts');

-- ---- Zurückziehen von Hand: bestätigt → Fahrerin erfährt es ---------------------------------------------------------
select tests.login('alice');
select public.respond_ride_request(tests.var('req_carol')::uuid, true);
select tests.login('bob');
select throws_ok(format($$ select public.cancel_ride_request(%L) $$, tests.var('req_carol')), '42501', 'forbidden', 'fremde Anfrage zieht niemand zurück');
select tests.login('carol');
select lives_ok(format($$ select public.cancel_ride_request(%L) $$, tests.var('req_carol')), 'Carol zieht ihre bestätigte Mitfahrt zurück');
select throws_ok(format($$ select public.cancel_ride_request(%L) $$, tests.var('req_carol')), '42501', 'forbidden', 'zweimal zurückziehen geht nicht');
select tests.logout();
select is((select count(*)::int from public.notifications
           where type = 'ride_request' and user_id = tests.uid('alice') and actor_id = tests.uid('carol') and (payload ->> 'cancelled')::boolean),
  1, 'Alice erfährt: Carol fährt doch nicht mit');

-- ---- Fahrerin sagt ab: Angebot weg, alle Mitfahrenden erfahren es -------------------------------------------------
select tests.login('carol');
select tests.set_var('req_carol', public.request_ride(tests.var('offer')::uuid)::text);
select tests.login('dana');
select public.set_attendance(tests.var('plan')::uuid, 'going');
select tests.set_var('req_dana', public.request_ride(tests.var('offer')::uuid)::text);
select tests.login('alice');
select public.respond_ride_request(tests.var('req_dana')::uuid, true);
select public.set_attendance(tests.var('plan')::uuid, 'declined');
select is((select status::text from public.ride_offers where id = tests.var('offer')::uuid), 'cancelled', 'Alices Angebot ist zurückgezogen');
select is((select string_agg(status::text, ',' order by status::text) from public.ride_requests where ride_offer_id = tests.var('offer')::uuid
           and passenger_user_id in (tests.uid('carol'), tests.uid('dana'))), 'declined,declined', 'Carols und Danas Mitfahrt sind beendet');
select is((select status::text from public.ride_requests where id = tests.var('req_bob')::uuid), 'cancelled', 'Bobs alte Anfrage bleibt, wie sie war');
select tests.logout();
select is((select count(*)::int from public.notifications where type = 'ride_confirmed' and related_entity_id = tests.var('plan')::uuid
           and actor_id = tests.uid('alice') and not (payload ->> 'accepted')::boolean and user_id in (tests.uid('carol'), tests.uid('dana'))),
  2, 'Carol (angefragt) und Dana (bestätigt) erfahren: Alice kann sie nicht mitnehmen');
select is((select count(*)::int from public.notifications where type = 'ride_request' and actor_id = tests.uid('alice')), 0,
  'Alice meldet sich nicht selbst als Mitfahrerin ab');

-- Wieder zugesagt: Alice kann neu anbieten, das Angebot ist wieder offen.
select tests.login('alice');
select public.set_attendance(tests.var('plan')::uuid, 'going');
select lives_ok(format($$ select public.create_ride_offer(%L, 'Bahnhof Ostkreuz', now() + interval '3 days', 2) $$, tests.var('plan')), 'Alice bietet wieder an');
select is((select status::text from public.ride_offers where id = tests.var('offer')::uuid), 'open', 'dasselbe Angebot, wieder offen');

-- ---- „Alle neu fragen“ (P23) lässt Fahrten stehen ------------------------------------------------------------------
select tests.login('dana');
select tests.set_var('req_dana', public.request_ride(tests.var('offer')::uuid)::text);
select tests.login('alice');
select public.respond_ride_request(tests.var('req_dana')::uuid, true);
select public.ask_plan_again(tests.var('plan')::uuid);
select is((select status::text from public.ride_requests where id = tests.var('req_dana')::uuid), 'accepted', 'neu gefragt: Danas Platz bleibt');
select is((select status::text from public.ride_offers where id = tests.var('offer')::uuid), 'open', 'neu gefragt: Alices Angebot bleibt');

-- ---- Abgesagter Plan: nichts wird mehr umgeräumt ------------------------------------------------------------------
select public.set_plan_status(tests.var('plan')::uuid, 'cancelled');
select tests.login('dana');
select throws_ok(format($$ select public.set_attendance(%L, 'declined') $$, tests.var('plan')), 'P0001', 'plan_locked', 'abgesagter Plan ist gesperrt');
select tests.logout();
select is((select status::text from public.ride_requests where id = tests.var('req_dana')::uuid), 'accepted', 'Danas Platz bleibt im Verlauf stehen');

-- ---- Erste Antwort „Kann nicht“ (neue Zeile) gibt ebenfalls frei ----------------------------------------------------
select tests.login('alice');
select tests.set_var('plan2', public.create_plan(tests.var('crew')::uuid, 'Badesee', now() + interval '5 days', p_confirmed => true)::text);
select tests.set_var('offer2', public.create_ride_offer(tests.var('plan2')::uuid, 'Hauptbahnhof', now() + interval '5 days', 2)::text);
select tests.login('carol');
select tests.set_var('req2', public.request_ride(tests.var('offer2')::uuid)::text);
select tests.logout();
delete from public.plan_participants where plan_id = tests.var('plan2')::uuid and user_id = tests.uid('carol');
select tests.login('carol');
select public.set_attendance(tests.var('plan2')::uuid, 'declined');
select is((select status::text from public.ride_requests where id = tests.var('req2')::uuid), 'cancelled', 'auch ohne vorherige Zeile gibt „Kann nicht“ frei');

select * from finish();
rollback;
