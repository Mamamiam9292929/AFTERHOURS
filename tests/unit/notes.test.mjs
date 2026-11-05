// P24 Etappe 3 · Zusätze zur Antwort für „Heute Abend“ auf Home (src/lib/notes.ts, Typen entfernt Node selbst).
import assert from "node:assert/strict";
import { test } from "node:test";
import { answerNotes } from "../../src/lib/notes.ts";

const p = (user_id, attendance_status, note, minute) => ({ user_id, attendance_status, note, responded_at: minute == null ? null : `2026-11-05T18:${String(minute).padStart(2, "0")}:00Z` });
const g = (id, display_name, attendance_status, note, minute) => ({ id, display_name, attendance_status, note, updated_at: `2026-11-05T18:${String(minute).padStart(2, "0")}:00Z` });

test("ohne Zusätze: leer", () => {
  assert.deepEqual(answerNotes({ participants: [p("me", "going", null, 1), p("bob", "maybe", undefined, 2)] }, "me"), []);
});

test("eigener zuerst, dann dabei, vielleicht, abgesagt; Gäste nach Mitgliedern; älteste Antwort zuerst", () => {
  const plan = {
    participants: [p("carol", "declined", "Nächstes Mal!", 1), p("bob", "maybe", "Sag bis mittags Bescheid", 5), p("dave", "going", "Komme später", 9), p("eva", "going", "Nur kurz", 2), p("me", "maybe", "Hängt vom Wetter ab", 7)],
    guests: [g("g1", "Dana", "going", "Bringe Uno mit", 0), g("g2", "Emil", "going", null, 1)],
  };
  const lines = answerNotes(plan, "me");
  assert.deepEqual(lines.map((l) => l.key), ["u:me", "u:eva", "u:dave", "g:g1", "u:bob", "u:carol"]);
  assert.equal(lines[0].mine, true);
  assert.equal(lines[3].guestName, "Dana");
  assert.equal(lines[3].userId, null);
  assert.deepEqual(Object.keys(lines[0]).sort(), ["guestName", "key", "mine", "note", "status", "userId"]);
});

test("ohne Antwort zählt ein (alter) Zusatz nicht", () => {
  assert.deepEqual(answerNotes({ participants: [p("bob", "invited", "komme später", null)] }, "me"), []);
});
