// P51 · „Ich bring wen mit“ – Begleitung zählt bei „dabei“ mit (src/lib/quorum.ts, src/lib/standing.ts).
// Gleiche Zählung wie `app_private.plan_going_count` auf dem Server (pgTAP 92_plan_plus_ones).
import assert from "node:assert/strict";
import { test } from "node:test";
import { goingHeads, goingWithGuests, heads, quorumLeft } from "../../src/lib/quorum.ts";
import { spotsLeft } from "../../src/lib/capacity.ts";
import { planStanding } from "../../src/lib/standing.ts";

const now = new Date("2026-11-13T12:00:00Z");

test("Köpfe einer Antwort: nur „Bin dabei“ zählt, Begleitung 0–3", () => {
  assert.equal(heads({ attendance_status: "going" }), 1, "ohne Angabe: nur die Person");
  assert.equal(heads({ attendance_status: "going", plus_ones: null }), 1);
  assert.equal(heads({ attendance_status: "going", plus_ones: 2 }), 3);
  assert.equal(heads({ attendance_status: "maybe", plus_ones: 2 }), 0, "„Vielleicht“ zählt nicht, auch nicht die Begleitung");
  assert.equal(heads({ attendance_status: "declined", plus_ones: 1 }), 0);
  assert.equal(heads({ attendance_status: "going", plus_ones: 9 }), 4, "mehr als 3 gibt es nicht");
  assert.equal(heads({ attendance_status: "going", plus_ones: -1 }), 1, "Unsinn zählt als 0");
});

test("Zusagen mit Begleitung und Gästen – wie auf dem Server", () => {
  const participants = [
    { attendance_status: "going", plus_ones: 2 },
    { attendance_status: "going" },
    { attendance_status: "maybe", plus_ones: 1 },
    { attendance_status: "invited" },
  ];
  assert.equal(goingHeads(participants), 4);
  assert.equal(goingWithGuests({ participants, guests: [{ attendance_status: "going" }, { attendance_status: "maybe" }] }), 5);
});

test("Mindest- und Höchstzahl rechnen mit Begleitung", () => {
  const plan = { min_going: 5, max_going: 5, status: "confirmed", starts_at: "2026-11-14T19:00:00Z" };
  const participants = [{ attendance_status: "going", plus_ones: 1 }, { attendance_status: "going", plus_ones: 2 }];
  const going = goingWithGuests({ participants });
  assert.equal(quorumLeft(plan, going, now), 0, "2 Zusagen + 3 Begleitungen = 5: findet statt");
  assert.equal(spotsLeft(plan, going, now), 0, "und voll");
});

test("Zwischenstand zählt Begleitung bei „dabei“, Gäste ohne", () => {
  const standing = planStanding(
    {
      status: "confirmed",
      starts_at: "2026-11-14T19:00:00Z",
      min_going: 6,
      participants: [
        { attendance_status: "going", plus_ones: 2 },
        { attendance_status: "maybe", plus_ones: 3 },
        { attendance_status: "invited" },
      ],
      guests: [{ attendance_status: "going", plus_ones: 3 }],
    },
    now,
  );
  assert.deepEqual(standing, { going: 4, maybe: 1, waiting: 0, open: 1, quorumLeft: 2, spotsLeft: null });
});
