// P30 · „Fand der Abend statt?“ (src/lib/closing.ts): wann die Planseite fragt, ob der Abend stattfand.
import assert from "node:assert/strict";
import { test } from "node:test";
import { closePromptDue, HOME_CLOSE_LIMIT, plansToClose } from "../../src/lib/closing.ts";

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

test("P30 Etappe 2: Home zeigt nur, was du abschließen darfst – jüngster Abend zuerst", () => {
  const now = at("2026-11-09T09:00:00Z");
  const mine = (id, starts_at, over = {}) => ({ id, by: "bob", starts_at, ends_at: null, status: "confirmed", ...over });
  const plans = [
    mine("alt", "2026-10-20T19:00:00Z"),
    mine("gestern", "2026-11-08T19:00:00Z"),
    mine("fremd", "2026-11-07T19:00:00Z", { by: "alice" }),
    mine("vorgestern", "2026-11-07T18:00:00Z", { status: "proposed" }),
    mine("fertig", "2026-11-06T19:00:00Z", { status: "completed" }),
    mine("abgesagt", "2026-11-06T19:00:00Z", { status: "cancelled" }),
    mine("läuft", "2026-11-09T08:00:00Z"),
    mine("zu-alt", "2026-10-01T19:00:00Z"),
    mine("kommt", "2026-11-12T19:00:00Z"),
  ];
  const ids = plansToClose(plans, (p) => p.by === "bob", now).map((p) => p.id);
  assert.deepEqual(ids, ["gestern", "vorgestern", "alt"]);
  assert.deepEqual(plansToClose(plans, () => false, now), [], "ohne Recht nichts");
  assert.equal(plans[0].id, "alt", "Eingabe bleibt unverändert");
  assert.equal(HOME_CLOSE_LIMIT, 3);
});
