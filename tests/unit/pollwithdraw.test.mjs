// P42 · „Vertippt?“ – nachgereichten Vorschlag zurückziehen (src/lib/pollwithdraw.ts), gleiche Regeln wie `remove_poll_option`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { canWithdrawOption } from "../../src/lib/pollwithdraw.ts";

const now = new Date("2026-11-11T12:00:00Z");
const poll = (extra) => ({ status: "open", ends_at: "2026-11-12T17:00:00Z", created_by: "alice", ...extra });
const none = { yes: [], maybe: [], no: [] };
const added = { added_by: "bob" };

test("wer nachgereicht hat, zieht zurück – auch mit eigener Antwort", () => {
  assert.equal(canWithdrawOption(poll(), added, none, "bob", false, now), true);
  assert.equal(canWithdrawOption(poll(), added, { yes: ["bob"], maybe: [], no: [] }, "bob", false, now), true);
});

test("Vorschläge vom Start bleiben", () => {
  assert.equal(canWithdrawOption(poll(), { added_by: null }, none, "alice", true, now), false);
});

test("wer gestartet hat und Owner/Admin dürfen, andere Mitglieder nicht", () => {
  assert.equal(canWithdrawOption(poll(), added, none, "alice", false, now), true, "gestartet");
  assert.equal(canWithdrawOption(poll({ created_by: "carol" }), added, none, "dave", true, now), true, "Owner/Admin");
  assert.equal(canWithdrawOption(poll({ created_by: "carol" }), added, none, "dave", false, now), false, "einfaches Mitglied");
  assert.equal(canWithdrawOption(poll({ created_by: null }), added, none, "dave", false, now), false, "Ersteller:in gelöscht");
});

test("sobald jemand anderes antwortet, bleibt der Vorschlag – auch bei „Nicht dabei“ und bei Gästen", () => {
  assert.equal(canWithdrawOption(poll(), added, { yes: ["bob"], maybe: [], no: ["carol"] }, "bob", false, now), false);
  assert.equal(canWithdrawOption(poll(), added, { yes: [], maybe: ["carol"], no: [] }, "bob", false, now), false);
  assert.equal(canWithdrawOption(poll(), added, { yes: ["guest:1"], maybe: [], no: [] }, "alice", true, now), false);
});

test("nur solange die Abstimmung läuft", () => {
  assert.equal(canWithdrawOption(poll({ status: "closed" }), added, none, "bob", false, now), false, "beendet");
  assert.equal(canWithdrawOption(poll({ ends_at: "2026-11-11T12:00:00Z" }), added, none, "bob", false, now), false, "Frist erreicht");
});
