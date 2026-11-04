// P22 · „Wollen wir mal hin“ (src/lib/wishlist.ts, Typen entfernt Node selbst).
import assert from "node:assert/strict";
import { test } from "node:test";
import { wishPollItems, wishPriceCents } from "../../src/lib/wishlist.ts";

const wish = (id, extra = {}) => ({
  activity_id: id,
  added_by: "bob",
  created_at: "2026-11-04T10:00:00Z",
  name: `Ort ${id}`,
  category: "bar",
  city: "Leipzig",
  is_demo: false,
  price_min_cents: null,
  price_max_cents: null,
  can_remove: true,
  ...extra,
});

test("Preis wie in Discover: Mitte der Spanne auf ganze Euro, sonst der eine Wert, sonst unbekannt", () => {
  assert.equal(wishPriceCents({ price_min_cents: 1000, price_max_cents: 1500 }), 1300);
  assert.equal(wishPriceCents({ price_min_cents: 800, price_max_cents: null }), 800);
  assert.equal(wishPriceCents({ price_min_cents: null, price_max_cents: 2000 }), 2000);
  assert.equal(wishPriceCents({ price_min_cents: null, price_max_cents: null }), null);
});

test("Reihenfolge der Liste bleibt, jeder Ort einmal, Titel und Preis für den Sammelkorb", () => {
  const items = wishPollItems([wish("a", { price_min_cents: 1200, price_max_cents: 1200 }), wish("b"), wish("a")]);
  assert.deepEqual(items, [
    { activityId: "a", title: "Ort a", priceCents: 1200 },
    { activityId: "b", title: "Ort b", priceCents: null },
  ]);
});

test("höchstens zehn Vorschläge – die neuesten", () => {
  const list = Array.from({ length: 14 }, (_, i) => wish(`o${i}`));
  const items = wishPollItems(list);
  assert.equal(items.length, 10);
  assert.equal(items[0].activityId, "o0");
  assert.equal(items[9].activityId, "o9");
  assert.equal(wishPollItems(list, 3).length, 3);
});

test("Demo-Orte nicht unbemerkt mit echten mischen", () => {
  assert.deepEqual(
    wishPollItems([wish("demo", { is_demo: true }), wish("echt")]).map((i) => i.activityId),
    ["echt"],
  );
  assert.deepEqual(
    wishPollItems([wish("d1", { is_demo: true }), wish("d2", { is_demo: true })]).map((i) => i.activityId),
    ["d1", "d2"],
  );
  assert.deepEqual(wishPollItems([]), []);
});
