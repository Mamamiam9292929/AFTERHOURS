// S4 Etappe 2 · „Jetzt offen“ für eine Runde (src/lib/opennow.ts, Typen entfernt Node selbst).
import assert from "node:assert/strict";
import { test } from "node:test";
import { minutesUntil, noteCategories, pickOpenNow } from "../../src/lib/opennow.ts";

const place = (id, category) => ({ id, category });
const open = (closesAt) => ({ state: "open", closesAt });
const UNKNOWN = { state: "unknown" };
const CLOSED = { state: "closed", opensAt: "10:00", opensDay: null };
const at = (hh, mm = 0) => hh * 60 + mm;

test("Minuten bis zur Schließung – auch über Mitternacht", () => {
  assert.equal(minutesUntil("23:00", at(21)), 120);
  assert.equal(minutesUntil("02:00", at(22)), 240);
  assert.equal(minutesUntil("24:00", at(23, 30)), 30);
  assert.equal(minutesUntil("00:00", at(23)), 60);
});

test("Stichwort → Kategorien, Wortanfang zählt, Groß/klein egal", () => {
  assert.deepEqual(noteCategories("Bier im Park"), ["bar"]);
  assert.deepEqual(noteCategories("Kinoabend?"), ["cinema"]);
  assert.deepEqual(noteCategories("Pizza & Kino"), ["restaurant", "cinema"]);
  assert.deepEqual(noteCategories("Döner"), ["restaurant"]);
  assert.deepEqual(noteCategories("irgendwas"), []);
  assert.deepEqual(noteCategories(null), []);
  assert.deepEqual(noteCategories("  "), []);
});

test("nur offene Orte, die noch mindestens eine Stunde offen haben; geschlossene nie", () => {
  const result = pickOpenNow(
    [
      { activity: place("a", "bar"), state: open("21:30") }, // schließt in 30 min
      { activity: place("b", "bar"), state: CLOSED },
      { activity: place("c", "restaurant"), state: open("23:00") },
      { activity: place("d", "cinema"), state: open("01:00") },
      { activity: place("e", "bowling"), state: open("22:00") }, // genau 60 min
    ],
    at(21),
  );
  assert.deepEqual(result.open.map((p) => p.activity.id), ["c", "d", "e"]);
  assert.deepEqual(result.open.map((p) => p.minutesLeft), [120, 240, 60]);
  assert.deepEqual(result.unknown, []);
});

test("Stichwort zuerst, dann Abend-Reihenfolge; je Kategorie erst einer", () => {
  const candidates = [
    { activity: place("r1", "restaurant"), state: open("23:00") },
    { activity: place("r2", "restaurant"), state: open("23:00") },
    { activity: place("c1", "cinema"), state: open("23:30") },
    { activity: place("b1", "bar"), state: open("02:00") },
    { activity: place("b2", "bar"), state: open("02:00") },
  ];
  assert.deepEqual(pickOpenNow(candidates, at(20)).open.map((p) => p.activity.id), ["b1", "r1", "c1"]);
  assert.deepEqual(pickOpenNow(candidates, at(20), { note: "Kino?" }).open.map((p) => p.activity.id), ["c1", "b1", "r1"]);
  assert.deepEqual(pickOpenNow(candidates, at(20), { note: "Bier" }).open.map((p) => p.activity.id), ["b1", "r1", "c1"]);
  // Nur eine Kategorie offen: dann eben mehrere davon, in der Reihenfolge des Servers.
  assert.deepEqual(pickOpenNow(candidates.slice(0, 2), at(20)).open.map((p) => p.activity.id), ["r1", "r2"]);
});

test("Ausflüge und Sonstiges sind spontan am Abend kein Vorschlag", () => {
  const result = pickOpenNow(
    [
      { activity: place("t", "trip"), state: open("23:00") },
      { activity: place("o", "other"), state: UNKNOWN },
      { activity: place("x", "outdoor"), state: open("23:00") },
    ],
    at(20),
  );
  assert.deepEqual(result, { open: [], unknown: [] });
});

test("zu wenig offene: Orte mit unbekannten Öffnungszeiten füllen auf, getrennt ausgewiesen", () => {
  const result = pickOpenNow(
    [
      { activity: place("u1", "bar"), state: UNKNOWN },
      { activity: place("o1", "restaurant"), state: open("23:00") },
      { activity: place("u2", "bar"), state: UNKNOWN },
      { activity: place("u3", "cinema"), state: UNKNOWN },
      { activity: place("c", "bar"), state: CLOSED },
    ],
    at(20),
  );
  assert.deepEqual(result.open.map((p) => p.activity.id), ["o1"]);
  assert.deepEqual(result.unknown.map((a) => a.id), ["u1", "u3"]);
});

test("Grenze einstellbar; genug offene → keine unbekannten", () => {
  const candidates = [
    { activity: place("a", "bar"), state: open("02:00") },
    { activity: place("b", "cinema"), state: open("02:00") },
    { activity: place("u", "cafe"), state: UNKNOWN },
  ];
  assert.deepEqual(pickOpenNow(candidates, at(20), { limit: 2 }), {
    open: [
      { activity: candidates[0].activity, closesAt: "02:00", minutesLeft: 360 },
      { activity: candidates[1].activity, closesAt: "02:00", minutesLeft: 360 },
    ],
    unknown: [],
  });
  assert.deepEqual(pickOpenNow([], at(20)), { open: [], unknown: [] });
});
