// P39 · „Noch einen Tag?“ – Wahlmöglichkeiten fürs Verlängern (src/lib/pollextend.ts), gleiche Grenzen wie `extend_poll`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkCustomEnd, EXTEND_PRESETS, extendChoices, extendLimit } from "../../src/lib/pollextend.ts";

const now = new Date("2026-11-11T12:00:00Z");
const H = 3_600_000;
const poll = (extra) => ({ status: "open", ends_at: "2026-11-11T17:00:30Z", ...extra });
const allowed = (choices) => choices.map((c) => `${c.key}:${c.allowed}`).join(" ");

test("drei Tipps ab der aktuellen Frist, auf die Minute", () => {
  const choices = extendChoices(poll(), [], now);
  assert.deepEqual(choices.map((c) => c.key), EXTEND_PRESETS.map((p) => p.key));
  assert.deepEqual(choices.map((c) => c.endsAt.toISOString()), ["2026-11-11T19:00:00.000Z", "2026-11-12T17:00:00.000Z", "2026-11-14T17:00:00.000Z"]);
  assert.equal(allowed(choices), "hours2:true day1:true days3:true");
});

test("nichts zu verlängern: beendet, abgelaufen, Serie", () => {
  assert.equal(extendChoices(poll({ status: "closed" }), [], now), null);
  assert.equal(extendChoices(poll({ ends_at: "2026-11-11T12:00:00Z" }), [], now), null, "endet genau jetzt");
  assert.equal(extendChoices(poll({ ends_at: "2026-11-10T12:00:00Z" }), [], now), null);
  assert.equal(extendChoices(poll({ seriesActive: true }), [], now), null);
  assert.equal(extendChoices(poll({ ends_at: "kaputt" }), [], now), null);
});

test("höchstens 14 Tage ab jetzt", () => {
  const late = extendChoices(poll({ ends_at: "2026-11-23T12:00:00Z" }), [], now);
  assert.equal(allowed(late), "hours2:true day1:true days3:false");
  const edge = extendChoices(poll({ ends_at: "2026-11-25T11:00:00Z" }), [], now);
  assert.equal(allowed(edge), "hours2:false day1:false days3:false");
});

test("spätestens 30 Minuten vor dem frühesten bevorstehenden Termin", () => {
  const first = new Date("2026-11-12T19:00:00Z").getTime();
  const choices = extendChoices(poll(), [null, first + 3 * 24 * H, first], now);
  assert.equal(allowed(choices), "hours2:true day1:true days3:false");
  // 17:00 + 1 Tag = 12.11. 17:00 ≤ 18:30 – geht; mit Termin um 17:20 nicht mehr.
  assert.equal(allowed(extendChoices(poll(), [new Date("2026-11-12T17:20:00Z").getTime()], now)), "hours2:true day1:false days3:false");
  assert.equal(allowed(extendChoices(poll(), [new Date("2026-11-12T17:30:00Z").getTime()], now)), "hours2:true day1:true days3:false", "genau 30 Minuten vorher geht");
  // Vergangene Termine zählen nicht.
  assert.equal(allowed(extendChoices(poll(), [now.getTime() - 24 * H], now)), "hours2:true day1:true days3:true");
});

test("erster Termin schon zu nah: alles ausgegraut", () => {
  const choices = extendChoices(poll(), [new Date("2026-11-11T18:00:00Z").getTime()], now);
  assert.equal(choices.some((c) => c.allowed), false);
});

// P39 Etappe 2 · selbst gewählter Zeitpunkt – gleiche Grenzen und Fehlerschlüssel wie `extend_poll`.
test("eigener Zeitpunkt: passt", () => {
  assert.equal(checkCustomEnd(poll(), new Date("2026-11-13T17:00:00Z"), [], now), null);
  // Sekunden werden wie auf dem Server abgeschnitten: 17:00:30 → 17:00 ist nicht später als die Frist 17:00:30.
  assert.equal(checkCustomEnd(poll({ ends_at: "2026-11-11T17:00:00Z" }), new Date("2026-11-11T17:01:00Z"), [], now), null);
});

test("eigener Zeitpunkt: muss nach der bisherigen Frist liegen", () => {
  assert.equal(checkCustomEnd(poll(), new Date("2026-11-11T17:00:59Z"), [], now), "poll_extend_not_later");
  assert.equal(checkCustomEnd(poll(), new Date("2026-11-11T16:00:00Z"), [], now), "poll_extend_not_later");
  assert.equal(checkCustomEnd(poll(), new Date("kaputt"), [], now), "poll_extend_not_later");
});

test("eigener Zeitpunkt: höchstens 14 Tage ab jetzt", () => {
  assert.equal(checkCustomEnd(poll(), new Date("2026-11-25T12:00:00Z"), [], now), null, "genau 14 Tage geht");
  assert.equal(checkCustomEnd(poll(), new Date("2026-11-25T12:01:00Z"), [], now), "poll_extend_too_far");
});

test("eigener Zeitpunkt: spätestens 30 Minuten vor dem ersten Termin", () => {
  const first = new Date("2026-11-13T19:00:00Z").getTime();
  assert.equal(checkCustomEnd(poll(), new Date("2026-11-13T18:30:00Z"), [first], now), null);
  assert.equal(checkCustomEnd(poll(), new Date("2026-11-13T18:31:00Z"), [first], now), "poll_extend_too_late");
  assert.equal(extendLimit([first, null], now), new Date("2026-11-13T18:30:00Z").getTime());
  assert.equal(extendLimit([], now), now.getTime() + 14 * 24 * H);
});
