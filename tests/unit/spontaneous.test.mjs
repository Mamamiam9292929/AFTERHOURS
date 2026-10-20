// S4 · „Heute noch wer?“ (src/lib/spontaneous.ts, Typen entfernt Node selbst).
import assert from "node:assert/strict";
import { test } from "node:test";
import { crewsFreeToAsk, formatLeft, isAskOpen, minutesLeft, openAsks, summarizeAsk } from "../../src/lib/spontaneous.ts";

const NOW = new Date("2026-10-20T18:00:00Z");
const ask = (over = {}) => ({
  id: "a1",
  crew_id: "c1",
  created_by: "alice",
  note: null,
  created_at: "2026-10-20T17:30:00Z",
  expires_at: "2026-10-20T19:30:00Z",
  closed_at: null,
  matched_at: null,
  answers: [],
  ...over,
});
const answer = (user_id, value, at) => ({ ask_id: "a1", user_id, answer: value, answered_at: at });

test("offen: weder beendet noch abgelaufen – genau zum Ablauf ist sie vorbei", () => {
  assert.equal(isAskOpen(ask(), NOW), true);
  assert.equal(isAskOpen(ask({ closed_at: "2026-10-20T17:45:00Z" }), NOW), false);
  assert.equal(isAskOpen(ask({ expires_at: "2026-10-20T18:00:00Z" }), NOW), false);
  assert.equal(isAskOpen(ask({ expires_at: "2026-10-20T17:59:59Z" }), NOW), false);
});

test("laufende Fragen: jüngste zuerst, je Crew nur eine, Abgelaufenes fällt weg", () => {
  const list = [
    ask({ id: "old", created_at: "2026-10-20T16:00:00Z", expires_at: "2026-10-20T18:00:00Z" }),
    ask({ id: "c1-a", created_at: "2026-10-20T17:00:00Z" }),
    ask({ id: "c1-b", created_at: "2026-10-20T17:10:00Z" }),
    ask({ id: "c2", crew_id: "c2", created_at: "2026-10-20T17:05:00Z" }),
  ];
  assert.deepEqual(openAsks(list, NOW).map((a) => a.id), ["c1-b", "c2"]);
  assert.deepEqual(openAsks([], NOW), []);
});

test("Restzeit: aufgerundet, nie negativ, Stunden mit Minuten", () => {
  assert.equal(minutesLeft(ask(), NOW), 90);
  assert.equal(minutesLeft(ask({ expires_at: "2026-10-20T18:00:30Z" }), NOW), 1);
  assert.equal(minutesLeft(ask({ expires_at: "2026-10-20T17:00:00Z" }), NOW), 0);
  // Die Uhr der Seite stammt aus der Minute vor dem Fragen: nie mehr als 2:00 h.
  assert.equal(minutesLeft(ask({ created_at: "2026-10-20T18:00:40Z", expires_at: "2026-10-20T20:00:40Z" }), NOW), 120);
  assert.equal(minutesLeft({ expires_at: "2026-10-20T20:00:40Z" }, NOW), 121, "ohne Startzeit keine Kappung");
  assert.equal(formatLeft(120), "2:00 h");
  assert.equal(formatLeft(94), "1:34 h");
  assert.equal(formatLeft(60), "1:00 h");
  assert.equal(formatLeft(59), "59 min");
  assert.equal(formatLeft(0), "0 min");
});

test("Zusammenfassung: Reihenfolge der Zusagen, eigene Antwort, was noch fehlt", () => {
  const a = ask({
    answers: [answer("carol", "in", "2026-10-20T17:40:00Z"), answer("alice", "in", "2026-10-20T17:30:00Z"), answer("bob", "out", "2026-10-20T17:35:00Z")],
  });
  assert.deepEqual(summarizeAsk(a, "bob"), { inIds: ["alice", "carol"], outIds: ["bob"], mine: "out", matched: false, missing: 1 });
  assert.equal(summarizeAsk(a, "dave").mine, null);
  assert.equal(summarizeAsk(ask(), "dave").missing, 3);
});

test("Runde steht ab drei Zusagen oder wenn der Server es sagt; Ehemalige zählen nicht", () => {
  const three = ask({ answers: ["alice", "bob", "carol"].map((u, i) => answer(u, "in", `2026-10-20T17:3${i}:00Z`)) });
  assert.equal(summarizeAsk(three, "alice").matched, true);
  assert.equal(summarizeAsk(three, "alice").missing, 0);
  // Carol hat die Crew verlassen: nur noch zwei – aber der Server hatte die Runde schon gemeldet.
  assert.equal(summarizeAsk(three, "alice", ["alice", "bob"]).matched, false);
  assert.deepEqual(summarizeAsk(three, "alice", ["alice", "bob"]).inIds, ["alice", "bob"]);
  assert.equal(summarizeAsk({ ...three, matched_at: "2026-10-20T17:32:00Z" }, "alice", ["alice", "bob"]).matched, true);
});

test("neu fragen nur in Crews ohne laufende Frage", () => {
  const crews = [{ id: "c1" }, { id: "c2" }, { id: "c3" }];
  const asks = [ask(), ask({ crew_id: "c2", closed_at: "2026-10-20T17:50:00Z" }), ask({ crew_id: "c3", expires_at: "2026-10-20T17:00:00Z" })];
  assert.deepEqual(crewsFreeToAsk(crews, asks, NOW).map((c) => c.id), ["c2", "c3"]);
});
