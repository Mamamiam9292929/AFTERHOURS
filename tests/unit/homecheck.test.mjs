// P31 · „Gut heimgekommen?“ (src/lib/homecheck.ts): wann die Planseite fragt – gleiche Regel wie der Server.
import assert from "node:assert/strict";
import { test } from "node:test";
import { hideHomeCheck, homeCheckOnHomeFrom, homeCheckOpen, homeCheckUntil, homeOrder, planForHomeCheck } from "../../src/lib/homecheck.ts";

const plan = (over = {}) => ({ status: "confirmed", starts_at: "2026-11-06T19:00:00Z", ends_at: null, ...over });
const at = (iso) => new Date(iso);

test("ohne Ende: ab Beginn bis 16 Stunden danach", () => {
  assert.equal(homeCheckOpen(plan(), at("2026-11-06T18:59:59Z")), false, "vor Beginn nicht");
  assert.equal(homeCheckOpen(plan(), at("2026-11-06T19:00:00Z")), true, "ab Beginn (wer früh geht)");
  assert.equal(homeCheckOpen(plan(), at("2026-11-07T01:30:00Z")), true, "mitten in der Nacht");
  assert.equal(homeCheckOpen(plan(), at("2026-11-07T10:59:59Z")), true, "am Vormittag danach noch");
  assert.equal(homeCheckOpen(plan(), at("2026-11-07T11:00:00Z")), false, "danach nicht mehr");
  assert.equal(homeCheckUntil(plan()).toISOString(), "2026-11-07T11:00:00.000Z");
});

test("mit Ende: bis 12 Stunden nach dem Ende", () => {
  const trip = plan({ ends_at: "2026-11-08T17:00:00Z" });
  assert.equal(homeCheckOpen(trip, at("2026-11-08T12:00:00Z")), true, "mehrtägiger Plan läuft noch");
  assert.equal(homeCheckOpen(trip, at("2026-11-09T04:59:59Z")), true);
  assert.equal(homeCheckOpen(trip, at("2026-11-09T05:00:00Z")), false);
  assert.equal(homeCheckUntil(plan({ ends_at: "2026-11-06T18:00:00Z" })).toISOString(), "2026-11-07T11:00:00.000Z", "Ende vor Beginn zählt nicht");
});

test("abgesagt nie, abgeschlossen schon; ungültiger Beginn nie", () => {
  const night = at("2026-11-07T01:00:00Z");
  for (const status of ["proposed", "confirmed", "booking_pending", "booked", "completed"]) assert.equal(homeCheckOpen(plan({ status }), night), true, status);
  assert.equal(homeCheckOpen(plan({ status: "cancelled" }), night), false);
  assert.equal(homeCheckOpen(plan({ starts_at: "kaputt" }), night), false);
  assert.equal(homeCheckUntil(plan({ starts_at: "kaputt" })), null);
});

test("Reihenfolge: eigene Meldung zuerst, dann nach Uhrzeit", () => {
  const home = [
    { user_id: "bob", arrived_at: "2026-11-07T00:40:00Z" },
    { user_id: "me", arrived_at: "2026-11-07T01:10:00Z" },
    { user_id: "carol", arrived_at: "2026-11-07T00:20:00Z" },
  ];
  assert.deepEqual(homeOrder(home, "me").map((h) => h.user_id), ["me", "carol", "bob"]);
  assert.deepEqual(homeOrder(home, "nobody").map((h) => h.user_id), ["carol", "bob", "me"]);
  assert.equal(home[0].user_id, "bob", "Eingabe bleibt unverändert");
});

// P31 Etappe 2 · „Gut heimgekommen?“ auf Home – erst gegen Ende des Abends, nur mit eigener Zusage.
const withMe = (attendance, over = {}) => ({ id: "p1", ...plan(over), participants: [{ user_id: "me", attendance_status: attendance }, { user_id: "bob", attendance_status: "going" }] });

test("Home: ab zwei Stunden vor dem Ende, ohne Ende zwei Stunden nach Beginn, nie vor Beginn", () => {
  assert.equal(homeCheckOnHomeFrom(plan()).toISOString(), "2026-11-06T21:00:00.000Z");
  assert.equal(homeCheckOnHomeFrom(plan({ ends_at: "2026-11-06T23:30:00Z" })).toISOString(), "2026-11-06T21:30:00.000Z");
  assert.equal(homeCheckOnHomeFrom(plan({ ends_at: "2026-11-06T20:00:00Z" })).toISOString(), "2026-11-06T19:00:00.000Z", "kurzer Abend: ab Beginn");
  assert.equal(homeCheckOnHomeFrom(plan({ starts_at: "kaputt" })), null);
  assert.equal(planForHomeCheck([withMe("going")], "me", [], at("2026-11-06T20:59:59Z")), null, "mitten im Abend noch nicht");
  assert.equal(planForHomeCheck([withMe("going")], "me", [], at("2026-11-06T21:00:00Z"))?.id, "p1");
  assert.equal(planForHomeCheck([withMe("going")], "me", [], at("2026-11-07T10:59:59Z"))?.id, "p1", "bis zum Vormittag");
  assert.equal(planForHomeCheck([withMe("going")], "me", [], at("2026-11-07T11:00:00Z")), null, "danach nicht mehr");
});

test("Home: nur mit eigener Zusage, nicht abgesagt, nicht ausgeblendet", () => {
  const night = at("2026-11-07T00:30:00Z");
  assert.equal(planForHomeCheck([withMe("maybe")], "me", [], night)?.id, "p1", "Vielleicht zählt");
  for (const status of ["declined", "invited"]) assert.equal(planForHomeCheck([withMe(status)], "me", [], night), null, status);
  assert.equal(planForHomeCheck([withMe("going")], "carol", [], night), null, "nicht eingeladen");
  assert.equal(planForHomeCheck([withMe("going", { status: "cancelled" })], "me", [], night), null, "abgesagter Plan");
  assert.equal(planForHomeCheck([withMe("going", { status: "completed" })], "me", [], night)?.id, "p1", "schon abgeschlossen");
  assert.equal(planForHomeCheck([withMe("going")], "me", ["p1"], night), null, "ausgeblendet");
});

test("Home: bei mehreren der zuletzt begonnene Abend", () => {
  const early = { ...withMe("going", { starts_at: "2026-11-06T17:00:00Z" }), id: "early" };
  const late = { ...withMe("maybe", { starts_at: "2026-11-06T20:00:00Z" }), id: "late" };
  assert.equal(planForHomeCheck([late, early], "me", [], at("2026-11-07T00:30:00Z"))?.id, "late");
  assert.equal(planForHomeCheck([early, late], "me", ["late"], at("2026-11-07T00:30:00Z"))?.id, "early", "ausgeblendet → der andere");
});

test("Ausblenden merkt sich höchstens 20 Abende, ohne Doppelte", () => {
  let hidden = [];
  for (let i = 0; i < 25; i++) hidden = hideHomeCheck(hidden, `p${i}`);
  assert.equal(hidden.length, 20);
  assert.equal(hidden[0], "p5");
  assert.deepEqual(hideHomeCheck(["a", "b"], "a"), ["b", "a"]);
});
