// P13 · Live-Standort: Zeitfenster, Frist, Entfernungen und sparsames Senden (src/lib/live.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { arrivalState, distanceMeters, isAtPlace, isStale, liveStage, liveWindow, roundDistance, shareUntil, shouldSend, walkMinutes } from "../../src/lib/live.ts";

const plan = (starts_at, ends_at = null, status = "confirmed") => ({ starts_at, ends_at, status });
const at = (iso) => new Date(iso);

test("Fenster: 2 Stunden vor Beginn bis 4 Stunden danach, mit Ende bis zum Ende", () => {
  const w = liveWindow(plan("2026-11-06T19:00:00Z"));
  assert.equal(w.start.toISOString(), "2026-11-06T17:00:00.000Z");
  assert.equal(w.end.toISOString(), "2026-11-06T23:00:00.000Z");
  assert.equal(liveWindow(plan("2026-11-06T19:00:00Z", "2026-11-06T21:30:00Z")).end.toISOString(), "2026-11-06T21:30:00.000Z");
});

test("Stufen: verborgen, bald, offen, vorbei", () => {
  const p = plan("2026-11-06T19:00:00Z");
  assert.equal(liveStage(p, at("2026-11-06T04:00:00Z")), "hidden");
  assert.equal(liveStage(p, at("2026-11-06T05:00:00Z")), "soon");
  assert.equal(liveStage(p, at("2026-11-06T16:59:59Z")), "soon");
  assert.equal(liveStage(p, at("2026-11-06T17:00:00Z")), "open");
  assert.equal(liveStage(p, at("2026-11-06T22:59:59Z")), "open");
  assert.equal(liveStage(p, at("2026-11-06T23:00:00Z")), "hidden");
  assert.equal(liveStage(plan("2026-11-06T19:00:00Z", null, "cancelled"), at("2026-11-06T18:00:00Z")), "hidden");
  assert.equal(liveStage(plan("2026-11-06T19:00:00Z", null, "completed"), at("2026-11-06T18:00:00Z")), "hidden");
  assert.equal(liveStage(plan("2026-11-06T19:00:00Z", null, "proposed"), at("2026-11-06T18:00:00Z")), "open");
});

test("Frist: höchstens 3 Stunden, nie über das Fenster hinaus", () => {
  const p = plan("2026-11-06T19:00:00Z");
  assert.equal(shareUntil(p, at("2026-11-06T17:30:00Z")).toISOString(), "2026-11-06T20:30:00.000Z");
  assert.equal(shareUntil(p, at("2026-11-06T21:00:00Z")).toISOString(), "2026-11-06T23:00:00.000Z");
});

test("Entfernung: Berlin Alexanderplatz – Fernsehturm rund 300 m", () => {
  const d = distanceMeters({ latitude: 52.5219, longitude: 13.4132 }, { latitude: 52.5208, longitude: 13.4094 });
  assert.ok(d > 250 && d < 320, String(d));
  assert.equal(distanceMeters({ latitude: 52.5, longitude: 13.4 }, { latitude: 52.5, longitude: 13.4 }), 0);
});

test("Entfernung gerundet: nah, Meter, Kilometer", () => {
  assert.deepEqual(roundDistance(12), { kind: "near" });
  assert.deepEqual(roundDistance(Number.NaN), { kind: "near" });
  assert.deepEqual(roundDistance(54), { kind: "m", value: 50 });
  assert.deepEqual(roundDistance(538), { kind: "m", value: 540 });
  assert.deepEqual(roundDistance(994), { kind: "m", value: 990 });
  assert.deepEqual(roundDistance(996), { kind: "km", value: 1 });
  assert.deepEqual(roundDistance(1260), { kind: "km", value: 1.3 });
  assert.deepEqual(roundDistance(23_400), { kind: "km", value: 23 });
});

test("Senden: erste Position sofort, dann bei Bewegung oder als Lebenszeichen, nie zu oft", () => {
  const here = { latitude: 52.52, longitude: 13.405 };
  const moved = { latitude: 52.5205, longitude: 13.405 }; // rund 55 m
  const jitter = { latitude: 52.52005, longitude: 13.405 }; // rund 5 m
  assert.equal(shouldSend(null, here, 0), true);
  const last = { ...here, at: 1_000_000 };
  assert.equal(shouldSend(last, moved, 1_000_000 + 10_000), false, "nicht vor 20 s");
  assert.equal(shouldSend(last, moved, 1_000_000 + 25_000), true, "Bewegung nach 20 s");
  assert.equal(shouldSend(last, jitter, 1_000_000 + 25_000), false, "Zittern zählt nicht");
  assert.equal(shouldSend(last, jitter, 1_000_000 + 90_000), true, "Lebenszeichen nach 90 s");
});

test("veraltet nach 10 Minuten", () => {
  assert.equal(isStale("2026-11-06T19:00:00Z", at("2026-11-06T19:09:00Z")), false);
  assert.equal(isStale("2026-11-06T19:00:00Z", at("2026-11-06T19:11:00Z")), true);
});

test("Stadtplan: Personen am selben Fleck rücken auseinander, Einzelne bleiben", async () => {
  const { spreadMarkers, LIVE_MARKER_GAP } = await import("../../src/lib/live.ts");
  assert.deepEqual(spreadMarkers([]), []);
  assert.deepEqual(spreadMarkers([{ x: 10, y: 20 }]), [{ x: 10, y: 20 }]);
  // Weit genug auseinander: unverändert.
  assert.deepEqual(spreadMarkers([{ x: 0, y: 0 }, { x: 100, y: 0 }]), [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  // Zwei am selben Punkt: übereinander, genau eine Lücke Abstand, Mitte bleibt.
  const two = spreadMarkers([{ x: 50, y: 50 }, { x: 50, y: 50 }]);
  assert.ok(Math.abs(Math.hypot(two[0].x - two[1].x, two[0].y - two[1].y) - LIVE_MARKER_GAP) < 1e-9);
  assert.ok(Math.abs((two[0].x + two[1].x) / 2 - 50) < 1e-9 && Math.abs((two[0].y + two[1].y) / 2 - 50) < 1e-9);
  assert.ok(two[0].y < two[1].y, "erste Person oben");
  // Drei dicht beieinander, eine weit weg: die drei auf einem Kreis, alle Nachbarn ≥ Lücke, die vierte unverändert.
  const four = spreadMarkers([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 }, { x: 300, y: 300 }]);
  assert.deepEqual(four[3], { x: 300, y: 300 });
  for (const [i, j] of [[0, 1], [1, 2], [0, 2]]) {
    assert.ok(Math.hypot(four[i].x - four[j].x, four[i].y - four[j].y) >= LIVE_MARKER_GAP - 1e-9);
  }
  // Ketten werden eine Gruppe (a nah b, b nah c).
  const chain = spreadMarkers([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 40, y: 0 }], 30);
  for (const [i, j] of [[0, 1], [1, 2], [0, 2]]) {
    assert.ok(Math.hypot(chain[i].x - chain[j].x, chain[i].y - chain[j].y) >= 30 - 1e-9);
  }
});

// P13 Etappe 2b · „Bin gleich da“
test("Gehzeit: Luftlinie × 1,3 bei 80 m/min, nur zwischen „am Ort“ und 3 km", () => {
  assert.equal(walkMinutes(800), 13);
  assert.equal(walkMinutes(100), 2);
  assert.equal(walkMinutes(3000), 49);
  assert.equal(walkMinutes(60), null, "schon am Ort");
  assert.equal(walkMinutes(3001), null, "zu weit für eine Gehzeit");
  assert.equal(walkMinutes(Number.NaN), null);
});

test("Am Ort: bis 75 m, plus Ungenauigkeit bis höchstens 75 m", () => {
  const place = { latitude: 52.5158, longitude: 13.4983 };
  const north = (m) => ({ latitude: place.latitude + m / 111_195, longitude: place.longitude });
  assert.equal(isAtPlace(north(10), place), true);
  assert.equal(isAtPlace(north(70), place), true);
  assert.equal(isAtPlace(north(100), place), false);
  assert.equal(isAtPlace({ ...north(100), accuracy_m: 40 }, place), true, "Ungenauigkeit zählt mit");
  assert.equal(isAtPlace({ ...north(200), accuracy_m: 5000 }, place), false, "höchstens 75 m Zugabe");
  assert.equal(isAtPlace(north(0), null), false, "ohne Ort kein „da“");
});

test("Ansage: keine, offen, vorbei", () => {
  const now = at("2026-11-06T19:00:00Z");
  assert.equal(arrivalState(null, now), "none");
  assert.equal(arrivalState("kaputt", now), "none");
  assert.equal(arrivalState("2026-11-06T19:10:00Z", now), "upcoming");
  assert.equal(arrivalState("2026-11-06T19:00:00Z", now), "past");
  assert.equal(arrivalState("2026-11-06T18:50:00Z", now), "past");
});
