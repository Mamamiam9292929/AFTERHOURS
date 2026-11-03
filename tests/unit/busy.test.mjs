// P18 · „Da hast du schon was vor“ beim Abstimmen (src/lib/busy.ts, Typen entfernt Node selbst).
import assert from "node:assert/strict";
import { test } from "node:test";
import { berlinToUtc, busyFor, relevantPlans } from "../../src/lib/busy.ts";

const ME = "me";
let n = 0;
const plan = (starts_at, { ends_at = null, status = "confirmed", mine = "going", poll_id = null, title = "Plan" } = {}) => ({
  id: `p${String(++n).padStart(3, "0")}`,
  title,
  crew_id: "c1",
  poll_id,
  starts_at,
  ends_at,
  status,
  participants: [
    { user_id: ME, attendance_status: mine },
    { user_id: "other", attendance_status: "going" },
  ],
});
const option = (proposed_date, proposed_time = null) => ({ proposed_date, proposed_time });

test("Berliner Ortszeit → UTC, auch über die Zeitumstellung", () => {
  assert.equal(new Date(berlinToUtc("2026-10-24", "20:00")).toISOString(), "2026-10-24T18:00:00.000Z");
  assert.equal(new Date(berlinToUtc("2026-11-21", "20:00")).toISOString(), "2026-11-21T19:00:00.000Z");
  assert.equal(new Date(berlinToUtc("2026-10-25", "12:00:00")).toISOString(), "2026-10-25T11:00:00.000Z");
  assert.equal(berlinToUtc("21.11.2026", "20:00"), null);
  assert.equal(berlinToUtc("2026-11-21", ""), null);
});

test("nur aktive Pläne mit eigener Zusage oder „vielleicht“, nicht aus dieser Abstimmung", () => {
  const going = plan("2026-11-21T19:00:00Z");
  const maybe = plan("2026-11-21T19:00:00Z", { mine: "maybe" });
  const invited = plan("2026-11-21T19:00:00Z", { mine: "invited" });
  const declined = plan("2026-11-21T19:00:00Z", { mine: "declined" });
  const cancelled = plan("2026-11-21T19:00:00Z", { status: "cancelled" });
  const completed = plan("2026-11-21T19:00:00Z", { status: "completed" });
  const fromPoll = plan("2026-11-21T19:00:00Z", { poll_id: "poll-1" });
  const booked = plan("2026-11-21T19:00:00Z", { status: "booked" });
  const all = [going, maybe, invited, declined, cancelled, completed, fromPoll, booked];
  assert.deepEqual(relevantPlans(all, ME, new Set(["poll-1"])).map((p) => p.id), [going.id, maybe.id, booked.id]);
  assert.deepEqual(relevantPlans(all, "stranger"), [], "wer nicht teilnimmt, hat nichts vor");
});

test("Vorschlag mit Uhrzeit: Überschneidung geht vor „am selben Tag“", () => {
  // Samstag, 21.11.2026: Brunch 11:00, Kino 19:30 (Winterzeit, UTC+1).
  const brunch = plan("2026-11-21T10:00:00Z", { title: "Brunch" });
  const kino = plan("2026-11-21T18:30:00Z", { title: "Kino" });
  const plans = [kino, brunch];
  const hit = busyFor(option("2026-11-21", "20:00:00"), plans);
  assert.equal(hit.kind, "overlap");
  assert.equal(hit.plan.title, "Kino");
  assert.equal(hit.time, "19:30");
  assert.equal(hit.more, 1);
  const morning = busyFor(option("2026-11-21", "09:00"), plans);
  assert.equal(morning.kind, "overlap", "09:00–12:00 trifft den Brunch ab 11:00");
  assert.equal(morning.plan.title, "Brunch");
  const afternoon = busyFor(option("2026-11-21", "14:30"), plans);
  assert.equal(afternoon.kind, "day", "14:30–17:30: kein Plan dazwischen, aber zwei am selben Tag");
  assert.equal(afternoon.plan.title, "Brunch", "dann der früheste");
  assert.equal(afternoon.more, 1);
});

test("Grenzen: drei Stunden ab Vorschlag, Plan ohne Ende drei Stunden ab Beginn", () => {
  const kino = plan("2026-11-21T18:30:00Z"); // 19:30–22:30
  assert.equal(busyFor(option("2026-11-21", "16:30"), [kino]).kind, "day", "16:30–19:30 endet genau, wenn der Plan beginnt");
  assert.equal(busyFor(option("2026-11-21", "16:31"), [kino]).kind, "overlap");
  assert.equal(busyFor(option("2026-11-21", "22:30"), [kino]).kind, "day", "22:30 beginnt genau, wenn der Plan endet");
  const long = plan("2026-11-21T18:30:00Z", { ends_at: "2026-11-21T23:30:00Z" }); // bis 00:30
  assert.equal(busyFor(option("2026-11-21", "23:00"), [long]).kind, "overlap", "mit Ende zählt das echte Ende");
});

test("Vorschlag ohne Uhrzeit: jeder Plan am Tag, Berliner Kalendertag", () => {
  const late = plan("2026-11-21T22:30:00Z", { title: "Spät" }); // Samstag 21.11., 23:30 Berliner Zeit
  assert.equal(busyFor(option("2026-11-21"), [late]).kind, "day");
  assert.equal(busyFor(option("2026-11-21"), [late]).time, "23:30");
  assert.equal(busyFor(option("2026-11-22"), [late]), null, "ohne Ende belegt ein Plan nur den Tag seines Beginns");
  const utcLate = plan("2026-11-21T23:30:00Z"); // in Berlin schon Sonntag 00:30
  assert.equal(busyFor(option("2026-11-21"), [utcLate]), null);
  assert.equal(busyFor(option("2026-11-22"), [utcLate]).time, "00:30");
});

test("mehrtägige Pläne gelten an jedem berührten Tag, aber nicht am Folgetag nach Mitternacht-Ende", () => {
  const trip = plan("2026-11-20T15:00:00Z", { ends_at: "2026-11-22T23:00:00Z", title: "Hütte" }); // Fr 16:00 bis Mo 00:00
  for (const day of ["2026-11-20", "2026-11-21", "2026-11-22"]) assert.equal(busyFor(option(day, "20:00"), [trip])?.kind, "overlap", day);
  assert.equal(busyFor(option("2026-11-23", "20:00"), [trip]), null, "Ende genau um Mitternacht belegt den Montag nicht");
  assert.equal(busyFor(option("2026-11-19", "20:00"), [trip]), null);
});

test("ohne Datum oder ohne Pläne: nichts", () => {
  assert.equal(busyFor(option(null, "20:00"), [plan("2026-11-21T18:30:00Z")]), null);
  assert.equal(busyFor(option("2026-11-21", "20:00"), []), null);
  assert.equal(busyFor(option("kaputt"), [plan("2026-11-21T18:30:00Z")]), null);
});
