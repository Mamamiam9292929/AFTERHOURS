// P9 · Crew-Rückblick (src/lib/recap.ts, Typen entfernt Node selbst).
import assert from "node:assert/strict";
import { test } from "node:test";
import { berlinWeekday, crewRecap, monthKey } from "../../src/lib/recap.ts";

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
