// P35 · Crew stummschalten (src/lib/crewmute.ts): Stand der Karte – gleiche Regel wie app_private.queue_push.
import assert from "node:assert/strict";
import { test } from "node:test";
import { activeCrewMuteMode, crewMuteState, CREW_MUTE_MODES } from "../../src/lib/crewmute.ts";

const now = new Date("2026-11-10T13:00:00Z"); // 14:00 Uhr in Berlin

test("ohne Zeile laut, ohne Ende stumm", () => {
  assert.deepEqual(crewMuteState(null, now), { kind: "on" });
  assert.deepEqual(crewMuteState(undefined, now), { kind: "on" });
  assert.deepEqual(crewMuteState({ muted_until: null }, now), { kind: "always" });
});

test("mit Ende nur bis dahin, danach wieder laut", () => {
  const s = crewMuteState({ muted_until: "2026-11-10T21:00:00Z" }, now);
  assert.equal(s.kind, "until");
  assert.equal(s.sameDay, true, "22 Uhr Berliner Zeit ist noch heute");
  assert.deepEqual(crewMuteState({ muted_until: "2026-11-10T13:00:00Z" }, now), { kind: "on" }, "genau abgelaufen");
  assert.deepEqual(crewMuteState({ muted_until: "2026-11-09T13:00:00Z" }, now), { kind: "on" }, "längst abgelaufen");
  assert.deepEqual(crewMuteState({ muted_until: "kaputt" }, now), { kind: "on" }, "Unlesbares gilt als laut");
});

test("Tagesgrenze in Berliner Zeit, nicht UTC", () => {
  // 23:30 UTC = 00:30 Uhr am nächsten Tag in Berlin.
  assert.equal(crewMuteState({ muted_until: "2026-11-10T23:30:00Z" }, now).sameDay, false);
  assert.equal(crewMuteState({ muted_until: "2026-11-10T22:30:00Z" }, now).sameDay, true, "23:30 Uhr Berlin");
});

test("gewählte Dauer", () => {
  assert.equal(activeCrewMuteMode({ kind: "on" }, now), null);
  assert.equal(activeCrewMuteMode({ kind: "always" }, now), "always");
  assert.equal(activeCrewMuteMode(crewMuteState({ muted_until: "2026-11-10T21:00:00Z" }, now), now), "8h");
  assert.equal(activeCrewMuteMode(crewMuteState({ muted_until: "2026-11-10T21:00:30Z" }, now), now), "8h", "kleine Uhrabweichung");
  assert.equal(activeCrewMuteMode(crewMuteState({ muted_until: "2026-11-17T13:00:00Z" }, now), now), "week");
  assert.deepEqual([...CREW_MUTE_MODES], ["8h", "week", "always"]);
});
