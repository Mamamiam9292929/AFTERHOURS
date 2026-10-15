// P3 · Kosten aufteilen: Salden und Überweisungen (src/lib/settle.ts, Typen entfernt Node selbst).
import assert from "node:assert/strict";
import { test } from "node:test";
import { balances, settle, splitEvenly } from "../../src/lib/settle.ts";

const expense = (paid_by, shares) => ({ paid_by, shares: Object.entries(shares).map(([user_id, amount_cents]) => ({ user_id, amount_cents })) });

test("eine Ausgabe für zwei: die andere Person gibt die Hälfte", () => {
  const list = [expense("alice", { alice: 2400, bob: 2400 })];
  assert.deepEqual([...balances(list)], [["alice", 2400], ["bob", -2400]]);
  assert.deepEqual(settle(list), [{ from: "bob", to: "alice", cents: 2400 }]);
});

test("Beispiel aus der Journey: Bowlingbahn und Getränke", () => {
  const list = [expense("alice", { alice: 2400, bob: 2400 }), expense("bob", { alice: 500, bob: 500, carol: 500 })];
  assert.deepEqual(Object.fromEntries(balances(list)), { alice: 1900, bob: -1400, carol: -500 });
  assert.deepEqual(settle(list), [
    { from: "bob", to: "alice", cents: 1400 },
    { from: "carol", to: "alice", cents: 500 },
  ]);
});

test("Rückzahlung gleicht aus", () => {
  const list = [expense("alice", { alice: 2400, bob: 2400 }), expense("bob", { alice: 2400 })];
  assert.equal(balances(list).size, 0);
  assert.deepEqual(settle(list), []);
});

test("teilweise Rückzahlung lässt den Rest stehen", () => {
  const list = [expense("alice", { alice: 2400, bob: 2400 }), expense("bob", { alice: 1000 })];
  assert.deepEqual(settle(list), [{ from: "bob", to: "alice", cents: 1400 }]);
});

test("gegenseitige Schulden heben sich auf", () => {
  const list = [expense("alice", { bob: 1000 }), expense("bob", { alice: 1000 })];
  assert.deepEqual(settle(list), []);
});

test("Ausgabe nur für andere: die zahlende Person ist nicht beteiligt", () => {
  const list = [expense("bob", { carol: 1200 })];
  assert.deepEqual(settle(list), [{ from: "carol", to: "bob", cents: 1200 }]);
});

test("Summe aller Überweisungen = Summe der Schulden, höchstens n−1 Überweisungen", () => {
  const people = ["a", "b", "c", "d", "e"];
  let seed = 7;
  const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const list = Array.from({ length: 30 }, () => {
    const payer = people[Math.floor(random() * people.length)];
    const shares = {};
    for (const p of people) if (random() > 0.4) shares[p] = Math.floor(random() * 5000);
    return expense(payer, shares);
  });
  const owed = [...balances(list).values()].filter((v) => v < 0).reduce((s, v) => s - v, 0);
  const transfers = settle(list);
  assert.equal(transfers.reduce((s, t) => s + t.cents, 0), owed);
  assert.ok(transfers.length <= people.length - 1);
  assert.ok(transfers.every((t) => t.cents > 0 && t.from !== t.to));
  // Nach allen Überweisungen ist jeder ausgeglichen.
  const after = [...list, ...transfers.map((t) => expense(t.from, { [t.to]: t.cents }))];
  assert.equal(balances(after).size, 0);
});

test("gleiche Beträge: Reihenfolge nach ID, damit alle Geräte dasselbe zeigen", () => {
  const list = [expense("z", { a: 500, b: 500 })];
  assert.deepEqual(settle(list), [
    { from: "a", to: "z", cents: 500 },
    { from: "b", to: "z", cents: 500 },
  ]);
});

test("gleichmäßig teilen wie der Server: Rest-Cent an die Ersten", () => {
  assert.deepEqual(splitEvenly(1000, 3), [334, 333, 333]);
  assert.deepEqual(splitEvenly(4800, 2), [2400, 2400]);
  assert.deepEqual(splitEvenly(1, 3), [1, 0, 0]);
  assert.deepEqual(splitEvenly(500, 0), []);
});
