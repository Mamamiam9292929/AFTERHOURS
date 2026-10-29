// P11 Etappe 2e · „Stichwahl: …“ vom Server auf Englisch als „Runoff: …“ (src/lib/servertitle.ts, api/_lib/share-card.js).
import assert from "node:assert/strict";
import { test } from "node:test";
import { describeSharedPoll } from "../../api/_lib/share-card.js";
import { localizedServerTitle } from "../../src/lib/servertitle.ts";

test("nur auf Englisch und nur genau dieser Anfang", () => {
  assert.equal(localizedServerTitle("Stichwahl: Bowling oder Kino?", "en"), "Runoff: Bowling oder Kino?");
  assert.equal(localizedServerTitle("Stichwahl: Bowling oder Kino?", "de"), "Stichwahl: Bowling oder Kino?");
  assert.equal(localizedServerTitle("Bowling", "en"), "Bowling");
  assert.equal(localizedServerTitle("Die Stichwahl: wer kommt?", "en"), "Die Stichwahl: wer kommt?", "nur am Anfang");
  assert.equal(localizedServerTitle("Stichwahl:Bowling", "en"), "Stichwahl:Bowling", "nur mit Leerzeichen wie vom Server");
  assert.equal(localizedServerTitle("Runoff: Bowling", "en"), "Runoff: Bowling", "schon englisch bleibt");
});

test("Teilen-Karte: Titel der Stichwahl auf Englisch, auf Deutsch unverändert", () => {
  const preview = { status: "valid", poll: { title: "Stichwahl: Freitag", status: "open", option_count: 2, voter_count: 1, ends_at: "2026-10-30T18:00:00Z" } };
  assert.equal(describeSharedPoll(preview, "en").title, "Runoff: Freitag · AFTERHOURS");
  assert.equal(describeSharedPoll(preview, "de").title, "Stichwahl: Freitag · AFTERHOURS");
});
