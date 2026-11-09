// P30 · „Fand der Abend statt?“ (src/lib/closing.ts): wann die Planseite fragt, ob der Abend stattfand.
import assert from "node:assert/strict";
import { test } from "node:test";
import { closePromptDue } from "../../src/lib/closing.ts";

const plan = (over = {}) => ({ status: "confirmed", starts_at: "2026-11-06T19:00:00Z", ends_at: null, ...over });
const at = (iso) => new Date(iso);

test("ohne Ende: drei Stunden nach Beginn", () => {
  assert.equal(closePromptDue(plan(), at("2026-11-06T19:00:00Z")), false, "zu Beginn noch nicht");
  assert.equal(closePromptDue(plan(), at("2026-11-06T21:59:59Z")), false, "mitten am Abend noch nicht");
  assert.equal(closePromptDue(plan(), at("2026-11-06T22:00:00Z")), true, "drei Stunden danach");
  assert.equal(closePromptDue(plan(), at("2026-11-07T09:00:00Z")), true, "am Morgen danach");
});

test("mit Ende: erst danach", () => {
  const trip = plan({ ends_at: "2026-11-08T17:00:00Z" });
  assert.equal(closePromptDue(trip, at("2026-11-07T12:00:00Z")), false, "mehrtägiger Plan läuft noch");
  assert.equal(closePromptDue(trip, at("2026-11-08T17:00:00Z")), true, "ab dem Ende");
  const short = plan({ ends_at: "2026-11-06T20:00:00Z" });
  assert.equal(closePromptDue(short, at("2026-11-06T20:30:00Z")), true, "kurzer Plan: nach dem Ende, nicht erst nach drei Stunden");
  assert.equal(closePromptDue(plan({ ends_at: "2026-11-06T18:00:00Z" }), at("2026-11-06T21:00:00Z")), false, "Ende vor Beginn zählt nicht");
});

test("nur offene Pläne", () => {
  const later = at("2026-11-07T09:00:00Z");
  for (const status of ["proposed", "confirmed", "booking_pending", "booked"]) assert.equal(closePromptDue(plan({ status }), later), true, status);
  for (const status of ["completed", "cancelled", "irgendwas"]) assert.equal(closePromptDue(plan({ status }), later), false, status);
});

test("bis 30 Tage nach Beginn", () => {
  assert.equal(closePromptDue(plan(), at("2026-12-06T18:59:59Z")), true, "knapp 30 Tage danach");
  assert.equal(closePromptDue(plan(), at("2026-12-06T19:00:00Z")), false, "danach nicht mehr");
});

test("ungültiger Beginn: nie", () => {
  assert.equal(closePromptDue(plan({ starts_at: "kaputt" }), at("2026-11-07T09:00:00Z")), false);
});
