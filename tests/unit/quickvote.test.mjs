// D3 Etappe 1 · Abstimmen und Live-Countdown auf Home (src/lib/quickvote.ts, Typen entfernt Node selbst).
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCountdown, liveCountdown, needsQuickVote, pendingOptions, showTonightIdeas, tonightStrip } from "../../src/lib/quickvote.ts";

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

// D3 Etappe 2a · „Heute“-Leiste unter dem großen Ticket.
const tonightPlan = (over = {}) => ({
  starts_at: "2026-10-30T19:00:00.000Z",
  ends_at: null,
  status: "confirmed",
  activity_id: "a1",
  meeting_point: "  Am Eingang  ",
  address: "Hauptstraße 1",
  ...over,
});

test("Leiste nur im Fenster des Live-Countdowns, nie bei Absage oder Abschluss", () => {
  const plan = tonightPlan();
  assert.equal(tonightStrip(plan, new Date("2026-10-30T06:00:00.000Z"), 0, 20), null, "13 Stunden vorher noch nicht");
  assert.notEqual(tonightStrip(plan, new Date("2026-10-30T08:00:00.000Z"), 0, 20), null);
  assert.equal(tonightStrip(tonightPlan({ status: "cancelled" }), new Date("2026-10-30T18:00:00.000Z"), 0, 20), null);
  assert.equal(tonightStrip(tonightPlan({ status: "completed" }), new Date("2026-10-30T18:00:00.000Z"), 0, 20), null);
  assert.equal(tonightStrip(plan, new Date("2026-10-30T22:01:00.000Z"), 0, 20), null, "ohne Ende nach 3 Stunden vorbei");
});

test("Überschrift: heute Abend, heute, morgen, jetzt", () => {
  const before = new Date("2026-10-30T15:00:00.000Z");
  assert.equal(tonightStrip(tonightPlan(), before, 0, 20).when, "tonight");
  assert.equal(tonightStrip(tonightPlan(), before, 0, 16).when, "today");
  assert.equal(tonightStrip(tonightPlan(), before, 1, 9).when, "tomorrow");
  assert.equal(tonightStrip(tonightPlan(), before, 1, 1).when, "night", "kurz nach Mitternacht ist „heute Nacht“, nicht „morgen“");
  assert.equal(tonightStrip(tonightPlan(), before, 0, 2).when, "night");
  assert.equal(tonightStrip(tonightPlan(), new Date("2026-10-30T19:30:00.000Z"), 0, 20).when, "now");
});

test("Wetter nur mit Ort aus Discover und nur vor Beginn; Treffpunkt bereinigt, Leeres bleibt leer", () => {
  const before = new Date("2026-10-30T15:00:00.000Z");
  const strip = tonightStrip(tonightPlan(), before, 0, 20);
  assert.equal(strip.weather, true);
  assert.equal(strip.meetingPoint, "Am Eingang");
  assert.equal(strip.address, "Hauptstraße 1");
  assert.equal(tonightStrip(tonightPlan({ activity_id: null }), before, 0, 20).weather, false);
  assert.equal(tonightStrip(tonightPlan(), new Date("2026-10-30T19:30:00.000Z"), 0, 20).weather, false, "läuft schon – keine Vorhersage mehr");
  const empty = tonightStrip(tonightPlan({ meeting_point: "   ", address: null }), before, 0, 20);
  assert.equal(empty.meetingPoint, null);
  assert.equal(empty.address, null);
});

// D3 Etappe 2b · „Heute Abend“ ohne Plan.
const evening = { hour: 19, hasCrew: true, askOpen: false, dismissed: false, plans: [] };
const at = new Date("2026-10-30T18:30:00.000Z"); // 19:30 Uhr in Berlin
const p = (over = {}) => ({ starts_at: "2026-11-02T19:00:00.000Z", ends_at: null, status: "confirmed", days: 3, mine: "attending", ...over });

test("„Heute Abend“ ohne Plan: nur von 16 bis 23 Uhr, nur mit Crew", () => {
  assert.equal(showTonightIdeas(evening, at), true);
  assert.equal(showTonightIdeas({ ...evening, hour: 15 }, at), false, "15 Uhr ist noch Nachmittag");
  assert.equal(showTonightIdeas({ ...evening, hour: 16 }, at), true);
  assert.equal(showTonightIdeas({ ...evening, hour: 22 }, at), true);
  assert.equal(showTonightIdeas({ ...evening, hour: 23 }, at), false, "ab 23 Uhr nicht mehr");
  assert.equal(showTonightIdeas({ ...evening, hour: 2 }, at), false);
  assert.equal(showTonightIdeas({ ...evening, hasCrew: false }, at), false);
});

test("„Heute Abend“ ohne Plan: nicht bei laufender Spontan-Frage und nicht, wenn heute ausgeblendet", () => {
  assert.equal(showTonightIdeas({ ...evening, askOpen: true }, at), false);
  assert.equal(showTonightIdeas({ ...evening, dismissed: true }, at), false);
});

test("„Heute Abend“ ohne Plan: verschwindet, sobald heute etwas ansteht – außer es ist abgesagt", () => {
  assert.equal(showTonightIdeas({ ...evening, plans: [p()] }, at), true, "Plan in drei Tagen stört nicht");
  assert.equal(showTonightIdeas({ ...evening, plans: [p({ days: 0, starts_at: "2026-10-30T20:00:00.000Z" })] }, at), false, "Plan heute");
  assert.equal(showTonightIdeas({ ...evening, plans: [p({ days: 0, starts_at: "2026-10-30T20:00:00.000Z", mine: "invited" })] }, at), false, "auch ohne eigene Antwort");
  assert.equal(showTonightIdeas({ ...evening, plans: [p({ days: 1, starts_at: "2026-10-30T23:30:00.000Z" })] }, at), false, "Plan kurz nach Mitternacht liegt im Countdown-Fenster");
  assert.equal(showTonightIdeas({ ...evening, plans: [p({ days: 0, starts_at: "2026-10-30T20:00:00.000Z", status: "cancelled" })] }, at), true, "abgesagter Plan zählt nicht");
  assert.equal(showTonightIdeas({ ...evening, plans: [p({ days: 0, starts_at: "2026-10-30T20:00:00.000Z", mine: "declined" })] }, at), true, "eigene Absage zählt nicht");
});
