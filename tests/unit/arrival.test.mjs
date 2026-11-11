// P43 · „Seid ihr schon da?“ (src/lib/arrival.ts): wann die Planseite fragt – gleiche Regel wie der Server.
import assert from "node:assert/strict";
import { test } from "node:test";
import { arrivalCounts, arrivalOpen, arrivalOrder, arrivalOverdue, arrivalWindow } from "../../src/lib/arrival.ts";

const plan = (over = {}) => ({ status: "confirmed", starts_at: "2026-11-13T19:00:00Z", ends_at: null, ...over });
const at = (iso) => new Date(iso);

test("ohne Ende: ab 1 Stunde vorher bis 3 Stunden nach Beginn", () => {
  assert.equal(arrivalOpen(plan(), at("2026-11-13T17:59:59Z")), false, "vorher nicht");
  assert.equal(arrivalOpen(plan(), at("2026-11-13T18:00:00Z")), true, "eine Stunde vorher");
  assert.equal(arrivalOpen(plan(), at("2026-11-13T19:30:00Z")), true, "kurz nach Beginn");
  assert.equal(arrivalOpen(plan(), at("2026-11-13T21:59:59Z")), true, "knapp drei Stunden danach");
  assert.equal(arrivalOpen(plan(), at("2026-11-13T22:00:00Z")), false, "danach nicht mehr");
});

test("mit Ende: höchstens bis zum Ende", () => {
  const short = plan({ ends_at: "2026-11-13T20:00:00Z" });
  assert.equal(arrivalOpen(short, at("2026-11-13T19:59:00Z")), true);
  assert.equal(arrivalOpen(short, at("2026-11-13T20:00:00Z")), false, "nach dem Ende kommt niemand mehr an");
  const long = plan({ ends_at: "2026-11-14T02:00:00Z" });
  assert.equal(arrivalWindow(long).until.toISOString(), "2026-11-13T22:00:00.000Z", "lange Abende: drei Stunden nach Beginn");
  const broken = plan({ ends_at: "2026-11-13T18:00:00Z" });
  assert.equal(arrivalWindow(broken).until.toISOString(), "2026-11-13T22:00:00.000Z", "Ende vor Beginn zählt nicht");
});

test("abgesagt oder ohne Beginn: nie", () => {
  assert.equal(arrivalOpen(plan({ status: "cancelled" }), at("2026-11-13T19:00:00Z")), false);
  assert.equal(arrivalOpen(plan({ starts_at: "kaputt" }), at("2026-11-13T19:00:00Z")), false);
  assert.equal(arrivalWindow(plan({ starts_at: "" })), null);
  assert.equal(arrivalOpen(plan({ status: "completed" }), at("2026-11-13T19:00:00Z")), true, "abgeschlossen in derselben Nacht: offen wie beim Server");
});

test("Reihenfolge: du zuerst, dann wer da ist, dann wer am frühesten kommt", () => {
  const people = [
    { user_id: "c", state: "late", eta: "2026-11-13T19:40:00Z", updated_at: "2026-11-13T19:00:00Z" },
    { user_id: "b", state: "here", eta: null, updated_at: "2026-11-13T19:05:00Z" },
    { user_id: "d", state: "late", eta: "2026-11-13T19:20:00Z", updated_at: "2026-11-13T19:10:00Z" },
    { user_id: "a", state: "here", eta: null, updated_at: "2026-11-13T18:55:00Z" },
    { user_id: "me", state: "late", eta: "2026-11-13T20:00:00Z", updated_at: "2026-11-13T19:15:00Z" },
  ];
  assert.deepEqual(arrivalOrder(people, "me").map((p) => p.user_id), ["me", "a", "b", "d", "c"]);
  assert.deepEqual(arrivalCounts(people), { here: 2, late: 3 });
});

test("überfällig: erst wenn die angesagte Uhrzeit vorbei ist", () => {
  const late = { state: "late", eta: "2026-11-13T19:20:00Z" };
  assert.equal(arrivalOverdue(late, at("2026-11-13T19:19:59Z")), false);
  assert.equal(arrivalOverdue(late, at("2026-11-13T19:20:00Z")), true);
  assert.equal(arrivalOverdue({ state: "here", eta: null }, at("2026-11-14T00:00:00Z")), false);
});
