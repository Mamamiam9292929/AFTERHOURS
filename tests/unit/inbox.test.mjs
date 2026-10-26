// V2 Etappe 3l · Benachrichtigungen als Stapel (src/lib/inbox.ts): Bereich, Farbschein, Tagesgruppen in Berliner Zeit.
import assert from "node:assert/strict";
import { test } from "node:test";
import { groupInbox, inboxArea, inboxGroup, inboxTone } from "../../src/lib/inbox.ts";

const TYPES = [
  "crew_member_joined", "crew_member_removed", "crew_role_changed",
  "poll_created", "poll_reminder", "poll_vote", "poll_result",
  "plan_created", "plan_changed", "plan_cancelled", "plan_attendance",
  "booking_status", "ride_request", "ride_confirmed", "reward_earned",
  "plan_expense", "plan_settlement", "plan_expense_reminder",
  "spontaneous_ask", "spontaneous_answer", "spontaneous_match",
];

test("jede Art hat einen Bereich und einen Farbschein", () => {
  for (const type of TYPES) {
    assert.ok(["poll", "plan", "crew", "money", "spontaneous", "reward"].includes(inboxArea(type)), type);
    assert.ok(["violet", "lime", "pink", "amber", "danger"].includes(inboxTone(type)), type);
  }
  assert.equal(inboxArea("poll_created"), "poll");
  assert.equal(inboxArea("ride_request"), "plan");
  assert.equal(inboxArea("plan_expense_reminder"), "money");
  assert.equal(inboxArea("spontaneous_match"), "spontaneous");
  assert.equal(inboxArea("etwas_neues"), "crew", "unbekannte Art verschwindet nicht");
});

test("schlechte Nachrichten tragen Rot, Aussetzen Gelb", () => {
  assert.equal(inboxTone("plan_cancelled"), "danger");
  assert.equal(inboxTone("plan_cancelled", { skipped: true }), "amber");
  assert.equal(inboxTone("crew_member_removed"), "danger");
  assert.equal(inboxTone("ride_confirmed", { accepted: true }), "lime");
  assert.equal(inboxTone("ride_confirmed", { accepted: false }), "danger");
  assert.equal(inboxTone("booking_status", { status: "confirmed" }), "lime");
  assert.equal(inboxTone("booking_status", { status: "unavailable" }), "danger");
  assert.equal(inboxTone("poll_created"), "violet");
});

test("Tagesgruppen nach Berliner Kalendertag", () => {
  // Montag, 26.10.2026, 00:30 in Berlin (23:30 UTC am Vortag).
  const now = new Date("2026-10-25T23:30:00Z");
  assert.equal(inboxGroup("2026-10-25T23:05:00Z", now), "today", "kurz nach Mitternacht Berlin = heute");
  assert.equal(inboxGroup("2026-10-25T22:55:00Z", now), "yesterday", "23:55 Berlin am Sonntag = gestern, obwohl erst 35 Minuten her");
  assert.equal(inboxGroup("2026-10-24T08:00:00Z", now), "week");
  assert.equal(inboxGroup("2026-10-20T12:00:00Z", now), "week", "vor 6 Tagen");
  assert.equal(inboxGroup("2026-10-19T12:00:00Z", now), "older", "vor 7 Tagen");
  assert.equal(inboxGroup("2026-10-26T10:00:00Z", now), "today", "Uhr leicht voraus: zählt als heute");
});

test("Gruppen in fester Reihenfolge, leere fallen weg, Reihenfolge bleibt", () => {
  const now = new Date("2026-10-26T15:00:00Z");
  const items = [
    { id: "a", created_at: "2026-10-26T14:00:00Z" },
    { id: "b", created_at: "2026-10-26T09:00:00Z" },
    { id: "c", created_at: "2026-10-10T09:00:00Z" },
  ];
  const groups = groupInbox(items, now);
  assert.deepEqual(groups.map((g) => g.key), ["today", "older"]);
  assert.deepEqual(groups[0].items.map((i) => i.id), ["a", "b"]);
  assert.deepEqual(groupInbox([], now), []);
});
