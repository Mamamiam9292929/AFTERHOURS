// P1 Etappe 3b · Termin-Vorschläge aus den Abenden der Crew (src/lib/slots.ts, Typen entfernt Node selbst).
import assert from "node:assert/strict";
import { test } from "node:test";
import { berlinSlot, suggestDateSlots } from "../../src/lib/slots.ts";

let n = 0;
const plan = (starts_at, status = "completed") => ({ id: `p${String(++n).padStart(3, "0")}`, starts_at, status });
// Montag, 19. Oktober 2026, 12:00 Berliner Zeit (Sommerzeit, UTC+2).
const NOW = new Date("2026-10-19T10:00:00Z");

test("Berliner Zeit: Tag, Uhrzeit, Wochentag – auch kurz vor Mitternacht UTC und über die Zeitumstellung", () => {
  assert.deepEqual(berlinSlot("2026-10-15T17:30:00Z"), { date: "2026-10-15", time: "19:30", weekday: 4 });
  assert.deepEqual(berlinSlot("2026-10-15T22:30:00Z"), { date: "2026-10-16", time: "00:30", weekday: 5 });
  assert.deepEqual(berlinSlot("2026-11-05T18:30:00Z"), { date: "2026-11-05", time: "19:30", weekday: 4 });
});

test("zu wenig Abende oder keine Gewohnheit: kein Vorschlag", () => {
  assert.equal(suggestDateSlots([], NOW), null);
  assert.equal(suggestDateSlots([plan("2026-10-15T17:30:00Z"), plan("2026-10-08T17:30:00Z")], NOW), null, "zwei Abende reichen nicht");
  // Drei Abende an drei verschiedenen Tagen – nichts zu erkennen.
  assert.equal(suggestDateSlots([plan("2026-10-15T17:30:00Z"), plan("2026-10-09T18:00:00Z"), plan("2026-10-03T16:00:00Z")], NOW), null);
});

test("nur abgeschlossene, vergangene Abende zählen", () => {
  const plans = [
    plan("2026-10-15T17:30:00Z"),
    plan("2026-10-08T17:30:00Z", "cancelled"),
    plan("2026-10-01T17:30:00Z", "confirmed"),
    plan("2026-09-24T17:30:00Z", "proposed"),
  ];
  assert.equal(suggestDateSlots(plans, NOW), null);
});

test("Lieblingstag mit üblicher Uhrzeit: die nächsten drei Donnerstage um 19:30", () => {
  const plans = [
    plan("2026-10-15T17:30:00Z"),
    plan("2026-10-08T17:30:00Z"),
    plan("2026-10-01T17:30:00Z"),
    plan("2026-09-24T18:00:00Z"),
    plan("2026-09-20T16:00:00Z"), // Sonntag, nur einmal
  ];
  const s = suggestDateSlots(plans, NOW);
  assert.equal(s.evenings, 5);
  assert.equal(s.weekday, 4);
  assert.equal(s.weekdayCount, 4);
  assert.equal(s.time, "19:30");
  assert.equal(s.timeCount, 3);
  // Nach dem 25.10. gilt Winterzeit – die Uhrzeit bleibt 19:30 in Berlin.
  assert.deepEqual(s.slots, [
    { date: "2026-10-22", time: "19:30", weekday: 4 },
    { date: "2026-10-29", time: "19:30", weekday: 4 },
    { date: "2026-11-05", time: "19:30", weekday: 4 },
  ]);
});

test("zweitliebster Tag mit mindestens zwei Abenden bekommt einen Termin, chronologisch sortiert", () => {
  const plans = [
    plan("2026-10-16T18:00:00Z"), // Fr 20:00
    plan("2026-10-09T18:00:00Z"),
    plan("2026-10-02T18:00:00Z"),
    plan("2026-10-10T17:00:00Z"), // Sa 19:00
    plan("2026-09-26T17:00:00Z"),
  ];
  const s = suggestDateSlots(plans, NOW);
  assert.equal(s.weekday, 5);
  assert.equal(s.time, "20:00");
  assert.deepEqual(s.slots, [
    { date: "2026-10-23", time: "20:00", weekday: 5 },
    { date: "2026-10-24", time: "19:00", weekday: 6 },
    { date: "2026-10-30", time: "20:00", weekday: 5 },
  ]);
});

test("Gleichstand: der Tag bzw. die Uhrzeit mit dem jüngsten Abend gewinnt", () => {
  const plans = [
    plan("2026-10-17T17:00:00Z"), // Sa 19:00 (jüngster)
    plan("2026-10-03T19:00:00Z"), // Sa 21:00
    plan("2026-10-09T18:00:00Z"), // Fr
    plan("2026-10-02T18:00:00Z"), // Fr
  ];
  const s = suggestDateSlots(plans, NOW);
  assert.equal(s.weekday, 6, "Samstag hat den jüngsten Abend");
  assert.equal(s.time, "19:00", "bei gleich häufigen Uhrzeiten die jüngste");
  assert.equal(s.timeCount, 1);
  assert.equal(s.slots[0].date, "2026-10-23", "Freitag als zweiter Tag zuerst");
});

test("Tage mit einem aktiven Plan werden übersprungen, heute nie vorgeschlagen", () => {
  const plans = [
    plan("2026-10-12T16:00:00Z"), // Mo 18:00
    plan("2026-10-05T16:00:00Z"),
    plan("2026-09-28T16:00:00Z"),
    plan("2026-10-26T17:00:00Z", "confirmed"), // nächster Montag schon belegt
    plan("2026-11-02T17:00:00Z", "cancelled"), // abgesagt blockiert nicht
  ];
  const s = suggestDateSlots(plans, NOW);
  assert.deepEqual(
    s.slots.map((x) => x.date),
    ["2026-11-02", "2026-11-09", "2026-11-16"],
  );
});

test("nur die letzten 20 Abende zählen", () => {
  const old = Array.from({ length: 25 }, (_, i) => plan(new Date(Date.UTC(2025, 0, 6 + 7 * i, 17)).toISOString())); // Montage 2025
  const fresh = Array.from({ length: 20 }, (_, i) => plan(new Date(Date.UTC(2026, 5, 4 + 7 * i, 17)).toISOString())); // Donnerstage 2026
  const s = suggestDateSlots([...old, ...fresh], NOW);
  assert.equal(s.evenings, 20);
  assert.equal(s.weekday, 4);
  assert.equal(s.weekdayCount, 20);
});

test("höchstens fünf Wochen voraus, höchstens drei Termine", () => {
  const plans = [plan("2026-10-15T17:30:00Z"), plan("2026-10-08T17:30:00Z"), plan("2026-10-01T17:30:00Z")];
  const busy = ["2026-10-22", "2026-10-29", "2026-11-05", "2026-11-12"].map((d) => plan(`${d}T17:30:00Z`, "confirmed"));
  const s = suggestDateSlots([...plans, ...busy], NOW);
  assert.deepEqual(s.slots.map((x) => x.date), ["2026-11-19"]);
  const allBusy = [...busy, plan("2026-11-19T17:30:00Z", "booked")];
  assert.equal(suggestDateSlots([...plans, ...allBusy], NOW), null);
});
