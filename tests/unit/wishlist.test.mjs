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

// P22 Etappe 2
import { wishSuggestions, wishVisits } from "../../src/lib/wishlist.ts";

const plan = (id, extra = {}) => ({ id, crew_id: "crew", activity_id: "a", status: "completed", starts_at: "2026-10-10T18:00:00Z", ...extra });

test("„Waren wir schon“: letzter abgeschlossener Plan der Crew je Ort", () => {
  const visits = wishVisits(
    [
      plan("p1"),
      plan("p2", { starts_at: "2026-10-24T18:00:00Z" }),
      plan("p3", { starts_at: "2026-11-20T18:00:00Z", status: "confirmed" }),
      plan("p4", { starts_at: "2026-10-30T18:00:00Z", status: "cancelled" }),
      plan("p5", { starts_at: "2026-10-31T18:00:00Z", crew_id: "andere" }),
      plan("p6", { activity_id: null }),
      plan("p7", { activity_id: "b", starts_at: "kaputt" }),
    ],
    "crew",
  );
  assert.deepEqual([...visits.entries()], [["a", { planId: "p2", startsAt: "2026-10-24T18:00:00Z" }]]);
  assert.equal(wishVisits([], "crew").size, 0);
});

test("„Von eurer Liste“: ohne gewählte Orte, neueste zuerst, schon besuchte ans Ende, höchstens max", () => {
  const list = [wish("a"), wish("b"), wish("c"), wish("d"), wish("b")];
  const visits = new Map([["a", { planId: "p", startsAt: "2026-10-24T18:00:00Z" }]]);
  assert.deepEqual(wishSuggestions(list, new Set(["c"]), visits).map((w) => w.activity_id), ["b", "d", "a"]);
  assert.deepEqual(wishSuggestions(list, new Set(), new Map(), 2).map((w) => w.activity_id), ["a", "b"]);
  assert.deepEqual(wishSuggestions(list, new Set(["a", "b", "c", "d"])), []);
  assert.deepEqual(wishSuggestions([], new Set()), []);
});

test("„Von eurer Liste“: Demo-Orte nur, wenn die Liste nichts anderes hat", () => {
  const mixed = [wish("demo", { is_demo: true }), wish("echt")];
  assert.deepEqual(wishSuggestions(mixed, new Set()).map((w) => w.activity_id), ["echt"]);
  assert.deepEqual(wishSuggestions(mixed, new Set(["echt"])).map((w) => w.activity_id), []);
  assert.deepEqual(wishSuggestions([wish("demo", { is_demo: true })], new Set()).map((w) => w.activity_id), ["demo"]);
});
