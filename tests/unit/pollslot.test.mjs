// P40 · „Und Sonntag?“ – Termin nachreichen (src/lib/pollslot.ts), gleiche Regeln wie `add_poll_slot`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { canSuggestSlot, MAX_POLL_SLOTS, slotProblem, slotsFull } from "../../src/lib/pollslot.ts";

const now = new Date("2026-11-11T12:00:00Z"); // 13:00 Berliner Zeit
const today = "2026-11-11";
const poll = (extra) => ({
  kind: "date",
  status: "open",
  ends_at: "2026-11-12T17:00:00Z",
  parent_poll_id: null,
  options: [
    { proposed_date: "2026-11-13", proposed_time: "20:00:00" },
    { proposed_date: "2026-11-14", proposed_time: null },
  ],
  ...extra,
});
const check = (input, startMs = null, p = poll()) => slotProblem(p, input, today, startMs, now);

test("Knopf nur bei laufender Termin-Abstimmung ohne Stichwahl", () => {
  assert.equal(canSuggestSlot(poll(), now), true);
  assert.equal(canSuggestSlot(poll({ kind: "place" }), now), false);
  assert.equal(canSuggestSlot(poll({ status: "closed" }), now), false);
  assert.equal(canSuggestSlot(poll({ ends_at: "2026-11-11T11:59:00Z" }), now), false, "Frist abgelaufen");
  assert.equal(canSuggestSlot(poll({ parent_poll_id: "p1" }), now), false, "Stichwahl");
});

test("neuer Tag ohne oder mit Uhrzeit geht", () => {
  assert.equal(check({ date: "2026-11-15", time: "" }), null);
  assert.equal(check({ date: "2026-11-15", time: "19:30" }, Date.parse("2026-11-15T18:30:00Z")), null);
  assert.equal(check({ date: "2026-11-14", time: "20:00" }, Date.parse("2026-11-14T19:00:00Z")), null, "gleicher Tag mit Uhrzeit ist ein anderer Termin");
  assert.equal(check({ date: today, time: "" }), null, "heute ohne Uhrzeit zählt als ganzer Tag");
});

test("Doppelte, vergangene und ungültige Termine", () => {
  assert.equal(check({ date: "2026-11-13", time: "20:00" }, Date.parse("2026-11-13T19:00:00Z")), "duplicate", "Uhrzeit aus der Datenbank mit Sekunden");
  assert.equal(check({ date: "2026-11-14", time: "" }), "duplicate");
  assert.equal(check({ date: "2026-11-10", time: "" }), "past");
  assert.equal(check({ date: today, time: "12:00" }, Date.parse("2026-11-11T11:00:00Z")), "past", "heute um 12 ist um 13 Uhr vorbei");
  assert.equal(check({ date: "", time: "" }), "invalid");
  assert.equal(check({ date: "2027-11-12", time: "" }), "invalid", "mehr als ein Jahr voraus");
  assert.equal(check({ date: "2027-11-11", time: "" }), null, "genau ein Jahr geht");
});

test("höchstens zehn Termine", () => {
  const options = Array.from({ length: MAX_POLL_SLOTS }, (_, i) => ({ proposed_date: `2026-12-${String(i + 1).padStart(2, "0")}`, proposed_time: null }));
  const full = poll({ options });
  assert.equal(slotsFull(full), true);
  assert.equal(slotsFull(poll()), false);
  assert.equal(check({ date: "2026-11-20", time: "" }, null, full), "full");
});
