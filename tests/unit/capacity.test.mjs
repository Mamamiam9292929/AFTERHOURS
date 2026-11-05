// P26 · „Nur 6 Plätze“ – Höchstzahl mit Nachrückliste (src/lib/capacity.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { capacityOptions, joinsWaitlist, planWaitlist, spotsLeft, waitingGuests, waitlist, waitlistPosition } from "../../src/lib/capacity.ts";

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

test("Etappe 3b: gemeinsame Liste mit Gästen – Reihenfolge wie auf dem Server", () => {
  const participants = [
    { user_id: "m2", waitlisted_at: "2026-11-05T10:03:00Z" },
    { user_id: "m1", waitlisted_at: "2026-11-05T10:01:00Z" },
    { user_id: "x", waitlisted_at: null },
  ];
  const guests = [
    { id: "g2", display_name: "Fritz", waitlisted_at: "2026-11-05T10:03:00Z" },
    { id: "g1", display_name: "Dana", waitlisted_at: "2026-11-05T10:02:00Z" },
    { id: "g0", display_name: "Emil", waitlisted_at: null },
  ];
  const queue = planWaitlist(participants, guests);
  assert.deepEqual(queue.map((e) => `${e.kind}:${e.key}`), ["member:m1", "guest:g1", "member:m2", "guest:g2"], "Zeit, bei Gleichstand Mitglied zuerst");
  assert.equal(queue[1].entry.display_name, "Dana", "Eintrag bleibt erhalten");
  assert.equal(waitlistPosition(participants, "m2", guests), 3, "der Gast davor zählt mit");
  assert.equal(waitlistPosition(participants, "m2"), 2, "ohne Gäste wie bisher");
  assert.equal(waitlistPosition(participants, "g1", guests), null, "Gäste sind keine Mitglieder");
  assert.deepEqual(waitlist(participants).map((p) => p.user_id), ["m1", "m2"], "nur die Crew");
});

test("Etappe 3b: Gäste zählen nur, solange Zusagen über den Link an sind", () => {
  const guests = [{ id: "g1", waitlisted_at: "2026-11-05T10:02:00Z" }];
  assert.deepEqual(waitingGuests({ guests_allowed: true, guests }), guests);
  assert.deepEqual(waitingGuests({ guests_allowed: false, guests }), []);
  assert.deepEqual(waitingGuests({ guests_allowed: true }), [], "ohne geladene Gäste");
});

test("Wahl der Höchstzahl: nie unter Zusagen oder Mindestzahl", () => {
  assert.deepEqual(capacityOptions(1, null, null), [2, 4, 5, 6, 8, 10, 12, 16, 20], "ab 2");
  assert.deepEqual(capacityOptions(7, null, null), [7, 8, 10, 12, 16, 20], "7 haben zugesagt: ab 7");
  assert.deepEqual(capacityOptions(3, 6, null), [6, 8, 10, 12, 16, 20], "Mindestzahl 6: ab 6");
  assert.deepEqual(capacityOptions(3, null, 30), [3, 4, 5, 6, 8, 10, 12, 16, 20, 30], "gespeicherte Zahl bleibt wählbar");
  assert.deepEqual(capacityOptions(25, null, null), [25], "viele Zusagen: nur die eigene Zahl");
  assert.deepEqual(capacityOptions(60, null, null), [], "über 50 geht nicht");
});

test("Etappe 3a: „Bin dabei“ wird zu „Nachrücken“ – nur voll und nicht schon dabei", () => {
  assert.equal(joinsWaitlist(plan(), "invited", 6, now), true, "voll, Antwort offen");
  assert.equal(joinsWaitlist(plan(), null, 7, now), true, "über voll, ohne Zeile");
  assert.equal(joinsWaitlist(plan(), "maybe", 6, now), true, "vielleicht (oder schon auf der Liste)");
  assert.equal(joinsWaitlist(plan(), "going", 6, now), false, "wer dabei ist, behält „Bin dabei“");
  assert.equal(joinsWaitlist(plan(), "invited", 5, now), false, "noch ein Platz frei");
  assert.equal(joinsWaitlist(plan({ max_going: null }), "invited", 9, now), false, "ohne Höchstzahl");
  assert.equal(joinsWaitlist(plan({ starts_at: "2026-11-05T11:00:00Z" }), "invited", 6, now), false, "nach Beginn keine Liste");
  assert.equal(joinsWaitlist(plan({ status: "cancelled" }), "invited", 6, now), false, "abgesagt");
});
