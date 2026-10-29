// P14 Etappe 2 · Wer bringt was? auf Home und Vorlagen je Anlass (src/lib/bring.ts, Typen entfernt Node selbst).
import assert from "node:assert/strict";
import { test } from "node:test";
import { bringSummary, guessTemplate, sameLabel, templateSuggestions } from "../../src/lib/bring.ts";

const item = (id, label, claimed_by, minute) => ({ id, label, claimed_by, created_at: `2026-10-29T18:${String(minute).padStart(2, "0")}:00Z` });

test("leere Liste: keine Zusammenfassung", () => {
  assert.equal(bringSummary([], "me"), null);
});

test("eigene Sachen und offene getrennt, in der Reihenfolge des Eintragens", () => {
  const items = [item("c", "Chips", null, 3), item("k", "Kohle", "me", 1), item("u", "Uno", "bob", 2), item("b", "Bier", "me", 4), item("e", "Eis", null, 0)];
  const s = bringSummary(items, "me");
  assert.deepEqual(s.mine, ["Kohle", "Bier"]);
  assert.deepEqual(s.open, [{ id: "e", label: "Eis" }, { id: "c", label: "Chips" }]);
  assert.equal(s.total, 5);
});

test("alles von anderen vergeben: nichts Eigenes, nichts offen", () => {
  const s = bringSummary([item("u", "Uno", "bob", 1)], "me");
  assert.deepEqual(s.mine, []);
  assert.deepEqual(s.open, []);
});

test("Vorlage aus dem Plantitel", () => {
  assert.equal(guessTemplate("Grillen am See"), "grill");
  assert.equal(guessTemplate("BBQ bei Tom"), "grill");
  assert.equal(guessTemplate("Spieleabend"), "games");
  assert.equal(guessTemplate("Game night"), "games");
  assert.equal(guessTemplate("Picknick im Park"), "picnic");
  assert.equal(guessTemplate("Filmabend"), "movie");
  assert.equal(guessTemplate("Movie night"), "movie");
  assert.equal(guessTemplate("Kino: Dune"), null); // im Kino bringt niemand Popcorn mit
  assert.equal(guessTemplate("Bowling"), null);
  assert.equal(guessTemplate("Kicker im Hof"), null);
});

test("Vorschläge ohne das, was schon auf der Liste steht (ohne Groß/Klein)", () => {
  assert.deepEqual(templateSuggestions(["Kohle", "Grillgut", "Brot"], ["kohle", " Brot "], 10), ["Grillgut"]);
});

test("nie mehr Vorschläge, als noch Platz auf der Liste ist", () => {
  assert.deepEqual(templateSuggestions(["A", "B", "C"], [], 2), ["A", "B"]);
  assert.deepEqual(templateSuggestions(["A"], [], 0), []);
});

test("gleiche Sache trotz Schreibweise", () => {
  assert.ok(sameLabel("Snacks  für die Bahn", "snacks für die bahn"));
  assert.ok(!sameLabel("Chips", "Dips"));
});
