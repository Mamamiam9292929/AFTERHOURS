// P9 Etappe 2 · Rückblick als Bild (src/lib/recapcard.ts, Typen entfernt Node selbst).
import assert from "node:assert/strict";
import { test } from "node:test";
import { crewRecap } from "../../src/lib/recap.ts";
import { EMPTY_BAR, MIN_BAR, recapCardFileName, recapCardModel } from "../../src/lib/recapcard.ts";

const months = (counts) => counts.map((count, i) => ({ key: `2026-${String(i + 1).padStart(2, "0")}`, count }));
const base = { evenings: 1, firstAt: "2026-10-03T18:00:00Z", longestStreak: 1, biggestRound: 1, favoriteWeekday: null, months: months([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0]) };

test("nur Kacheln, die etwas aussagen – wie auf der Crew-Seite", () => {
  assert.deepEqual(recapCardModel(base).facts, []);
  assert.deepEqual(recapCardModel({ ...base, evenings: 7, longestStreak: 3, biggestRound: 6, favoriteWeekday: 5 }).facts, [
    { kind: "streak", value: 3 },
    { kind: "round", value: 6 },
    { kind: "weekday", value: 5 },
  ]);
  // Sonntag ist 0 – darf nicht als „fehlt“ gelten.
  assert.deepEqual(recapCardModel({ ...base, favoriteWeekday: 0 }).facts, [{ kind: "weekday", value: 0 }]);
});

test("Balken: leere Monate flach, volle im Verhältnis, kleine sichtbar", () => {
  const bars = recapCardModel({ ...base, months: months([0, 1, 9, 3, 0, 0, 0, 0, 0, 0, 0, 0]) }, 180).bars;
  assert.equal(bars.length, 12);
  assert.equal(bars[0].height, EMPTY_BAR);
  assert.equal(bars[1].height, Math.max(MIN_BAR, 20));
  assert.equal(bars[2].height, 180);
  assert.equal(bars[3].height, 60);
  assert.deepEqual(bars.map((b) => b.key).slice(0, 2), ["2026-01", "2026-02"]);
});

test("aus echten Plänen: keine Titel, Orte oder Namen auf dem Bild", () => {
  const plan = (id, starts_at, title) => ({ id, title, starts_at, status: "completed", activity_id: null, participants: [{ attendance_status: "going" }, { attendance_status: "going" }] });
  const recap = crewRecap(
    [plan("a", "2026-08-07T18:00:00Z", "Grillen bei Bob"), plan("b", "2026-09-04T18:00:00Z", "Grillen bei Bob"), plan("c", "2026-10-02T18:00:00Z", "Bowling mit Carla")],
    new Date("2026-10-20T12:00:00Z"),
  );
  const model = recapCardModel(recap);
  assert.equal(model.evenings, 3);
  assert.deepEqual(model.facts, [
    { kind: "streak", value: 3 },
    { kind: "round", value: 2 },
    { kind: "weekday", value: 5 },
  ]);
  assert.ok(!/Bob|Carla|Grillen|Bowling/.test(JSON.stringify(model)), "nur Zahlen und Monate");
});

test("Dateiname mit Berliner Datum", () => {
  assert.equal(recapCardFileName(new Date("2026-10-20T23:30:00Z")), "afterhours-rueckblick-2026-10-21.png");
});
