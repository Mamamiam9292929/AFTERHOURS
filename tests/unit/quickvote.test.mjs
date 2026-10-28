// D3 Etappe 1 · Abstimmen und Live-Countdown auf Home (src/lib/quickvote.ts, Typen entfernt Node selbst).
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCountdown, liveCountdown, needsQuickVote, pendingOptions } from "../../src/lib/quickvote.ts";

const opt = (id, mine = null) => ({ id, mine });
const ids = (list) => list.map((o) => o.id);
const none = new Set();

test("offen sind Vorschläge ohne Antwort – in der Reihenfolge der Abstimmung", () => {
  const options = [opt("a"), opt("b", "yes"), opt("c"), opt("d", "no")];
  assert.deepEqual(ids(pendingOptions(options, none, none)), ["a", "c"]);
});

test("gerade beantwortet oder übersprungen fällt sofort weg, auch bevor der Server antwortet", () => {
  const options = [opt("a"), opt("b"), opt("c")];
  assert.deepEqual(ids(pendingOptions(options, new Set(["a"]), none)), ["b", "c"]);
  assert.deepEqual(ids(pendingOptions(options, new Set(["a"]), new Set(["b"]))), ["c"]);
  assert.deepEqual(ids(pendingOptions(options, new Set(["a", "c"]), new Set(["b"]))), []);
});

test("„Deine Antwort fehlt“: ohne jede Stimme ja, nach der ersten Stimme nur, wenn auf Home angefangen", () => {
  assert.equal(needsQuickVote([opt("a"), opt("b")], false), true);
  assert.equal(needsQuickVote([opt("a", "yes"), opt("b")], false), false);
  assert.equal(needsQuickVote([opt("a", "yes"), opt("b")], true), true);
  assert.equal(needsQuickVote([opt("a", "yes"), opt("b", "no")], true), true);
  assert.equal(needsQuickVote([opt("a", "yes"), opt("b", "no")], false), false);
  assert.equal(needsQuickVote([], false), false);
});

const NOW = new Date("2026-10-28T18:00:00Z");
const plan = (starts_at, over = {}) => ({ starts_at, ends_at: null, status: "confirmed", ...over });

test("Countdown: erst in den letzten 12 Stunden, minutengenau, aufgerundet", () => {
  assert.equal(liveCountdown(plan("2026-10-29T06:00:01Z"), NOW), null);
  assert.deepEqual(liveCountdown(plan("2026-10-29T06:00:00Z"), NOW), { kind: "soon", minutes: 720 });
  assert.deepEqual(liveCountdown(plan("2026-10-28T20:14:00Z"), NOW), { kind: "soon", minutes: 134 });
  assert.deepEqual(liveCountdown(plan("2026-10-28T18:00:20Z"), NOW), { kind: "soon", minutes: 1 });
});

test("Countdown: ab Beginn „läuft gerade“ bis zum Ende, ohne Ende drei Stunden", () => {
  assert.deepEqual(liveCountdown(plan("2026-10-28T18:00:00Z"), NOW), { kind: "live" });
  assert.deepEqual(liveCountdown(plan("2026-10-28T15:30:00Z"), NOW), { kind: "live" });
  assert.equal(liveCountdown(plan("2026-10-28T15:00:00Z"), NOW), null);
  assert.deepEqual(liveCountdown(plan("2026-10-28T12:00:00Z", { ends_at: "2026-10-28T19:00:00Z" }), NOW), { kind: "live" });
  assert.equal(liveCountdown(plan("2026-10-28T17:00:00Z", { ends_at: "2026-10-28T17:45:00Z" }), NOW), null);
});

test("Countdown: abgesagte und abgeschlossene Pläne zählen nicht", () => {
  assert.equal(liveCountdown(plan("2026-10-28T20:00:00Z", { status: "cancelled" }), NOW), null);
  assert.equal(liveCountdown(plan("2026-10-28T17:00:00Z", { status: "completed" }), NOW), null);
});

test("Anzeige wie bei „Heute noch wer?“", () => {
  assert.equal(formatCountdown(134), "2:14 h");
  assert.equal(formatCountdown(60), "1:00 h");
  assert.equal(formatCountdown(35), "35 min");
  assert.equal(formatCountdown(1), "1 min");
});
