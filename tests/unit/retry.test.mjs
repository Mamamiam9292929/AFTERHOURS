// P32 · „Neuer Anlauf?“ (src/lib/retry.ts): wann ein abgesagter Plan zur neuen Terminsuche einlädt.
import assert from "node:assert/strict";
import { test } from "node:test";
import { RETRY_TITLE_MAX, retryDue, retryLink, retryTitle } from "../../src/lib/retry.ts";

const plan = (over = {}) => ({
  status: "cancelled",
  starts_at: "2026-11-06T19:00:00Z",
  skipped_at: null,
  crew_id: "11111111-1111-4111-8111-111111111111",
  activity_id: null,
  title: "Hütte",
  ...over,
});
const at = (iso) => new Date(iso);

test("nur abgesagte Pläne", () => {
  for (const status of ["proposed", "confirmed", "booking_pending", "booked", "completed"]) {
    assert.equal(retryDue(plan({ status }), at("2026-11-05T12:00:00Z")), false, status);
  }
  assert.equal(retryDue(plan(), at("2026-11-05T12:00:00Z")), true, "vor dem Termin abgesagt");
  assert.equal(retryDue(plan(), at("2026-11-07T09:00:00Z")), true, "nach dem Termin („Hat nicht stattgefunden“)");
});

test("ausgesetzter Stammtisch-Termin: keine Karte", () => {
  assert.equal(retryDue(plan({ skipped_at: "2026-11-01T10:00:00Z" }), at("2026-11-05T12:00:00Z")), false);
});

test("bis 30 Tage nach dem geplanten Beginn", () => {
  assert.equal(retryDue(plan(), at("2026-12-06T18:59:59Z")), true);
  assert.equal(retryDue(plan(), at("2026-12-06T19:00:00Z")), false);
  assert.equal(retryDue(plan({ starts_at: "kaputt" }), at("2026-11-05T12:00:00Z")), false);
});

test("Titel: Leerraum zusammengefasst, leer oder zu lang → keiner", () => {
  assert.equal(retryTitle("  Hütte \n am  See "), "Hütte am See");
  assert.equal(retryTitle(""), null);
  assert.equal(retryTitle("   "), null);
  assert.equal(retryTitle(null), null);
  assert.equal(retryTitle("x".repeat(RETRY_TITLE_MAX)), "x".repeat(RETRY_TITLE_MAX));
  assert.equal(retryTitle("x".repeat(RETRY_TITLE_MAX + 1)), null);
});

test("Link: Crew, Termin-Abstimmung, Ort und Name", () => {
  const link = new URL(retryLink(plan({ activity_id: "22222222-2222-4222-8222-222222222222", title: "Bowling & Pizza" })), "https://x");
  assert.equal(link.pathname, "/polls/new");
  assert.equal(link.searchParams.get("crew"), "11111111-1111-4111-8111-111111111111");
  assert.equal(link.searchParams.get("kind"), "date");
  assert.equal(link.searchParams.get("place"), "22222222-2222-4222-8222-222222222222");
  assert.equal(link.searchParams.get("again"), "Bowling & Pizza");
});

test("Link ohne Ort und mit zu langem Namen: nur Crew und Art", () => {
  const link = new URL(retryLink(plan({ title: "y".repeat(RETRY_TITLE_MAX + 5) })), "https://x");
  assert.equal(link.searchParams.get("place"), null);
  assert.equal(link.searchParams.get("again"), null);
  assert.equal(link.searchParams.get("kind"), "date");
});
