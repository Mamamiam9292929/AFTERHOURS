// P46 · „Sagt bis Donnerstag Bescheid“ – Antwortfrist für Pläne (src/lib/answerby.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { answerByOptions, answerByState, daysBefore, matchingDays } from "../../src/lib/answerby.ts";
import { standingText, planStanding } from "../../src/lib/standing.ts";
import { planCards as de } from "../../src/i18n/de/planCards.ts";
import { planCards as en } from "../../src/i18n/en/planCards.ts";

const now = new Date("2026-11-10T12:00:00Z");
const plan = (extra) => ({ answer_by: "2026-11-12T19:00:00Z", status: "confirmed", starts_at: "2026-11-14T19:00:00Z", ...extra });

test("Frist offen, vorbei, keine Anzeige", () => {
  assert.deepEqual(answerByState(plan(), now), { at: "2026-11-12T19:00:00Z", passed: false });
  assert.deepEqual(answerByState(plan({ answer_by: "2026-11-10T11:59:00Z" }), now), { at: "2026-11-10T11:59:00Z", passed: true }, "vorbei, Plan noch nicht");
  assert.equal(answerByState(plan({ answer_by: null }), now), null);
  assert.equal(answerByState(plan({ answer_by: undefined }), now), null);
  assert.equal(answerByState(plan({ status: "cancelled" }), now), null, "abgesagt");
  assert.equal(answerByState(plan({ status: "completed" }), now), null, "abgeschlossen");
  assert.equal(answerByState(plan({ starts_at: "2026-11-10T11:00:00Z" }), now), null, "schon begonnen");
  assert.equal(answerByState(plan({ answer_by: "kaputt" }), now), null);
});

test("Auswahl: 1, 2, 3, 7 Tage vorher – nur, was noch mindestens eine halbe Stunde entfernt ist", () => {
  assert.deepEqual(
    answerByOptions("2026-11-20T19:00:00Z", now).map((o) => o.days),
    [1, 2, 3, 7],
  );
  assert.deepEqual(answerByOptions("2026-11-14T19:00:00Z", now).map((o) => o.days), [1, 2, 3], "eine Woche vorher wäre schon vorbei");
  assert.deepEqual(answerByOptions("2026-11-11T12:20:00Z", now).map((o) => o.days), [], "1 Tag vorher wäre in 20 Minuten");
  assert.deepEqual(answerByOptions("2026-11-11T12:40:00Z", now).map((o) => o.days), [1]);
  assert.deepEqual(answerByOptions("kaputt", now), []);
  assert.equal(answerByOptions("2026-11-14T19:00:00Z", now)[1].at, "2026-11-12T19:00:00.000Z");
});

test("gleiche Berliner Uhrzeit über die Zeitumstellung hinweg", () => {
  // Mittwoch, 28. Okt. 2026, 20:00 Uhr Winterzeit (19:00 UTC) → eine Woche vorher 20:00 Uhr Sommerzeit (18:00 UTC).
  const start = Date.parse("2026-10-28T19:00:00Z");
  assert.equal(new Date(daysBefore(start, 7)).toISOString(), "2026-10-21T18:00:00.000Z");
  assert.equal(new Date(daysBefore(start, 1)).toISOString(), "2026-10-27T19:00:00.000Z", "ohne Umstellung genau 24 h");
  // Frühjahr: Freitag, 2. April 2027, 20:00 Uhr Sommerzeit (18:00 UTC) → eine Woche vorher 20:00 Uhr Winterzeit (19:00 UTC).
  assert.equal(new Date(daysBefore(Date.parse("2027-04-02T18:00:00Z"), 7)).toISOString(), "2027-03-26T19:00:00.000Z");
});

test("gespeicherte Frist einer Auswahl zuordnen", () => {
  assert.equal(matchingDays("2026-11-12T19:00:00+00:00", "2026-11-14T19:00:00+00:00"), 2);
  assert.equal(matchingDays("2026-11-07T19:00:00Z", "2026-11-14T19:00:00Z"), 7);
  assert.equal(matchingDays("2026-11-12T18:00:00Z", "2026-11-14T19:00:00Z"), null, "andere Uhrzeit (z. B. nach dem Verschieben)");
  assert.equal(matchingDays(null, "2026-11-14T19:00:00Z"), null);
});

test("Zwischenstand nennt die Frist, solange sie läuft", () => {
  const s = planStanding({ status: "confirmed", starts_at: "2026-11-14T19:00:00Z", participants: [{ attendance_status: "going" }, { attendance_status: "invited" }] }, now);
  const withDeadline = standingText(de.standing, s, "Kartbahn", "Sa., 14. Nov., 20:00 Uhr", false, "Do., 12. Nov., 20:00 Uhr");
  assert.ok(withDeadline.includes("Bitte bis Do., 12. Nov., 20:00 Uhr Bescheid sagen."), withDeadline);
  assert.ok(withDeadline.indexOf("Bescheid sagen") < withDeadline.indexOf("Zum Plan:"), "Frist vor dem Link");
  assert.ok(!standingText(de.standing, s, "Kartbahn", "Sa.", false).includes("Bescheid"), "ohne Frist kein Satz");
  assert.ok(standingText(en.standing, s, "Karting", "Sat", false, "Thu 12 Nov, 20:00").includes("Please answer by Thu 12 Nov, 20:00."));
});

// P47 · Antwortfrist gleich beim Erstellen: die Formulare merken sich nur die Tage, die Frist rechnet das Abschicken.
test("P47: Frist aus Tagen und Beginn – nur, was gerade zur Wahl steht", async () => {
  const { answerByFor } = await import("../../src/lib/answerby.ts");
  const start = new Date("2026-11-20T19:00:00Z");
  assert.equal(answerByFor(start, 2, now), "2026-11-18T19:00:00.000Z");
  assert.equal(answerByFor(start, 7, now), "2026-11-13T19:00:00.000Z");
  assert.equal(answerByFor(start, null, now), null, "keine Frist gewählt");
  assert.equal(answerByFor(null, 2, now), null, "ohne Beginn keine Frist");
  assert.equal(answerByFor(new Date("kaputt"), 2, now), null);
  assert.equal(answerByFor(new Date("2026-11-14T19:00:00Z"), 7, now), null, "Beginn vorgezogen: „1 Woche vorher“ wäre vorbei – keine Frist statt einer falschen");
  assert.equal(answerByFor(start, 5, now), null, "nur 1, 2, 3, 7 Tage");
  // Zeitumstellung: Beginn nach dem 25. Oktober (Winterzeit), eine Woche vorher noch Sommerzeit – gleiche Berliner Uhrzeit.
  assert.equal(answerByFor(new Date("2026-10-27T19:00:00Z"), 7, new Date("2026-10-10T12:00:00Z")), "2026-10-20T18:00:00.000Z");
  assert.equal(de.answerBy.form.chosen("Mi., 18. Nov., 20:00 Uhr"), "Antwort bis Mi., 18. Nov., 20:00 Uhr");
  assert.equal(en.answerBy.form.title, "Answer by");
});
