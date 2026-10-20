// V2 Etappe 3a · Discover-Stapel (src/lib/stage.ts, Typen entfernt Node selbst).
import assert from "node:assert/strict";
import { test } from "node:test";
import { categoryWorld, DECK_SIZE, rankStage, stepDeck } from "../../src/lib/stage.ts";

const place = (id, distanceKm, open = false, category = "bar") => ({ activity: { id, name: id, category, open }, distanceKm });
const isOpen = (activity) => activity.open;
const ids = (list) => list.map((r) => r.activity.id);

test("offene Orte zuerst, dann die näheren", () => {
  const ranked = rankStage([place("weit", 9), place("nah", 1), place("offen-weit", 12, true), place("offen-nah", 3, true)], isOpen);
  assert.deepEqual(ids(ranked), ["offen-nah", "offen-weit", "nah", "weit"]);
});

test("ohne Öffnungszeiten und Entfernung bleibt die Reihenfolge der Suche", () => {
  const ranked = rankStage([place("a", null), place("b", null), place("c", null)], isOpen);
  assert.deepEqual(ids(ranked), ["a", "b", "c"]);
});

test("Orte ohne Koordinaten kommen hinter Orte mit Entfernung", () => {
  const ranked = rankStage([place("ohne", null), place("mit", 40)], isOpen);
  assert.deepEqual(ids(ranked), ["mit", "ohne"]);
});

test("Stapel ist begrenzt, leere Liste ergibt leeren Stapel", () => {
  const many = Array.from({ length: 20 }, (_, i) => place(`p${i}`, i));
  assert.equal(rankStage(many, isOpen).length, DECK_SIZE);
  assert.deepEqual(ids(rankStage(many, isOpen, 2)), ["p0", "p1"]);
  assert.deepEqual(rankStage([], isOpen), []);
});

test("verändert die Eingabe nicht", () => {
  const input = [place("b", 5), place("a", 1)];
  rankStage(input, isOpen);
  assert.deepEqual(ids(input), ["b", "a"]);
});

test("Blättern läuft im Kreis", () => {
  assert.equal(stepDeck(0, 4, 1), 1);
  assert.equal(stepDeck(3, 4, 1), 0);
  assert.equal(stepDeck(0, 4, -1), 3);
  assert.equal(stepDeck(2, 1, 1), 0);
  assert.equal(stepDeck(5, 0, 1), 0);
});

test("jede Kategorie hat eine Farbwelt", () => {
  const categories = ["restaurant", "cafe", "bar", "cinema", "bowling", "minigolf", "swimming", "lasertag", "escape_room", "karting", "sport", "outdoor", "concert", "event", "trip", "other"];
  for (const c of categories) assert.ok(["food", "night", "play", "outside"].includes(categoryWorld(c)), c);
  assert.equal(categoryWorld("restaurant"), "food");
  assert.equal(categoryWorld("bowling"), "play");
  assert.equal(categoryWorld("outdoor"), "outside");
});
