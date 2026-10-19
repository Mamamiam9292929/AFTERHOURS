// P8 · Wiederkehrende Pläne (src/lib/repeat.ts) – gleiche Fälle wie pgTAP 22_plan_series.
import assert from "node:assert/strict";
import { test } from "node:test";
import { berlinDate, dueSeries, isoWeekday, latestInSeries, nextOccurrence, repeatAnchor, repeatOptions } from "../../src/lib/repeat.ts";

test("nächster Termin wie auf dem Server", () => {
  assert.equal(nextOccurrence("weekly", 5, null, "2026-10-23"), "2026-10-30");
  assert.equal(nextOccurrence("biweekly", 5, null, "2026-10-23"), "2026-11-06");
  assert.equal(nextOccurrence("monthly_nth", 5, 1, "2026-11-06"), "2026-12-04");
  assert.equal(nextOccurrence("monthly_nth", 5, 1, "2026-10-23"), "2026-11-06");
  assert.equal(nextOccurrence("monthly_nth", 3, 3, "2026-12-16"), "2027-01-20");
  assert.equal(nextOccurrence("monthly_nth", 5, 2, "2027-01-08"), "2027-02-12");
  assert.equal(nextOccurrence("monthly_last", 5, null, "2026-10-30"), "2026-11-27");
  assert.equal(nextOccurrence("monthly_last", 5, null, "2027-01-29"), "2027-02-26");
  assert.equal(nextOccurrence("monthly_last", 7, null, "2027-01-31"), "2027-02-28");
  // Über den Jahreswechsel und durch einen Schaltmonat.
  assert.equal(nextOccurrence("weekly", 4, null, "2026-12-31"), "2027-01-07");
  assert.equal(nextOccurrence("monthly_last", 2, null, "2028-01-25"), "2028-02-29");
});

test("monatlich: jeder Termin liegt auf dem richtigen Wochentag, ein Jahr lang", () => {
  let day = "2026-11-06";
  for (let i = 0; i < 12; i++) {
    day = nextOccurrence("monthly_nth", 5, 1, day);
    assert.equal(isoWeekday(day), 5, day);
    assert.ok(Number(day.slice(8)) <= 7, day);
  }
  day = "2026-10-30";
  for (let i = 0; i < 12; i++) {
    day = nextOccurrence("monthly_last", 5, null, day);
    assert.equal(isoWeekday(day), 5, day);
    assert.ok(Number(day.slice(8)) > 21, day);
  }
});

test("Kalendertag und Anker in Berliner Zeit", () => {
  // 23:30 UTC am 23.10. ist in Berlin schon der 24. (Samstag).
  assert.equal(berlinDate("2026-10-23T23:30:00Z"), "2026-10-24");
  assert.deepEqual(repeatAnchor("2026-11-06T19:00:00Z"), { date: "2026-11-06", weekday: 5, nth: 1, lastWeek: false });
  assert.deepEqual(repeatAnchor("2027-01-29T18:00:00Z"), { date: "2027-01-29", weekday: 5, nth: 5, lastWeek: true });
  assert.deepEqual(repeatAnchor("2026-10-23T18:00:00Z"), { date: "2026-10-23", weekday: 5, nth: 4, lastWeek: false });
  assert.deepEqual(repeatAnchor("2026-10-25T18:00:00Z"), { date: "2026-10-25", weekday: 7, nth: 4, lastWeek: true });
});

test("angebotene Regeln passen zum Tag", () => {
  assert.deepEqual(repeatOptions(repeatAnchor("2026-11-06T19:00:00Z")), ["weekly", "biweekly", "monthly_nth"]);
  assert.deepEqual(repeatOptions(repeatAnchor("2026-10-25T18:00:00Z")), ["weekly", "biweekly", "monthly_nth", "monthly_last"]);
  assert.deepEqual(repeatOptions(repeatAnchor("2027-01-29T18:00:00Z")), ["weekly", "biweekly", "monthly_last"]);
});

test("letzter Termin einer Serie und fällige Serien", () => {
  // s1: jeden Freitag, letzter Termin Fr 23.10. 20:00 Berlin. s2: alle zwei Wochen, letzter Sa 10.10.
  const weekly = { active: true, rule: "weekly", weekday: 5, nth: null, last_on: "2026-10-23" };
  const biweekly = { active: true, rule: "biweekly", weekday: 6, nth: null, last_on: "2026-10-10" };
  const plans = [
    { id: "a", starts_at: "2026-10-16T18:00:00+00:00", series_id: "s1", series: weekly },
    { id: "b", starts_at: "2026-10-23T18:00:00+00:00", series_id: "s1", series: weekly },
    { id: "c", starts_at: "2026-10-10T18:00:00+00:00", series_id: "s2", series: biweekly },
    { id: "d", starts_at: "2026-10-01T18:00:00+00:00", series_id: "s3", series: { ...weekly, active: false, last_on: "2026-10-01" } },
    { id: "e", starts_at: "2026-10-01T18:00:00+00:00", series_id: null, series: null },
  ];
  assert.equal(latestInSeries(plans, "s1")?.id, "b");
  assert.equal(latestInSeries(plans, "x"), null);
  // s2: nächster Termin Sa 24.10. 20:00 – am 19.10. sind das gut 5 Tage: fällig. s1: nächster am 30.10.
  const now = new Date("2026-10-19T10:00:00Z");
  assert.deepEqual(dueSeries(plans, now), ["s2"]);
  // Fr 23.10. 20:00 hat begonnen → der 30.10. ist genau 7 Tage entfernt. Eine Stunde Puffer wegen der Zeitumstellung.
  assert.deepEqual(dueSeries(plans, new Date("2026-10-23T18:30:00Z")), ["s2"]);
  assert.deepEqual(dueSeries(plans, new Date("2026-10-23T19:00:00Z")).sort(), ["s1", "s2"]);
});

test("früher Bescheid: monatlich eine Woche vorher, nicht früher", () => {
  // Jeden 1. Freitag, letzter Termin Fr 2.10. 19:00 Berlin (17:00 UTC) → nächster Fr 6.11. 19:00 (18:00 UTC, Winterzeit).
  const series = { active: true, rule: "monthly_nth", weekday: 5, nth: 1, last_on: "2026-10-02" };
  const plans = [{ starts_at: "2026-10-02T17:00:00Z", series_id: "m", series }];
  assert.deepEqual(dueSeries(plans, new Date("2026-10-25T12:00:00Z")), [], "12 Tage vorher: nichts");
  assert.deepEqual(dueSeries(plans, new Date("2026-10-30T16:00:00Z")), [], "knapp über 7 Tage: noch nichts");
  assert.deepEqual(dueSeries(plans, new Date("2026-10-30T19:00:00Z")), ["m"], "7 Tage vorher: fällig");
});

test("ausgesetzter letzter Termin: der nächste kommt sofort", () => {
  const series = { active: true, rule: "monthly_nth", weekday: 5, nth: 1, last_on: "2026-11-06" };
  const plans = [
    { starts_at: "2026-10-02T17:00:00Z", status: "completed", series_id: "m", series },
    { starts_at: "2026-11-06T18:00:00Z", status: "cancelled", series_id: "m", series },
  ];
  assert.deepEqual(dueSeries(plans, new Date("2026-10-20T12:00:00Z")), ["m"]);
  assert.deepEqual(dueSeries([{ ...plans[1], series: { ...series, active: false } }], new Date("2026-10-20T12:00:00Z")), [], "beendete Serie nie");
});
