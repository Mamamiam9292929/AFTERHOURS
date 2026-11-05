// P25 Etappe 2 · „Noch 1 fehlt“ am Ticket und auf der geteilten Karte (src/lib/quorum.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { goingWithGuests, quorumLeft } from "../../src/lib/quorum.ts";

const now = new Date("2026-11-05T12:00:00Z");
const plan = (extra) => ({ min_going: 4, status: "confirmed", starts_at: "2026-11-07T19:00:00Z", ...extra });

test("fehlt noch, erreicht, darüber", () => {
  assert.equal(quorumLeft(plan(), 3, now), 1);
  assert.equal(quorumLeft(plan(), 0, now), 4);
  assert.equal(quorumLeft(plan(), 4, now), 0, "genau erreicht: Findet statt");
  assert.equal(quorumLeft(plan(), 9, now), 0, "mehr als nötig bleibt 0");
  assert.equal(quorumLeft(plan(), -2, now), 4, "unsinnige Zahl zählt als 0");
});

test("keine Anzeige ohne Mindestzahl, nach Beginn, abgesagt, vorbei", () => {
  assert.equal(quorumLeft(plan({ min_going: null }), 2, now), null);
  assert.equal(quorumLeft(plan({ min_going: undefined }), 2, now), null);
  assert.equal(quorumLeft(plan({ starts_at: "2026-11-05T11:59:00Z" }), 1, now), null, "schon begonnen");
  assert.equal(quorumLeft(plan({ starts_at: "2026-11-05T12:00:00Z" }), 1, now), null, "beginnt genau jetzt");
  assert.equal(quorumLeft(plan({ status: "cancelled" }), 1, now), null);
  assert.equal(quorumLeft(plan({ status: "completed" }), 1, now), null);
  assert.equal(quorumLeft(plan({ status: "proposed" }), 1, now), 3, "auch vorgeschlagene Pläne");
});

test("Zusagen: Mitglieder und Gäste mit „Bin dabei“", () => {
  const participants = [{ attendance_status: "going" }, { attendance_status: "maybe" }, { attendance_status: "going" }, { attendance_status: "invited" }];
  assert.equal(goingWithGuests({ participants }), 2);
  assert.equal(goingWithGuests({ participants, guests: null }), 2);
  assert.equal(goingWithGuests({ participants, guests: [{ attendance_status: "going" }, { attendance_status: "declined" }] }), 3);
});
