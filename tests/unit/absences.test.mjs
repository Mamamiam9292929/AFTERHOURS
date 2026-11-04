// P21 · „Bin weg“ (src/lib/absences.ts, Typen entfernt Node selbst).
import assert from "node:assert/strict";
import { test } from "node:test";
import { absenceProblem, awayOn, awaySoon } from "../../src/lib/absences.ts";

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

test("Gerade weg: laufende zuerst, kommende in 14 Tagen, Zeiträume einer Person zusammengelegt", () => {
  const today = "2026-11-19";
  assert.deepEqual(awaySoon(LIST, today, 14, ["carol", "bob", "dave"]), [
    { user_id: "bob", starts_on: "2026-11-10", ends_on: "2026-11-25", now: true },
    { user_id: "carol", starts_on: "2026-11-20", ends_on: "2026-11-20", now: false },
  ], "Bobs zwei Zeiträume überlappen – einer bis 25.11.; Dave beginnt erst in 41 Tagen");
  assert.deepEqual(awaySoon(LIST, "2026-12-16").map((a) => a.user_id), ["dave"], "genau 14 Tage vorher");
  assert.deepEqual(awaySoon(LIST, "2026-12-15"), [], "15 Tage vorher noch nicht");
  assert.deepEqual(awaySoon(LIST, "2027-01-03"), [{ user_id: "dave", starts_on: "2026-12-30", ends_on: "2027-01-03", now: true }], "letzter Tag über den Jahreswechsel");
  assert.deepEqual(awaySoon(LIST, "2027-01-04"), []);
});

test("Gerade weg: anschließende Zeiträume, Sortierung, ungültige Angaben", () => {
  const list = [
    { user_id: "a", starts_on: "2026-11-01", ends_on: "2026-11-05" },
    { user_id: "a", starts_on: "2026-11-06", ends_on: "2026-11-08" },
    { user_id: "b", starts_on: "2026-11-04", ends_on: "2026-11-06" },
    { user_id: "c", starts_on: "2026-11-10", ends_on: "2026-11-12" },
    { user_id: "d", starts_on: "2026-11-07", ends_on: "2026-11-07" },
    { user_id: "e", starts_on: "2026-11-09", ends_on: "2026-11-01" },
    { user_id: "f", starts_on: "kaputt", ends_on: "2026-11-09" },
  ];
  assert.deepEqual(awaySoon(list, "2026-11-04").map((x) => `${x.user_id}:${x.ends_on}:${x.now}`), [
    "b:2026-11-06:true",
    "a:2026-11-08:true",
    "d:2026-11-07:false",
    "c:2026-11-12:false",
  ], "lückenlos anschließend = ein Zeitraum; laufende nach Ende, kommende nach Beginn; Unsinn fällt weg");
  assert.deepEqual(awaySoon(list, "2026-11-04", 3).map((x) => x.user_id), ["b", "a", "d"], "Horizont 3 Tage");
  assert.deepEqual(awaySoon(list, "04.11.2026"), []);
});
