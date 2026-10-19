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
  const plans = [
    { id: "a", starts_at: "2026-10-16T18:00:00+00:00", series_id: "s1", series: { active: true } },
    { id: "b", starts_at: "2026-10-23T18:00:00+00:00", series_id: "s1", series: { active: true } },
    { id: "c", starts_at: "2026-10-10T18:00:00+00:00", series_id: "s2", series: { active: true } },
    { id: "d", starts_at: "2026-10-01T18:00:00+00:00", series_id: "s3", series: { active: false } },
    { id: "e", starts_at: "2026-10-01T18:00:00+00:00", series_id: null, series: null },
  ];
  assert.equal(latestInSeries(plans, "s1")?.id, "b");
  assert.equal(latestInSeries(plans, "x"), null);
  const now = new Date("2026-10-19T10:00:00Z");
  assert.deepEqual(dueSeries(plans, now), ["s2"]);
  assert.deepEqual(dueSeries(plans, new Date("2026-10-24T00:00:00Z")).sort(), ["s1", "s2"]);
});
