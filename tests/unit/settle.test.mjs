// P3 · Kosten aufteilen: Salden und Überweisungen (src/lib/settle.ts, Typen entfernt Node selbst).
import assert from "node:assert/strict";
import { test } from "node:test";
import { balances, isCustomSplit, openPlans, pairTotals, settle, settleBalances, splitCustom, splitEvenly } from "../../src/lib/settle.ts";

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

// ---- P3 Etappe 2: ungleich aufteilen ----------------------------------------------------------------

test("ungleich: alle Felder ausgefüllt und die Summe stimmt", () => {
  const split = splitCustom(3000, [1200, 1500, 300]);
  assert.equal(split.status, "ok");
  assert.deepEqual(split.shares, [1200, 1500, 300]);
  assert.equal(split.rest, 0);
});

test("ungleich: leere Felder teilen sich den Rest, Rest-Cent an die Ersten", () => {
  const split = splitCustom(1000, [null, 300, null, null]);
  assert.equal(split.status, "ok");
  assert.deepEqual(split.fill, [234, 233, 233]);
  assert.deepEqual(split.shares, [234, 300, 233, 233]);
  assert.equal(split.shares.reduce((a, b) => a + b, 0), 1000);
});

test("ungleich: Beispiel aus der Journey (Bob 18 €, Alice leer → 12 €)", () => {
  assert.deepEqual(splitCustom(3000, [null, 1800]).shares, [1200, 1800]);
});

test("ungleich: zu viel, noch offen, nichts übrig, 0 €", () => {
  assert.equal(splitCustom(3000, [2000, 1200]).status, "over");
  assert.equal(splitCustom(3000, [2000, 1200]).rest, -200);
  assert.equal(splitCustom(3000, [2000, 800]).status, "open");
  assert.equal(splitCustom(3000, [2000, 800]).rest, 200);
  assert.equal(splitCustom(3000, [3000, null]).status, "nothing_left");
  assert.equal(splitCustom(3001, [3000, null, null]).status, "nothing_left");
  assert.equal(splitCustom(3000, [3000, 0]).status, "zero");
  assert.equal(splitCustom(3000, [2000, 800]).shares, null);
});

test("ungleich: zufällige Eingaben ergeben bei ok immer genau den Betrag, jeder Anteil ≥ 1 Cent", () => {
  let seed = 7;
  const rand = (n) => ((seed = (seed * 1103515245 + 12345) % 2147483648) % n);
  for (let i = 0; i < 500; i++) {
    const total = 1 + rand(20000);
    const entries = Array.from({ length: 1 + rand(8) }, () => (rand(3) === 0 ? null : rand(6000)));
    const split = splitCustom(total, entries);
    if (split.status !== "ok") continue;
    assert.equal(split.shares.reduce((a, b) => a + b, 0), total);
    assert.ok(split.shares.every((cents) => cents >= 1));
    entries.forEach((cents, index) => cents != null && assert.equal(split.shares[index], cents));
  }
});

test("ungleich erkennen: Rest-Cent zählt nicht als ungleich", () => {
  const shares = (...amounts) => amounts.map((amount_cents, i) => ({ user_id: String(i), amount_cents }));
  assert.equal(isCustomSplit(shares(334, 333, 333)), false);
  assert.equal(isCustomSplit(shares(1200, 1800)), true);
  assert.equal(isCustomSplit(shares(500)), false);
});

// ---- P3 Etappe 3: Salden vom Server je Plan --------------------------------------------------------

test("settleBalances rechnet aus fertigen Salden wie settle aus Einträgen", () => {
  const list = [expense("alice", { alice: 2400, bob: 2400 }), expense("bob", { alice: 500, bob: 500, carol: 500 })];
  assert.deepEqual(settleBalances(balances(list)), settle(list));
  assert.deepEqual(settleBalances(new Map([["alice", 0]])), []);
});

test("openPlans: eigener Stand je Abend und über alle Abende", () => {
  const rows = [
    { plan_id: "bowling", user_id: "alice", balance_cents: 2100 },
    { plan_id: "bowling", user_id: "bob", balance_cents: -1800 },
    { plan_id: "bowling", user_id: "carol", balance_cents: -300 },
    { plan_id: "kino", user_id: "alice", balance_cents: -1500 },
    { plan_id: "kino", user_id: "carol", balance_cents: 1500 },
    { plan_id: "pizza", user_id: "bob", balance_cents: 700 },
    { plan_id: "pizza", user_id: "carol", balance_cents: -700 },
  ];
  const { plans, total } = openPlans(rows, "alice");
  assert.equal(total, 600);
  assert.deepEqual(plans.map((p) => [p.planId, p.mine]), [["bowling", 2100], ["kino", -1500], ["pizza", 0]]);
  assert.deepEqual(plans[0].transfers, [
    { from: "bob", to: "alice", cents: 1800 },
    { from: "carol", to: "alice", cents: 300 },
  ]);
  assert.deepEqual(plans[2].transfers, [{ from: "carol", to: "bob", cents: 700 }]);
});

test("openPlans: nichts offen, Nullzeilen werden ignoriert", () => {
  assert.deepEqual(openPlans([], "alice"), { plans: [], total: 0 });
  assert.deepEqual(openPlans([{ plan_id: "x", user_id: "alice", balance_cents: 0 }], "alice"), { plans: [], total: 0 });
});

// P3 Etappe 3c · Alles auf einmal ausgleichen – dieselben Zahlen wie im pgTAP-Test 30_crew_settle_pair.
test("pairTotals: Summe je Person über alle Abende, Gegenrichtung wird verrechnet", () => {
  const rows = [
    // Bowling: Bob gibt Alice 24 €.
    { plan_id: "bowling", user_id: "alice", balance_cents: 2400 },
    { plan_id: "bowling", user_id: "bob", balance_cents: -2400 },
    // Kino: Bob und Carol geben Alice je 10 €.
    { plan_id: "kino", user_id: "alice", balance_cents: 2000 },
    { plan_id: "kino", user_id: "bob", balance_cents: -1000 },
    { plan_id: "kino", user_id: "carol", balance_cents: -1000 },
    // Pizza: Alice gibt Bob 6 €.
    { plan_id: "pizza", user_id: "alice", balance_cents: -600 },
    { plan_id: "pizza", user_id: "bob", balance_cents: 600 },
    // Eis: Alice gibt Carol 10 €.
    { plan_id: "eis", user_id: "alice", balance_cents: -1000 },
    { plan_id: "eis", user_id: "carol", balance_cents: 1000 },
  ];
  const bob = pairTotals(openPlans(rows, "bob").plans, "bob");
  assert.deepEqual(bob, [{ other: "alice", net: -2800, plans: [{ planId: "bowling", cents: -2400 }, { planId: "kino", cents: -1000 }, { planId: "pizza", cents: 600 }] }]);

  const alice = pairTotals(openPlans(rows, "alice").plans, "alice");
  assert.deepEqual(alice.map((p) => [p.other, p.net, p.plans.length]), [["bob", 2800, 3], ["carol", 0, 2]]);
});

test("pairTotals: nur Überweisungen mit dir zählen, nicht zwischen anderen", () => {
  const rows = [
    { plan_id: "a", user_id: "bob", balance_cents: 700 },
    { plan_id: "a", user_id: "carol", balance_cents: -700 },
  ];
  assert.deepEqual(pairTotals(openPlans(rows, "alice").plans, "alice"), []);
  assert.deepEqual(pairTotals([], "alice"), []);
});

test("pairTotals: folgt den Überweisungen je Abend, nicht den rohen Salden", () => {
  // Alice bekommt 30 €, Bob gibt 20 €, Carol gibt 10 € – Carol zahlt an Alice, nicht an Bob.
  const rows = [
    { plan_id: "a", user_id: "alice", balance_cents: 3000 },
    { plan_id: "a", user_id: "bob", balance_cents: -2000 },
    { plan_id: "a", user_id: "carol", balance_cents: -1000 },
  ];
  assert.deepEqual(pairTotals(openPlans(rows, "carol").plans, "carol"), [{ other: "alice", net: -1000, plans: [{ planId: "a", cents: -1000 }] }]);
});
