// P20 · Geburtstage in der Crew (src/lib/birthdays.ts, Typen entfernt Node selbst).
import assert from "node:assert/strict";
import { test } from "node:test";
import { birthdaySlots, daysBetween, isValidBirthday, nextBirthday, upcomingBirthdays } from "../../src/lib/birthdays.ts";

test("gültige Geburtstage ohne Jahr", () => {
  assert.equal(isValidBirthday(2, 29), true);
  assert.equal(isValidBirthday(2, 30), false);
  assert.equal(isValidBirthday(4, 31), false);
  assert.equal(isValidBirthday(12, 31), true);
  assert.equal(isValidBirthday(0, 1), false);
  assert.equal(isValidBirthday(13, 1), false);
  assert.equal(isValidBirthday(5, 0), false);
  assert.equal(isValidBirthday(5, 1.5), false);
});

test("nächster Geburtstag: heute zählt, sonst dieses oder nächstes Jahr", () => {
  assert.equal(nextBirthday(11, 3, "2026-11-03"), "2026-11-03");
  assert.equal(nextBirthday(11, 14, "2026-11-03"), "2026-11-14");
  assert.equal(nextBirthday(11, 2, "2026-11-03"), "2027-11-02");
  assert.equal(nextBirthday(1, 5, "2026-12-30"), "2027-01-05");
});

test("29. Februar: in Jahren ohne Schalttag am 28.", () => {
  assert.equal(nextBirthday(2, 29, "2026-11-03"), "2027-02-28");
  assert.equal(nextBirthday(2, 29, "2027-03-01"), "2028-02-29");
  assert.equal(nextBirthday(2, 29, "2100-01-01"), "2100-02-28");
  assert.equal(nextBirthday(2, 29, "2000-01-01"), "2000-02-29");
});

test("Tage dazwischen über Monats- und Jahresgrenzen (ohne Zeitzonenfallen)", () => {
  assert.equal(daysBetween("2026-11-03", "2026-11-03"), 0);
  assert.equal(daysBetween("2026-10-24", "2026-10-26"), 2); // Zeitumstellung am 25.10.
  assert.equal(daysBetween("2026-12-30", "2027-01-05"), 6);
});

test("anstehende Geburtstage: nur im Fenster, der nächste zuerst", () => {
  const list = [
    { user_id: "c", month: 12, day: 3 }, // in 30 Tagen – noch drin
    { user_id: "a", month: 11, day: 14 },
    { user_id: "b", month: 11, day: 3 }, // heute
    { user_id: "d", month: 12, day: 4 }, // in 31 Tagen – draußen
    { user_id: "e", month: 11, day: 2 }, // gestern – erst nächstes Jahr
    { user_id: "x", month: 2, day: 30 }, // ungültig
  ];
  const result = upcomingBirthdays(list, "2026-11-03");
  assert.deepEqual(result.map((b) => [b.user_id, b.date, b.inDays]), [
    ["b", "2026-11-03", 0],
    ["a", "2026-11-14", 11],
    ["c", "2026-12-03", 30],
  ]);
  assert.deepEqual(upcomingBirthdays(list, "2026-11-03", 7).map((b) => b.user_id), ["b"]);
});

test("Jahreswechsel: Anfang Januar erscheint Ende Dezember", () => {
  const result = upcomingBirthdays([{ user_id: "a", month: 1, day: 2 }], "2026-12-28");
  assert.deepEqual(result.map((b) => [b.date, b.inDays]), [["2027-01-02", 5]]);
});

test("Termine zum Feiern rund um den Geburtstag", () => {
  const today = "2026-11-03"; // Dienstag
  // Samstag, 14.11.: Freitag davor, der Tag selbst, Freitag danach.
  assert.deepEqual(birthdaySlots("2026-11-14", today), ["2026-11-13", "2026-11-14", "2026-11-20"]);
  // Freitag, 13.11.: der Tag, Samstag, Freitag eine Woche später.
  assert.deepEqual(birthdaySlots("2026-11-13", today), ["2026-11-13", "2026-11-14", "2026-11-20"]);
  // Mittwoch, 18.11.: Wochenende davor und der Tag selbst.
  assert.deepEqual(birthdaySlots("2026-11-18", today), ["2026-11-13", "2026-11-14", "2026-11-18"]);
  // Sonntag, 15.11.: Freitag und Samstag direkt davor, der Tag selbst.
  assert.deepEqual(birthdaySlots("2026-11-15", today), ["2026-11-13", "2026-11-14", "2026-11-15"]);
  // Donnerstag, 19.11.: der Tag und das Wochenende direkt danach.
  assert.deepEqual(birthdaySlots("2026-11-19", today), ["2026-11-19", "2026-11-20", "2026-11-21"]);
});

test("Wochenende davor schon vorbei: das danach, nie Vergangenes", () => {
  // Heute Dienstag, Geburtstag Mittwoch, 4.11.: Fr/Sa davor (30./31.10.) sind vorbei.
  assert.deepEqual(birthdaySlots("2026-11-04", "2026-11-03"), ["2026-11-04", "2026-11-06", "2026-11-07"]);
  // Heute Samstag, Geburtstag Sonntag: Samstag (heute) zählt noch, Freitag nicht.
  assert.deepEqual(birthdaySlots("2026-11-08", "2026-11-07"), ["2026-11-07", "2026-11-08", "2026-11-13", "2026-11-14"]);
  // Geburtstag heute (Samstag): Freitag ist vorbei.
  assert.deepEqual(birthdaySlots("2026-11-07", "2026-11-07"), ["2026-11-07", "2026-11-13"]);
});
