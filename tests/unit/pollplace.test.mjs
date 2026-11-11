// P40 Etappe 2 · „Und das Kino?“ – Ort nachreichen (src/lib/pollplace.ts), gleiche Regeln wie `add_poll_place`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { canSuggestPlace, cleanPlaceTitle, MAX_POLL_PLACES, placeProblem, placesFull } from "../../src/lib/pollplace.ts";

const now = new Date("2026-11-11T12:00:00Z");
const poll = (extra) => ({
  kind: "place",
  status: "open",
  ends_at: "2026-11-12T17:00:00Z",
  parent_poll_id: null,
  options: [
    { activity_id: "a-bowling", title: "Bowling Nord" },
    { activity_id: null, title: "Billard" },
  ],
  ...extra,
});

test("Knopf nur bei laufender Orts-Abstimmung ohne Stichwahl", () => {
  assert.equal(canSuggestPlace(poll(), now), true);
  assert.equal(canSuggestPlace(poll({ kind: "date" }), now), false, "Termin-Abstimmung hat eigenen Knopf (Etappe 1)");
  assert.equal(canSuggestPlace(poll({ status: "closed" }), now), false);
  assert.equal(canSuggestPlace(poll({ ends_at: "2026-11-11T11:59:00Z" }), now), false, "Frist abgelaufen");
  assert.equal(canSuggestPlace(poll({ parent_poll_id: "p1" }), now), false, "Stichwahl");
});

test("Ort aus Discover oder eigener Vorschlag", () => {
  assert.equal(placeProblem(poll(), { activityId: "a-kino", title: "Kino am Markt" }), null);
  assert.equal(placeProblem(poll(), { activityId: null, title: "  Picknick   im Park " }), null);
  assert.equal(cleanPlaceTitle("  Picknick   im Park "), "Picknick im Park", "wie clean_line in der Datenbank");
  assert.equal(cleanPlaceTitle("x".repeat(130)).length, 120);
});

test("Leere und doppelte Vorschläge", () => {
  assert.equal(placeProblem(poll(), { activityId: null, title: "   " }), "invalid");
  assert.equal(placeProblem(poll(), { activityId: "a-bowling", title: "Bowling Nord" }), "duplicate", "gleicher Ort");
  assert.equal(placeProblem(poll(), { activityId: null, title: " bILLard" }), "duplicate", "gleicher Titel, andere Schreibweise");
  assert.equal(placeProblem(poll(), { activityId: "a-other", title: "bowling nord" }), "duplicate", "anderer Ort mit gleichem Namen");
});

test("höchstens zehn Vorschläge", () => {
  const options = Array.from({ length: MAX_POLL_PLACES }, (_, i) => ({ activity_id: null, title: `Ort ${i}` }));
  assert.equal(placesFull(poll({ options })), true);
  assert.equal(placesFull(poll()), false);
  assert.equal(placeProblem(poll({ options }), { activityId: null, title: "Karaoke" }), "full");
});
