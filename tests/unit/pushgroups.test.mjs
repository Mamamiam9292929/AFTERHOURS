// P4 Etappe 3 · Je Gerät wählen, was als Push ankommt (src/lib/pushgroups.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { devicePreset, ESSENTIAL_GROUPS, isGroupOnDevice, matchesPreset, setGroupOnDevice } from "../../src/lib/pushgroups.ts";

// Wie NOTIFICATION_GROUPS in den Einstellungen (Auszug mit mehreren Arten je Gruppe).
const GROUPS = [
  { key: "polls", types: ["poll_created"] },
  { key: "answers", types: ["poll_vote", "plan_attendance"] },
  { key: "results", types: ["poll_result"] },
  { key: "plans", types: ["plan_created", "plan_changed", "plan_cancelled"] },
  { key: "dayReminders", types: ["plan_day_reminder"] },
  { key: "spontaneous", types: ["spontaneous_ask", "spontaneous_answer", "spontaneous_match"] },
  { key: "rewards", types: ["reward_earned"] },
];

test("eine Gruppe ist an, solange keine ihrer Arten stumm ist", () => {
  assert.equal(isGroupOnDevice([], ["poll_vote", "plan_attendance"]), true);
  assert.equal(isGroupOnDevice(["plan_attendance"], ["poll_vote", "plan_attendance"]), false);
  assert.equal(isGroupOnDevice(["reward_earned"], ["poll_vote", "plan_attendance"]), true);
});

test("Gruppe aus- und wieder anschalten lässt andere Arten unberührt", () => {
  const off = setGroupOnDevice(["reward_earned"], ["poll_vote", "plan_attendance"], false);
  assert.deepEqual(off, ["plan_attendance", "poll_vote", "reward_earned"]);
  assert.deepEqual(setGroupOnDevice(off, ["poll_vote", "plan_attendance"], true), ["reward_earned"]);
  // Halb stumme Gruppe (z. B. von einer älteren Version) wird beim Anschalten ganz an.
  assert.deepEqual(setGroupOnDevice(["poll_vote"], ["poll_vote", "plan_attendance"], true), []);
  // Doppeltes Ausschalten erzeugt keine Dubletten.
  assert.deepEqual(setGroupOnDevice(off, ["poll_vote", "plan_attendance"], false), off);
});

test("„Alles“ schaltet nichts stumm", () => {
  assert.deepEqual(devicePreset(GROUPS, "all"), []);
  assert.equal(matchesPreset(GROUPS, [], "all"), true);
  assert.equal(matchesPreset(GROUPS, [], "essentials"), false);
});

test("„Nur das Wichtigste“ lässt Abstimmungen, Ergebnisse, Pläne, den Tag des Plans und spontane Fragen durch", () => {
  const muted = devicePreset(GROUPS, "essentials");
  assert.deepEqual(muted, ["plan_attendance", "poll_vote", "reward_earned"]);
  for (const group of GROUPS) assert.equal(isGroupOnDevice(muted, group.types), ESSENTIAL_GROUPS.includes(group.key), group.key);
  assert.equal(matchesPreset(GROUPS, muted, "essentials"), true);
  assert.equal(matchesPreset(GROUPS, muted, "all"), false);
  // Weicht eine Gruppe ab, passt keine Vorgabe mehr.
  assert.equal(matchesPreset(GROUPS, setGroupOnDevice(muted, ["poll_created"], false), "essentials"), false);
});

test("nur gültige Arten für den Server: Kleinbuchstaben und Unterstrich", () => {
  for (const type of devicePreset(GROUPS, "essentials")) assert.match(type, /^[a-z_]{1,40}$/);
});
