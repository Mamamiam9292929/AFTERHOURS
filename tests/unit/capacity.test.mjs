// P26 · „Nur 6 Plätze“ – Höchstzahl mit Nachrückliste (src/lib/capacity.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { capacityOptions, spotsLeft, waitlist, waitlistPosition } from "../../src/lib/capacity.ts";

const now = new Date("2026-11-05T12:00:00Z");
const plan = (extra) => ({ max_going: 6, status: "confirmed", starts_at: "2026-11-07T19:00:00Z", ...extra });

test("freie Plätze, voll, darüber", () => {
  assert.equal(spotsLeft(plan(), 4, now), 2);
  assert.equal(spotsLeft(plan(), 0, now), 6);
  assert.equal(spotsLeft(plan(), 6, now), 0, "genau voll");
  assert.equal(spotsLeft(plan(), 7, now), 0, "mehr als Plätze (z. B. vor der Grenze zugesagt) bleibt 0");
  assert.equal(spotsLeft(plan(), -1, now), 6, "unsinnige Zahl zählt als 0");
});

test("keine Anzeige ohne Höchstzahl, nach Beginn, abgesagt, vorbei", () => {
  assert.equal(spotsLeft(plan({ max_going: null }), 2, now), null);
  assert.equal(spotsLeft(plan({ max_going: undefined }), 2, now), null);
  assert.equal(spotsLeft(plan({ starts_at: "2026-11-05T12:00:00Z" }), 1, now), null, "beginnt genau jetzt");
  assert.equal(spotsLeft(plan({ status: "cancelled" }), 1, now), null);
  assert.equal(spotsLeft(plan({ status: "completed" }), 1, now), null);
  assert.equal(spotsLeft(plan({ status: "proposed" }), 1, now), 5, "auch vorgeschlagene Pläne");
});

test("Nachrückliste in Reihenfolge, Gleichstand nach Kennung", () => {
  const participants = [
    { user_id: "c", waitlisted_at: "2026-11-05T10:02:00Z" },
    { user_id: "a", waitlisted_at: null },
    { user_id: "b", waitlisted_at: "2026-11-05T10:01:00Z" },
    { user_id: "e", waitlisted_at: "2026-11-05T10:02:00Z" },
    { user_id: "d" },
  ];
  assert.deepEqual(waitlist(participants).map((p) => p.user_id), ["b", "c", "e"]);
  assert.equal(waitlistPosition(participants, "b"), 1);
  assert.equal(waitlistPosition(participants, "e"), 3);
  assert.equal(waitlistPosition(participants, "a"), null, "nicht auf der Liste");
  assert.equal(waitlistPosition([], "a"), null);
  assert.equal(participants[0].user_id, "c", "die Eingabe bleibt unverändert");
});

test("Wahl der Höchstzahl: nie unter Zusagen oder Mindestzahl", () => {
  assert.deepEqual(capacityOptions(1, null, null), [2, 4, 5, 6, 8, 10, 12, 16, 20], "ab 2");
  assert.deepEqual(capacityOptions(7, null, null), [7, 8, 10, 12, 16, 20], "7 haben zugesagt: ab 7");
  assert.deepEqual(capacityOptions(3, 6, null), [6, 8, 10, 12, 16, 20], "Mindestzahl 6: ab 6");
  assert.deepEqual(capacityOptions(3, null, 30), [3, 4, 5, 6, 8, 10, 12, 16, 20, 30], "gespeicherte Zahl bleibt wählbar");
  assert.deepEqual(capacityOptions(25, null, null), [25], "viele Zusagen: nur die eigene Zahl");
  assert.deepEqual(capacityOptions(60, null, null), [], "über 50 geht nicht");
});
