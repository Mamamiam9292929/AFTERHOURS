// P50 · „Danach noch wohin?“ (src/lib/stops.ts): Uhrzeit wie gesprochen → Zeitpunkt am Abend, Reihenfolge.
import assert from "node:assert/strict";
import { test } from "node:test";
import { STOP_MAX, STOP_MAX_HOURS, sortStops, stopTimeFromClock } from "../../src/lib/stops.ts";

test("Grenzen wie auf dem Server", () => {
  assert.equal(STOP_MAX, 4);
  assert.equal(STOP_MAX_HOURS, 18);
});

test("Uhrzeit nach dem Beginn am selben Abend (Winterzeit)", () => {
  // Fr, 13.11.2026, 19:00 Berliner Zeit = 18:00 UTC
  assert.equal(stopTimeFromClock("2026-11-13T18:00:00Z", "22:30"), "2026-11-13T21:30:00.000Z");
  assert.equal(stopTimeFromClock("2026-11-13T18:00:00Z", "19:01"), "2026-11-13T18:01:00.000Z");
});

test("Uhrzeit vor oder auf dem Beginn: nächster Tag", () => {
  assert.equal(stopTimeFromClock("2026-11-13T18:00:00Z", "01:00"), "2026-11-14T00:00:00.000Z", "nach Mitternacht");
  assert.equal(stopTimeFromClock("2026-11-13T18:00:00Z", "9:00"), "2026-11-14T08:00:00.000Z", "Frühstück am Morgen, einstellige Stunde");
  assert.equal(stopTimeFromClock("2026-11-13T18:00:00Z", "19:00"), null, "genau der Beginn wäre 24 h später – zu weit");
});

test("genau 18 Stunden danach geht noch", () => {
  assert.equal(stopTimeFromClock("2026-11-13T18:00:00Z", "13:00"), "2026-11-14T12:00:00.000Z", "Beginn 19 Uhr + 18 h = 13 Uhr");
  assert.equal(stopTimeFromClock("2026-11-13T18:00:00Z", "13:01"), null, "eine Minute zu spät");
});

test("Sommerzeit und Zeitumstellung", () => {
  // Sa, 13.06.2026, 20:00 Berliner Sommerzeit = 18:00 UTC
  assert.equal(stopTimeFromClock("2026-06-13T18:00:00Z", "23:00"), "2026-06-13T21:00:00.000Z");
  // Sa, 24.10.2026, 22:00 MESZ = 20:00 UTC; in der Nacht wird die Uhr zurückgestellt: 04:00 MEZ = 03:00 UTC
  assert.equal(stopTimeFromClock("2026-10-24T20:00:00Z", "04:00"), "2026-10-25T03:00:00.000Z");
});

test("keine Uhrzeit: null", () => {
  for (const bad of ["", "abc", "24:00", "12:60", "1230", "12:3"]) assert.equal(stopTimeFromClock("2026-11-13T18:00:00Z", bad), null, bad);
  assert.equal(stopTimeFromClock("kein Datum", "22:00"), null);
});

test("Reihenfolge: mit Uhrzeit zuerst, ohne in Eintragsreihenfolge", () => {
  const stops = [
    { id: "c", at: null, created_at: "2026-11-01T10:00:00Z" },
    { id: "b", at: "2026-11-13T23:00:00Z", created_at: "2026-11-01T09:00:00Z" },
    { id: "d", at: null, created_at: "2026-11-01T08:00:00Z" },
    { id: "a", at: "2026-11-13T21:00:00Z", created_at: "2026-11-01T11:00:00Z" },
  ];
  assert.deepEqual(sortStops(stops).map((s) => s.id), ["a", "b", "d", "c"]);
  assert.equal(stops[0].id, "c", "Eingabe bleibt unverändert");
});
