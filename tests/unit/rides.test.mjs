// P36 · „Wer fährt?“ – Mitfahrende je Auto und „Noch ohne Platz im Auto“ (src/lib/rides.ts, Typen entfernt Node selbst).
import assert from "node:assert/strict";
import { test } from "node:test";
import { canRide, rideFreeSeats, ridePassengers, withoutRide } from "../../src/lib/rides.ts";

const req = (passenger_user_id, status, seats_requested = 1) => ({ passenger_user_id, status, seats_requested });
const offer = (id, driver_user_id, available_seats, requests = [], status = "open") => ({ id, driver_user_id, status, available_seats, requests });
const p = (user_id, attendance_status, waitlisted_at = null) => ({ user_id, attendance_status, waitlisted_at });

test("Mitfahrende: nur bestätigte, in der Reihenfolge der Anfragen", () => {
  const o = offer("a", "alice", 3, [req("bob", "accepted"), req("carol", "requested"), req("dana", "accepted"), req("eve", "declined"), req("finn", "cancelled")]);
  assert.deepEqual(ridePassengers(o), ["bob", "dana"]);
});

test("freie Plätze zählen die bestätigten Plätze und fallen nie unter null", () => {
  assert.equal(rideFreeSeats(offer("a", "alice", 3, [req("bob", "accepted", 2), req("carol", "requested", 1)])), 1);
  assert.equal(rideFreeSeats(offer("a", "alice", 1, [req("bob", "accepted", 2)])), 0);
  assert.equal(rideFreeSeats(offer("a", "alice", 4)), 4);
});

test("ohne offenes Angebot ist niemand „ohne Platz“", () => {
  const people = [p("alice", "going"), p("bob", "going")];
  assert.deepEqual(withoutRide([], people), []);
  assert.deepEqual(withoutRide([offer("a", "alice", 2, [], "cancelled")], people), []);
});

test("ohne Platz: dabei vor vielleicht, ohne Fahrende, Mitfahrende, Absagen, Eingeladene und Nachrückliste", () => {
  const offers = [offer("a", "alice", 2, [req("bob", "accepted"), req("carol", "requested")]), offer("b", "zoe", 3, [], "cancelled")];
  const people = [
    p("alice", "going"),
    p("bob", "going"),
    p("mia", "maybe"),
    p("carol", "going"),
    p("dana", "declined"),
    p("eve", "invited"),
    p("finn", "going", "2026-11-10T10:00:00Z"),
    p("zoe", "going"),
  ];
  // Carol hat nur angefragt – noch kein Platz. Zoe hat ihr Angebot zurückgezogen – fährt also nicht mehr.
  assert.deepEqual(withoutRide(offers, people), ["carol", "zoe", "mia"]);
});

test("alle sitzen: leere Liste", () => {
  const offers = [offer("a", "alice", 2, [req("bob", "accepted")])];
  assert.deepEqual(withoutRide(offers, [p("alice", "going"), p("bob", "maybe")]), []);
});

test("Fahrten nur ohne Absage – ohne Antwort und mit Vielleicht geht es", () => {
  const people = [p("alice", "going"), p("bob", "declined"), p("mia", "maybe")];
  assert.equal(canRide(people, "alice"), true);
  assert.equal(canRide(people, "mia"), true);
  assert.equal(canRide(people, "bob"), false);
  assert.equal(canRide(people, "neu"), true);
});
