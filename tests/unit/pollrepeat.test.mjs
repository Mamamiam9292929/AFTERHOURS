// S7 · Runde jede Woche von selbst (src/lib/pollrepeat.ts) – gleiche Rechnung wie app_private.poll_series_next.
import assert from "node:assert/strict";
import { test } from "node:test";
import { dueRepeats, nextRound, plusBerlinWeeks } from "../../src/lib/pollrepeat.ts";

const iso = (d) => d.toISOString();

test("eine Woche weiter auf der Berliner Uhr – auch über die Zeitumstellung", () => {
  // Fr 23.10.2026 12:00 Sommerzeit (10:00 UTC) → Fr 30.10.2026 12:00 Winterzeit (11:00 UTC).
  assert.equal(iso(plusBerlinWeeks(new Date("2026-10-23T10:00:00Z"), 1)), "2026-10-30T11:00:00.000Z");
  // Fr 20.03.2026 12:00 Winterzeit → Fr 27.03. 12:00 (noch Winterzeit) → Fr 03.04. 12:00 Sommerzeit.
  assert.equal(iso(plusBerlinWeeks(new Date("2026-03-20T11:00:00Z"), 1)), "2026-03-27T11:00:00.000Z");
  assert.equal(iso(plusBerlinWeeks(new Date("2026-03-20T11:00:00Z"), 2)), "2026-04-03T10:00:00.000Z");
  // Ohne Umstellung: genau 7 Tage.
  assert.equal(iso(plusBerlinWeeks(new Date("2026-06-05T10:00:00Z"), 3)), "2026-06-26T10:00:00.000Z");
});

test("nächste Runde: öffnet so lange vorher, wie die letzte lief", () => {
  // Lief Di 20.10. 12:00 bis Fr 23.10. 12:00 (3 Tage) → nächste bis Fr 30.10. 12:00, öffnet Di 27.10. 11:00 UTC.
  const r = nextRound("2026-10-23T10:00:00Z", "2026-10-20T10:00:00Z", new Date("2026-10-23T10:00:00Z"));
  assert.equal(r.weeks, 1);
  assert.equal(iso(r.endsAt), "2026-10-30T11:00:00.000Z");
  assert.equal(iso(r.opensAt), "2026-10-27T11:00:00.000Z");
});

test("mindestens 1, höchstens 6 Tage Vorlauf", () => {
  const short = nextRound("2026-06-05T10:00:00Z", "2026-06-05T08:00:00Z", new Date("2026-06-05T10:00:00Z"));
  assert.equal(short.endsAt.getTime() - short.opensAt.getTime(), 86_400_000, "zwei Stunden Laufzeit → ein Tag Vorlauf");
  const long = nextRound("2026-06-05T10:00:00Z", "2026-05-01T10:00:00Z", new Date("2026-06-05T10:00:00Z"));
  assert.equal(long.endsAt.getTime() - long.opensAt.getTime(), 6 * 86_400_000, "fünf Wochen Laufzeit → sechs Tage Vorlauf");
});

test("verpasste Wochen werden übersprungen, mindestens eine Stunde bleibt", () => {
  const r = nextRound("2026-06-05T10:00:00Z", "2026-06-02T10:00:00Z", new Date("2026-06-25T12:00:00Z"));
  assert.equal(r.weeks, 3);
  assert.equal(iso(r.endsAt), "2026-06-26T10:00:00.000Z");
  const tight = nextRound("2026-06-05T10:00:00Z", "2026-06-02T10:00:00Z", new Date("2026-06-12T09:30:00Z"));
  assert.equal(tight.weeks, 2, "nur 30 Minuten bis zum Ende der nächsten Woche – lieber eine Woche später");
  assert.equal(nextRound("kaputt", "2026-06-02T10:00:00Z"), null);
});

const poll = (over) => ({ id: "p", series_id: "s1", series: { id: "s1", active: true }, status: "closed", ends_at: "2026-06-05T10:00:00Z", created_at: "2026-06-02T10:00:00Z", ...over });

test("fällige Serien: nur aktive, nur wenn die letzte Runde vorbei und die nächste offen ist", () => {
  const thursday = new Date("2026-06-11T12:00:00Z"); // nächste Runde: 09.06. bis 12.06.
  assert.deepEqual(dueRepeats([poll()], thursday), ["s1"]);
  assert.deepEqual(dueRepeats([poll()], new Date("2026-06-08T12:00:00Z")), [], "öffnet erst am 09.06.");
  assert.deepEqual(dueRepeats([poll({ series: { id: "s1", active: false } })], thursday), [], "beendete Serie");
  assert.deepEqual(dueRepeats([poll({ series_id: null, series: null })], thursday), [], "ohne Serie");
  assert.deepEqual(dueRepeats([poll({ status: "open", ends_at: "2026-06-12T10:00:00Z" })], thursday), [], "Runde läuft noch");
  // Die neue Runde ist schon da: die späteste zählt.
  assert.deepEqual(dueRepeats([poll(), poll({ id: "q", status: "open", ends_at: "2026-06-12T10:00:00Z", created_at: "2026-06-09T10:00:00Z" })], thursday), []);
  // Abgelaufen, aber noch nicht festgestellt (status open): zählt als vorbei.
  assert.deepEqual(dueRepeats([poll({ status: "open" })], thursday), ["s1"]);
});
