// D5 · Mindestgröße von Bedienelementen nach WCAG 2.2, 2.5.8 (tests/e2e/audit-rules.mjs).
import assert from "node:assert/strict";
import { test } from "node:test";
import { undersizedTargets } from "../e2e/audit-rules.mjs";

const box = (x, y, width, height, inline = false) => ({ x, y, width, height, inline });

test("große Ziele bestehen, auch dicht nebeneinander", () => {
  assert.deepEqual(undersizedTargets([box(0, 0, 44, 44), box(46, 0, 44, 44)]), []);
  assert.deepEqual(undersizedTargets([box(0, 0, 24, 24), box(24, 0, 24, 24)]), []);
});

test("kleines Ziel mit genug Abstand besteht (Abstandsausnahme)", () => {
  assert.deepEqual(undersizedTargets([box(0, 0, 16, 16)]), []);
  // Mitte bei (8,8); nächstes großes Ziel beginnt bei x = 20 → 12 px Abstand = Radius, schneidet nicht.
  assert.deepEqual(undersizedTargets([box(0, 0, 16, 16), box(20, -10, 44, 44)]), []);
});

test("kleines Ziel dicht an einem großen fällt durch", () => {
  assert.deepEqual(undersizedTargets([box(0, 0, 16, 16), box(18, 0, 44, 44)]), [0]);
});

test("zwei kleine Ziele dicht nebeneinander fallen beide durch", () => {
  assert.deepEqual(undersizedTargets([box(0, 0, 16, 16), box(20, 0, 16, 16)]), [0, 1]);
  // 24 px Mittenabstand reicht.
  assert.deepEqual(undersizedTargets([box(0, 0, 16, 16), box(24, 0, 16, 16)]), []);
});

test("nur eine Seite zu klein zählt auch (flacher Knopf)", () => {
  assert.deepEqual(undersizedTargets([box(0, 0, 120, 18), box(0, 20, 120, 18)]), [0, 1]);
});

test("Links im Fließtext sind ausgenommen und zählen nicht als Nachbarn", () => {
  assert.deepEqual(undersizedTargets([box(0, 0, 40, 16, true), box(42, 0, 40, 16, true)]), []);
  assert.deepEqual(undersizedTargets([box(0, 0, 16, 16), box(18, 0, 40, 16, true)]), []);
});

test("verschachtelte Ziele (Knopf in verlinkter Karte) sind keine Nachbarn", () => {
  assert.deepEqual(undersizedTargets([box(0, 0, 300, 120), box(10, 10, 16, 16)]), []);
});
