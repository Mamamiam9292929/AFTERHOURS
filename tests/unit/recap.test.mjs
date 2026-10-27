// P9 · Crew-Rückblick (src/lib/recap.ts, Typen entfernt Node selbst).
import assert from "node:assert/strict";
import { test } from "node:test";
import { berlinWeekday, berlinYear, crewRecap, crewYearRecap, monthKey, recapYearChoice } from "../../src/lib/recap.ts";

let n = 0;
const plan = (starts_at, extra = {}) => ({
  id: `p${String(++n).padStart(3, "0")}`,
  title: "Bowling",
  starts_at,
  status: "completed",
  activity_id: null,
  participants: [],
  ...extra,
});
const going = (k) => Array.from({ length: k }, () => ({ attendance_status: "going" }));
const NOW = new Date("2026-10-19T10:00:00Z");

test("ohne abgeschlossene Abende: alles leer, zwölf leere Monate", () => {
  const recap = crewRecap([plan("2026-10-20T18:00:00Z", { status: "confirmed" }), plan("2026-10-01T18:00:00Z", { status: "cancelled" })], NOW);
  assert.equal(recap.evenings, 0);
  assert.equal(recap.firstAt, null);
  assert.equal(recap.longestStreak, 0);
  assert.equal(recap.biggestRound, 0);
  assert.equal(recap.favoriteWeekday, null);
  assert.deepEqual(recap.places, []);
  assert.equal(recap.months.length, 12);
  assert.equal(recap.months[0].key, "2025-11");
  assert.equal(recap.months[11].key, "2026-10");
  assert.ok(recap.months.every((m) => m.count === 0));
});

test("nur abgeschlossene Pläne zählen; erster Abend, größte Runde", () => {
  const recap = crewRecap(
    [
      plan("2026-09-04T18:00:00Z", { participants: [...going(3), { attendance_status: "maybe" }, { attendance_status: "declined" }] }),
      plan("2026-06-12T18:00:00Z", { participants: going(5) }),
      plan("2026-10-10T18:00:00Z", { status: "cancelled", participants: going(9) }),
      plan("2026-10-30T18:00:00Z", { status: "confirmed", participants: going(9) }),
    ],
    NOW,
  );
  assert.equal(recap.evenings, 2);
  assert.equal(recap.firstAt, "2026-06-12T18:00:00Z");
  assert.equal(recap.biggestRound, 5, "Vielleicht, Absagen und nicht abgeschlossene Pläne zählen nicht");
});

test("Monate und Wochentage in Berliner Zeit", () => {
  assert.equal(monthKey("2026-09-30T22:30:00Z"), "2026-10", "00:30 Uhr am 1. Oktober in Berlin");
  assert.equal(monthKey("2026-12-31T23:30:00Z"), "2027-01");
  assert.equal(berlinWeekday("2026-10-16T22:30:00Z"), 6, "Freitag 22:30 UTC ist Samstag 00:30 in Berlin");
  assert.equal(berlinWeekday("2026-10-16T18:00:00Z"), 5);
});

test("längste Serie über aufeinanderfolgende Monate, auch über den Jahreswechsel", () => {
  const recap = crewRecap(
    [
      plan("2025-11-07T18:00:00Z"),
      plan("2025-12-05T18:00:00Z"),
      plan("2025-12-19T18:00:00Z"),
      plan("2026-01-09T18:00:00Z"),
      plan("2026-02-06T18:00:00Z"),
      // Lücke im März
      plan("2026-04-10T17:00:00Z"),
      plan("2026-05-08T17:00:00Z"),
    ],
    NOW,
  );
  assert.equal(recap.longestStreak, 4, "Nov–Feb");
  assert.equal(recap.months.find((m) => m.key === "2025-12").count, 2);
  assert.equal(recap.months.find((m) => m.key === "2026-03").count, 0);
  assert.equal(crewRecap([plan("2026-01-09T18:00:00Z")], NOW).longestStreak, 1);
});

test("Lieblingstag erst ab drei Abenden und nur eindeutig", () => {
  const friday = (d) => plan(`2026-10-${d}T18:00:00Z`);
  assert.equal(crewRecap([friday("02"), friday("09")], NOW).favoriteWeekday, null, "zwei Abende: kein Lieblingstag");
  assert.equal(crewRecap([friday("02"), friday("09"), plan("2026-10-10T18:00:00Z")], NOW).favoriteWeekday, 5, "zwei Freitage, ein Samstag");
  assert.equal(
    crewRecap([friday("02"), plan("2026-10-03T18:00:00Z"), friday("09"), plan("2026-10-10T18:00:00Z")], NOW).favoriteWeekday,
    null,
    "Gleichstand: kein Lieblingstag",
  );
});

test("Stammorte: ab zwei Abenden, nach Ort oder Titel, höchstens drei, jüngster Titel", () => {
  const recap = crewRecap(
    [
      plan("2026-01-09T18:00:00Z", { activity_id: "a1", title: "Strike Bowling" }),
      plan("2026-02-09T18:00:00Z", { activity_id: "a1", title: "Strike District Bowling" }),
      plan("2026-03-09T18:00:00Z", { activity_id: "a1", title: "Strike District Bowling" }),
      plan("2026-04-09T18:00:00Z", { title: "Grillen bei Bob" }),
      plan("2026-05-09T18:00:00Z", { title: "grillen bei bob " }),
      plan("2026-06-09T18:00:00Z", { activity_id: "a2", title: "Kino" }),
      plan("2026-07-09T18:00:00Z", { activity_id: "a3", title: "Minigolf" }),
      plan("2026-08-09T18:00:00Z", { activity_id: "a3", title: "Minigolf" }),
      plan("2026-09-09T18:00:00Z", { activity_id: "a4", title: "Bar" }),
      plan("2026-09-19T18:00:00Z", { activity_id: "a4", title: "Bar" }),
    ],
    NOW,
  );
  assert.deepEqual(
    recap.places.map((p) => [p.title, p.count]),
    [
      ["Strike District Bowling", 3],
      ["Bar", 2],
      ["grillen bei bob", 2],
    ],
  );
  assert.ok(!recap.places.some((p) => p.title === "Kino"), "einmal ist kein Stammort");
});

test("Reihenfolge der Eingabe spielt keine Rolle", () => {
  const list = [plan("2026-03-06T18:00:00Z", { participants: going(2) }), plan("2026-01-09T18:00:00Z"), plan("2026-02-06T18:00:00Z")];
  assert.deepEqual(crewRecap(list, NOW), crewRecap([...list].reverse(), NOW));
});

// P9 Etappe 3 · „Euer Jahr“
test("Jahr in Berliner Zeit: Silvester spät abends gehört zum alten Jahr", () => {
  assert.equal(berlinYear("2026-12-31T22:30:00Z"), 2026); // 23:30 Uhr in Berlin
  assert.equal(berlinYear("2026-12-31T23:30:00Z"), 2027); // 00:30 Uhr in Berlin
});

test("Jahresauswahl: Dezember hebt das laufende Jahr hervor, sonst nur als Auswahl", () => {
  const plans = [plan("2026-03-06T18:00:00Z"), plan("2025-11-14T18:00:00Z")];
  assert.deepEqual(recapYearChoice(plans, new Date("2026-10-27T10:00:00Z")), { year: 2026, highlight: false });
  assert.deepEqual(recapYearChoice(plans, new Date("2026-12-01T00:30:00Z")), { year: 2026, highlight: true }); // 1. Dezember, 01:30 Uhr Berlin
  assert.deepEqual(recapYearChoice(plans, new Date("2026-11-30T22:30:00Z")), { year: 2026, highlight: false }); // noch 30. November
});

test("Jahresauswahl: bis zum 15. Januar noch das alte Jahr, danach das neue", () => {
  const plans = [plan("2026-03-06T18:00:00Z"), plan("2027-01-08T18:00:00Z")];
  assert.deepEqual(recapYearChoice(plans, new Date("2027-01-15T12:00:00Z")), { year: 2026, highlight: true });
  assert.deepEqual(recapYearChoice(plans, new Date("2027-01-16T12:00:00Z")), { year: 2027, highlight: false });
  // Ohne Abend im alten Jahr: das neue, ohne Hervorhebung.
  assert.deepEqual(recapYearChoice([plan("2027-01-08T18:00:00Z")], new Date("2027-01-10T12:00:00Z")), { year: 2027, highlight: false });
});

test("Jahresauswahl: ohne Abend im Jahr nichts – abgesagte und anstehende zählen nicht", () => {
  const now = new Date("2026-12-10T12:00:00Z");
  assert.equal(recapYearChoice([], now), null);
  assert.equal(recapYearChoice([plan("2025-12-05T18:00:00Z")], now), null);
  assert.equal(recapYearChoice([plan("2026-12-01T18:00:00Z", { status: "cancelled" }), plan("2026-12-20T18:00:00Z", { status: "confirmed" })], now), null);
});

test("Jahres-Rückblick: nur Abende des Jahres, Monate Januar bis Dezember", () => {
  const recap = crewYearRecap(
    [
      plan("2025-12-31T22:30:00Z", { participants: going(9) }), // Silvester 23:30 Uhr: altes Jahr
      plan("2026-01-09T18:00:00Z", { participants: going(4) }),
      plan("2026-02-06T18:00:00Z", { participants: going(2) }),
      plan("2026-02-20T18:00:00Z", { status: "cancelled", participants: going(7) }),
      plan("2026-05-08T18:00:00Z"),
      plan("2027-01-01T10:00:00Z"),
    ],
    2026,
  );
  assert.equal(recap.evenings, 3);
  assert.equal(recap.firstAt, "2026-01-09T18:00:00Z");
  assert.equal(recap.biggestRound, 4);
  assert.equal(recap.longestStreak, 2);
  assert.equal(recap.favoriteWeekday, 5); // alle drei freitags
  assert.deepEqual(
    recap.months.map((m) => m.key),
    ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"],
  );
  assert.deepEqual(
    recap.months.map((m) => m.count),
    [1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
  );
});

test("Jahres-Rückblick: Stammorte nur aus dem Jahr", () => {
  const recap = crewYearRecap(
    [
      plan("2025-06-05T18:00:00Z", { activity_id: "a1", title: "Bowling" }),
      plan("2026-06-05T18:00:00Z", { activity_id: "a1", title: "Bowling" }),
      plan("2026-07-03T18:00:00Z", { activity_id: "a2", title: "Kino" }),
      plan("2026-08-07T18:00:00Z", { activity_id: "a2", title: "Kino" }),
    ],
    2026,
  );
  assert.deepEqual(recap.places, [{ key: "a2", title: "Kino", count: 2 }]);
});
