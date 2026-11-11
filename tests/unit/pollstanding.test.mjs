// P38 · Zwischenstand der Abstimmung für den Gruppenchat (src/lib/pollstanding.ts, Typen entfernt Node selbst).
import assert from "node:assert/strict";
import { test } from "node:test";
import { POLL_STANDING_MAX_OPTIONS, pollStanding, pollStandingText } from "../../src/lib/pollstanding.ts";
import { pollStanding as de } from "../../src/i18n/de/pollStanding.ts";
import { pollStanding as en } from "../../src/i18n/en/pollStanding.ts";

const now = new Date("2026-11-11T12:00:00Z");
const poll = (extra) => ({
  status: "open",
  ends_at: "2026-11-13T17:00:00Z",
  options: [
    { label: "Kino", yes: 2 },
    { label: "Bowling", yes: 4 },
  ],
  voters: 6,
  open: 3,
  ...extra,
});
const until = "Fr., 13.11., 18:00";

test("die meisten Zusagen zuerst, bei Gleichstand in der Reihenfolge der Abstimmung", () => {
  assert.deepEqual(pollStanding(poll(), now).options, [
    { label: "Bowling", yes: 4 },
    { label: "Kino", yes: 2 },
  ]);
  const tie = pollStanding(poll({ options: [{ label: "A", yes: 1 }, { label: "B", yes: 3 }, { label: "C", yes: 1 }] }), now);
  assert.deepEqual(tie.options.map((o) => o.label), ["B", "A", "C"]);
});

test("kein Knopf nach dem Ende – geschlossen oder Frist abgelaufen", () => {
  assert.equal(pollStanding(poll({ status: "closed" }), now), null);
  assert.equal(pollStanding(poll({ ends_at: "2026-11-11T12:00:00Z" }), now), null, "endet genau jetzt");
  assert.equal(pollStanding(poll({ ends_at: "2026-11-10T12:00:00Z" }), now), null);
  assert.notEqual(pollStanding(poll(), now), null);
});

test("Text: Zahlen je Vorschlag, Plural, Frist, Link-Hinweis", () => {
  assert.equal(
    pollStandingText(de, pollStanding(poll(), now), "Bowling oder Kino?", until, false, true),
    "Bowling oder Kino? – Bowling: 4 dabei · Kino: 2 dabei. 3 haben noch nicht abgestimmt. Läuft bis Fr., 13.11., 18:00. Stimm mit einem Tipp ab:",
  );
  const one = pollStanding(poll({ options: [{ label: "Kino", yes: 1 }, { label: "Bowling", yes: 0 }], voters: 2, open: 1 }), now);
  assert.equal(
    pollStandingText(de, one, "Was geht?", until, false, false),
    "Was geht? – Kino: 1 dabei · Bowling: noch niemand dabei. 1 hat noch nicht abgestimmt. Läuft bis Fr., 13.11., 18:00. Zur Abstimmung:",
  );
  const all = pollStanding(poll({ open: 0 }), now);
  assert.match(pollStandingText(de, all, "Was geht?", until, false, false), /\. Aus der Crew haben alle abgestimmt\. Läuft bis /);
});

test("Text ohne Stimmen: keine Liste mit lauter Nullen", () => {
  const none = pollStanding(poll({ options: [{ label: "Kino", yes: 0 }, { label: "Bowling", yes: 0 }], voters: 0, open: 5 }), now);
  assert.equal(
    pollStandingText(de, none, "Bowling oder Kino?", until, false, true),
    "Bowling oder Kino? – noch keine Stimmen. 5 haben noch nicht abgestimmt. Läuft bis Fr., 13.11., 18:00. Stimm mit einem Tipp ab:",
  );
  // Stimmen, aber nur „vielleicht“/„nicht dabei“: die Vorschläge stehen trotzdem da.
  const noYes = pollStanding(poll({ options: [{ label: "Kino", yes: 0 }], voters: 1, open: 4 }), now);
  assert.match(pollStandingText(de, noYes, "Kino?", until, false, false), /^Kino\? – Kino: noch niemand dabei\. /);
});

test("mehr als vier Vorschläge: die ersten vier, dann „und 2 weitere“", () => {
  assert.equal(POLL_STANDING_MAX_OPTIONS, 4);
  const options = ["A", "B", "C", "D", "E", "F"].map((label, i) => ({ label, yes: 6 - i }));
  const s = pollStanding(poll({ options }), now);
  assert.equal(s.options.length, 4);
  assert.equal(s.more, 2);
  assert.match(pollStandingText(de, s, "Wohin?", until, false, false), /^Wohin\? – A: 6 dabei · B: 5 dabei · C: 4 dabei · D: 3 dabei · und 2 weitere Vorschläge\. /);
  const five = pollStanding(poll({ options: options.slice(0, 5) }), now);
  assert.match(pollStandingText(de, five, "Wohin?", until, false, false), / · und 1 weiterer Vorschlag\. /);
  const exactly = pollStanding(poll({ options: options.slice(0, 4) }), now);
  assert.equal(exactly.more, 0);
  assert.doesNotMatch(pollStandingText(de, exactly, "Wohin?", until, false, false), /weitere/);
});

test("Termin-Abstimmung: Datum als Titel der Vorschläge, „weitere Termine“", () => {
  const options = [
    { label: "Freitag, 13. November, 20:00 Uhr", yes: 3 },
    { label: "Samstag, 14. November", yes: 5 },
    { label: "Sonntag, 15. November", yes: 0 },
    { label: "Freitag, 20. November", yes: 1 },
    { label: "Samstag, 21. November", yes: 1 },
  ];
  const s = pollStanding(poll({ options }), now);
  assert.equal(
    pollStandingText(de, s, "Wann könnt ihr?", until, true, true),
    "Wann könnt ihr? – Samstag, 14. November: 5 dabei · Freitag, 13. November, 20:00 Uhr: 3 dabei · Freitag, 20. November: 1 dabei · Samstag, 21. November: 1 dabei · und 1 weiterer Termin. 3 haben noch nicht abgestimmt. Läuft bis Fr., 13.11., 18:00. Stimm mit einem Tipp ab:",
  );
  assert.equal(de.more(3, true), "und 3 weitere Termine");
});

test("Text auf Englisch mit eigenen Pluralformen", () => {
  assert.equal(
    pollStandingText(en, pollStanding(poll({ open: 1 }), now), "Bowling or Kino?", "Fri 13 Nov, 18:00", false, true),
    "Bowling or Kino? – Bowling: 4 in · Kino: 2 in. 1 hasn’t voted yet. Open until Fri 13 Nov, 18:00. Vote with one tap:",
  );
  assert.equal(en.more(1, false), "and 1 more option");
  assert.equal(en.more(2, true), "and 2 more dates");
  assert.equal(en.open(3), "3 haven’t voted yet.");
});

test("keine Namen im Text – die Eingabe hat gar keine", () => {
  const withNames = poll({ options: [{ label: "Kino", yes: 1, yes_names: ["Alice"], user_id: "u1" }] });
  const text = pollStandingText(de, pollStanding(withNames, now), "Kino?", until, false, true);
  assert.doesNotMatch(text, /Alice|u1/);
});
