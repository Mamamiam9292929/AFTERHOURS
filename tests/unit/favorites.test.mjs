// P29 Etappe 2 · Lieblingsabend: mindestens zwei „Nochmal!“, mehr als die Hälfte (src/lib/favorites.ts).
// Gleiche Fälle wie in supabase/tests/database/66_crew_favorite_evenings.test.sql.
import assert from "node:assert/strict";
import { test } from "node:test";
import { isFavoriteEvening } from "../../src/lib/favorites.ts";

test("Lieblingsabend ab zwei „Nochmal!“ und mehr als der Hälfte", () => {
  assert.equal(isFavoriteEvening({ again: 3, ok: 1, meh: 0 }), true, "3 von 4");
  assert.equal(isFavoriteEvening({ again: 2, ok: 0, meh: 0 }), true, "2 von 2");
  assert.equal(isFavoriteEvening({ again: 2, ok: 1, meh: 0 }), true, "2 von 3");
});

test("kein Lieblingsabend", () => {
  assert.equal(isFavoriteEvening({ again: 2, ok: 0, meh: 2 }), false, "genau die Hälfte reicht nicht");
  assert.equal(isFavoriteEvening({ again: 1, ok: 0, meh: 0 }), false, "eine Stimme allein reicht nicht");
  assert.equal(isFavoriteEvening({ again: 0, ok: 0, meh: 0 }), false, "ohne Urteile");
  assert.equal(isFavoriteEvening({ again: 3, ok: 2, meh: 2 }), false, "3 von 7");
});

test("unsinnige Zahlen zählen als 0", () => {
  assert.equal(isFavoriteEvening({ again: Number.NaN, ok: 0, meh: 0 }), false);
  assert.equal(isFavoriteEvening({ again: 2, ok: -5, meh: 0 }), true, "negative Gegenstimmen zählen nicht");
  assert.equal(isFavoriteEvening({ again: 2.9, ok: 0, meh: 1 }), true, "abgerundet: 2 von 3");
});
