// P37 · „Zwischenstand“ für den Gruppenchat (src/lib/standing.ts, Typen entfernt Node selbst).
import assert from "node:assert/strict";
import { test } from "node:test";
import { planStanding, standingText } from "../../src/lib/standing.ts";
import { quorumLeft } from "../../src/lib/quorum.ts";
import { spotsLeft } from "../../src/lib/capacity.ts";
import { ticketStanding } from "../../src/lib/tickets.ts";
import { planCards as de } from "../../src/i18n/de/planCards.ts";
import { planCards as en } from "../../src/i18n/en/planCards.ts";

const now = new Date("2026-11-10T12:00:00Z");
const p = (status, waitlisted_at = null) => ({ attendance_status: status, waitlisted_at });
const plan = (extra) => ({
  status: "confirmed",
  starts_at: "2026-11-14T19:00:00Z",
  participants: [p("going"), p("going"), p("going"), p("maybe"), p("invited"), p("invited"), p("invited"), p("declined")],
  guests: [p("going"), p("going"), p("maybe")],
  ...extra,
});

test("zählt Mitglieder und Gäste wie „Wer kommt mit?“, Absagen nicht", () => {
  assert.deepEqual(planStanding(plan(), now), { going: 5, maybe: 2, waiting: 0, open: 3, quorumLeft: null, spotsLeft: null, ticketsMissing: null });
});

test("Nachrückliste zählt nicht bei „vielleicht“ – Gäste nur mit Zusagen über den Link", () => {
  const waiting = plan({
    participants: [p("going"), p("maybe", "2026-11-10T10:00:00Z"), p("maybe")],
    guests: [p("maybe", "2026-11-10T10:01:00Z")],
  });
  assert.deepEqual(planStanding({ ...waiting, guests_allowed: true }, now), { going: 1, maybe: 1, waiting: 2, open: 0, quorumLeft: null, spotsLeft: null, ticketsMissing: null });
  assert.deepEqual(planStanding({ ...waiting, guests_allowed: false }, now), { going: 1, maybe: 2, waiting: 1, open: 0, quorumLeft: null, spotsLeft: null, ticketsMissing: null });
});

test("kein Knopf bei abgesagt, abgeschlossen, begonnen", () => {
  assert.equal(planStanding(plan({ status: "cancelled" }), now), null);
  assert.equal(planStanding(plan({ status: "completed" }), now), null);
  assert.equal(planStanding(plan({ starts_at: "2026-11-10T12:00:00Z" }), now), null, "beginnt genau jetzt");
  assert.equal(planStanding(plan({ starts_at: "2026-11-10T11:00:00Z" }), now), null);
  assert.notEqual(planStanding(plan({ status: "proposed" }), now), null, "auch vorgeschlagene Pläne");
});

test("Mindest- und Höchstzahl wie P25/P26", () => {
  for (const min of [null, undefined, 0, 1, 4, 5, 6, 9]) {
    for (const max of [null, 0, 5, 6, 8]) {
      const x = plan({ min_going: min, max_going: max });
      const s = planStanding(x, now);
      assert.equal(s.quorumLeft, quorumLeft(x, s.going, now), `min ${min}`);
      assert.equal(s.spotsLeft, spotsLeft(x, s.going, now), `max ${max}`);
    }
  }
});

const head = ["Kartbahn", "Samstag, 14. November, 20:00 Uhr"];

test("Text: Zahlen, Plural, Link-Hinweis", () => {
  assert.equal(
    standingText(de.standing, planStanding(plan(), now), ...head, true),
    "Kartbahn, Samstag, 14. November, 20:00 Uhr – 5 dabei, 2 vielleicht, 3 haben noch nicht geantwortet. Antwort mit einem Tipp:",
  );
  const one = planStanding(plan({ participants: [p("going"), p("invited")], guests: [] }), now);
  assert.equal(standingText(de.standing, one, ...head, false), "Kartbahn, Samstag, 14. November, 20:00 Uhr – 1 dabei, 1 hat noch nicht geantwortet. Zum Plan:");
  const none = planStanding(plan({ participants: [p("declined")], guests: [] }), now);
  assert.equal(standingText(de.standing, none, ...head, false), "Kartbahn, Samstag, 14. November, 20:00 Uhr – noch niemand dabei. Zum Plan:");
});

test("Text: noch 1 bis es stattfindet, freie Plätze, voll, Nachrückliste", () => {
  const s = (extra) => planStanding(plan(extra), now);
  assert.match(standingText(de.standing, s({ min_going: 6 }), ...head, true), /\. Noch 1 Zusage, dann findet es statt\. Antwort mit einem Tipp:$/);
  assert.match(standingText(de.standing, s({ min_going: 8 }), ...head, true), / Noch 3 Zusagen, dann findet es statt\. /);
  assert.match(standingText(de.standing, s({ min_going: 4 }), ...head, true), / Findet statt\. /);
  assert.match(standingText(de.standing, s({ max_going: 7 }), ...head, true), / Noch 2 Plätze frei\. /);
  assert.match(standingText(de.standing, s({ max_going: 6 }), ...head, true), / Noch 1 Platz frei\. /);
  const full = s({ max_going: 5, participants: [p("going"), p("going"), p("going"), p("maybe", "2026-11-10T10:00:00Z")] });
  assert.equal(
    standingText(de.standing, full, ...head, true),
    "Kartbahn, Samstag, 14. November, 20:00 Uhr – 5 dabei, 1 vielleicht, 1 auf der Nachrückliste. Alle Plätze vergeben – wer will, rückt nach. Antwort mit einem Tipp:",
  );
  assert.match(standingText(de.standing, s({ min_going: 6, max_going: 8 }), ...head, true), /Noch 1 Zusage, dann findet es statt\. Noch 3 Plätze frei\./);
});

test("Text auf Englisch mit eigenen Pluralformen", () => {
  assert.equal(
    standingText(en.standing, planStanding(plan({ min_going: 6 }), now), "Karting", "Saturday, 14 November, 20:00", true),
    "Karting, Saturday, 14 November, 20:00 – 5 in, 2 maybe, 3 haven’t answered yet. 1 more yes and it’s on. Answer with one tap:",
  );
  assert.equal(en.standing.open(1), "1 hasn’t answered yet");
  assert.equal(en.standing.spotsLeft(1), "1 spot left.");
});

test("keine Namen im Text – die Eingabe hat gar keine", () => {
  const withNames = plan({ participants: [{ attendance_status: "going", display_name: "Alice", user_id: "u1" }], guests: [{ attendance_status: "going", display_name: "Dana" }] });
  const text = standingText(de.standing, planStanding(withNames, now), ...head, true);
  assert.doesNotMatch(text, /Alice|Dana|u1/);
});

test("P53 Etappe 2b: Ticket-Stand im Zwischenstand – nur mit Check, nur Zusagen von Mitgliedern, nur Zahlen", () => {
  const head = ["Konzert", "Samstag, 14. November, 20:00 Uhr"];
  const t = (status, has_ticket) => ({ attendance_status: status, has_ticket });
  const participants = [t("going", true), t("going", false), t("going", false), t("maybe", false), t("declined", true), t("invited", false)];
  const on = planStanding({ status: "confirmed", starts_at: "2026-11-14T19:00:00Z", tickets_needed: true, participants, guests: [p("going")] }, now);
  assert.equal(on.ticketsMissing, 2, "zwei Zusagen ohne Ticket – „vielleicht“, Absage, ohne Antwort und Gäste zählen nicht");
  assert.equal(on.ticketsMissing, ticketStanding(participants).missing.length, "gleiche Regel wie der Ticket-Stand auf der Planseite");
  assert.match(standingText(de.standing, on, ...head, false), / 2 von euch haben noch kein Ticket\. Zum Plan:$/);
  assert.match(standingText(en.standing, on, "Gig", "Sat", false), / 2 of you still need a ticket\. /);
  const one = planStanding({ status: "confirmed", starts_at: "2026-11-14T19:00:00Z", tickets_needed: true, participants: [t("going", false)] }, now);
  assert.match(standingText(de.standing, one, ...head, false), / 1 von euch hat noch kein Ticket\. /);
  const done = planStanding({ status: "confirmed", starts_at: "2026-11-14T19:00:00Z", tickets_needed: true, participants: [t("going", true), t("maybe", false)] }, now);
  assert.equal(done.ticketsMissing, 0);
  assert.match(standingText(de.standing, done, ...head, false), / Alle, die dabei sind, haben ihr Ticket\. Zum Plan:$/);
  const off = planStanding({ status: "confirmed", starts_at: "2026-11-14T19:00:00Z", tickets_needed: false, participants }, now);
  assert.equal(off.ticketsMissing, null, "ohne Check kein Satz");
  assert.ok(!standingText(de.standing, off, ...head, false).includes("Ticket"));
  const nobody = planStanding({ status: "confirmed", starts_at: "2026-11-14T19:00:00Z", tickets_needed: true, participants: [t("maybe", false)] }, now);
  assert.equal(nobody.ticketsMissing, null, "solange niemand zugesagt hat, kein Satz");
  assert.ok(!standingText(de.standing, on, ...head, false).includes("Alice"), "keine Namen");
});
