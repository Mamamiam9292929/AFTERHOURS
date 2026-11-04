// P21 · „Bin weg“ (src/lib/absences.ts, Typen entfernt Node selbst).
import assert from "node:assert/strict";
import { test } from "node:test";
import { absenceProblem, awayOn } from "../../src/lib/absences.ts";

const LIST = [
  { user_id: "bob", starts_on: "2026-11-10", ends_on: "2026-11-20" },
  { user_id: "carol", starts_on: "2026-11-20", ends_on: "2026-11-20" },
  { user_id: "bob", starts_on: "2026-11-18", ends_on: "2026-11-25" },
  { user_id: "dave", starts_on: "2026-12-30", ends_on: "2027-01-03" },
];

test("wer an einem Tag weg ist: Beginn und Ende eingeschlossen, jede Person einmal", () => {
  assert.deepEqual(awayOn(LIST, "2026-11-09"), []);
  assert.deepEqual(awayOn(LIST, "2026-11-10"), ["bob"]);
  assert.deepEqual(awayOn(LIST, "2026-11-19"), ["bob"], "zwei Zeiträume von Bob überlappen – trotzdem einmal");
  assert.deepEqual(awayOn(LIST, "2026-11-20"), ["bob", "carol"]);
  assert.deepEqual(awayOn(LIST, "2026-11-21"), ["bob"]);
  assert.deepEqual(awayOn(LIST, "2026-11-26"), []);
});

test("über den Jahreswechsel", () => {
  assert.deepEqual(awayOn(LIST, "2026-12-31"), ["dave"]);
  assert.deepEqual(awayOn(LIST, "2027-01-03"), ["dave"]);
  assert.deepEqual(awayOn(LIST, "2027-01-04"), []);
});

test("Reihenfolge nach Mitgliedern, ohne Termin niemand", () => {
  assert.deepEqual(awayOn(LIST, "2026-11-20", ["carol", "bob"]), ["carol", "bob"]);
  assert.deepEqual(awayOn(LIST, "2026-11-20", ["carol"]), ["carol", "bob"], "Unbekannte dahinter");
  assert.deepEqual(awayOn(LIST, null), []);
  assert.deepEqual(awayOn(LIST, ""), []);
  assert.deepEqual(awayOn(LIST, "20.11.2026"), []);
});

test("Zeitraum prüfen wie der Server", () => {
  const today = "2026-11-04";
  assert.equal(absenceProblem("2026-11-10", "2026-11-20", today), null);
  assert.equal(absenceProblem("2026-11-04", "2026-11-04", today), null, "heute, ein Tag");
  assert.equal(absenceProblem("2026-11-01", "2026-11-05", today), null, "hat schon begonnen, läuft noch");
  assert.equal(absenceProblem("", "2026-11-05", today), "missing");
  assert.equal(absenceProblem("2026-11-10", "2026-11-09", today), "order");
  assert.equal(absenceProblem("2026-10-01", "2026-11-03", today), "past");
  assert.equal(absenceProblem("2026-11-10", "2027-11-10", today), null, "genau 365 Tage");
  assert.equal(absenceProblem("2026-11-10", "2027-11-11", today), "long");
  assert.equal(absenceProblem("2028-11-03", "2028-11-05", today), null, "730 Tage voraus (2028 hat einen Schalttag)");
  assert.equal(absenceProblem("2028-11-04", "2028-11-06", today), "far");
});
