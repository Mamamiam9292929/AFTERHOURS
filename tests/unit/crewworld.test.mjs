// V2 Etappe 3i · Farbwelt und Hervorhebung der Crew-Zeile (src/lib/crewWorld.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { CREW_WORLDS, crewPulse, crewWorld } from "../../src/lib/crewWorld.ts";

test("gleiche Crew, gleiche Farbwelt", () => {
  const id = "3f1c2a9e-7b1d-4c55-9a0e-2f6d8b1e4a10";
  assert.equal(crewWorld(id), crewWorld(id));
  assert.ok(CREW_WORLDS.includes(crewWorld(id)));
});

test("Crews verteilen sich auf alle Farbwelten", () => {
  const seen = new Map();
  for (let i = 0; i < 400; i++) {
    const world = crewWorld(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    seen.set(world, (seen.get(world) ?? 0) + 1);
  }
  assert.equal(seen.size, CREW_WORLDS.length);
  for (const n of seen.values()) assert.ok(n > 50, `zu ungleich verteilt: ${[...seen]}`);
});

test("laufende Abstimmung vor anstehendem Plan vor Ruhe", () => {
  assert.equal(crewPulse(2, 1), "polls");
  assert.equal(crewPulse(0, 3), "plans");
  assert.equal(crewPulse(0, 0), "quiet");
});
