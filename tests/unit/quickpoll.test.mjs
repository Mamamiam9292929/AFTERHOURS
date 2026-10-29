// S1 · Ein Satz, eine Abstimmung (src/lib/quickpoll.ts) – Sätze, wie sie im Gruppenchat stehen.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_OPTIONS, parseQuickPoll } from "../../src/lib/quickpoll.ts";

// Montag, 19. Oktober 2026, 20:00 Berliner Zeit (UTC+2).
const NOW = new Date("2026-10-19T18:00:00Z");
const p = (s) => parseQuickPoll(s, NOW);
const dates = (r) => r.days.map((d) => d.date);

test("Beispiel aus dem Entwurf: zwei Aktivitäten, zwei Tage, Uhrzeit → 4 Optionen", () => {
  const r = p("bowling oder kino, fr oder sa, 20 uhr");
  assert.deepEqual(r.activities, ["Bowling", "Kino"]);
  assert.deepEqual(dates(r), ["2026-10-23", "2026-10-24"]);
  assert.equal(r.time, "20:00");
  assert.equal(r.options.length, 4);
  assert.deepEqual(r.options[0], { title: "Bowling", proposed_date: "2026-10-23", proposed_time: "20:00" });
  assert.equal(r.title, "Was geht am Wochenende?");
  assert.equal(r.days[0].label, "Fr 23.10.");
});

const cases = [
  ["bowling freitag", ["Bowling"], ["2026-10-23"], null, "Was geht Freitag?"],
  ["Kino heute 21:30", ["Kino"], ["2026-10-19"], "21:30", "Was geht heute?"],
  ["morgen pizza essen um 8", ["Pizza essen"], ["2026-10-20"], "20:00", "Was geht morgen?"],
  ["wer hat bock auf billard am samstag?", ["Billard"], ["2026-10-24"], null, "Was geht Samstag?"],
  ["jemand lust auf karaoke oder bar diese woche", ["Karaoke", "Bar"], [], null, "Was machen wir?"],
  ["Grillen am See, Sa 16 Uhr", ["Grillen am See"], ["2026-10-24"], "16:00", "Was geht Samstag?"],
  ["escape room / lasertag / bowling", ["Escape room", "Lasertag", "Bowling"], [], null, "Was machen wir?"],
  ["Wochenende bowling", ["Bowling"], ["2026-10-23", "2026-10-24"], null, "Was geht am Wochenende?"],
  ["do oder fr bouldern ab 19 uhr", ["Bouldern"], ["2026-10-22", "2026-10-23"], "19:00", "Wann geht Bouldern?"],
  ["Kino 24.10. 20:15", ["Kino"], ["2026-10-24"], "20:15", "Was geht Samstag?"],
  ["mo, di oder mi", [], ["2026-10-19", "2026-10-20", "2026-10-21"], null, "Wann geht was?"],
  ["Spieleabend bei mir", ["Spieleabend bei mir"], [], null, "Spieleabend bei mir – wer ist dabei?"],
  ["übermorgen kart fahren 18.30", ["Kart fahren"], ["2026-10-21"], "18:30", "Was geht Mittwoch?"],
  ["sonntag brunch um 11 uhr", ["Brunch"], ["2026-10-25"], "11:00", "Was geht Sonntag?"],
  ["Freitag 8 Uhr abends Bar", ["Bar"], ["2026-10-23"], "20:00", "Was geht Freitag?"],
  ["bowling, bowling, Bowling", ["Bowling"], [], null, "Bowling – wer ist dabei?"],
  ["minigolf und eis essen samstags", ["Minigolf", "Eis essen"], ["2026-10-24"], null, "Was geht Samstag?"],
  ["1.1. silvesterparty", ["Silvesterparty"], ["2027-01-01"], null, "Was geht Freitag?"],
  ["kino um 20", ["Kino"], [], "20:00", "Kino – wer ist dabei?"],
  ["heute noch wer bock auf bier", ["Bier"], ["2026-10-19"], null, "Was geht heute?"],
  ["Thermen-Tag am Sonntag", ["Thermen-Tag"], ["2026-10-25"], null, "Was geht Sonntag?"],
  ["Fr. oder Sa. Club", ["Club"], ["2026-10-23", "2026-10-24"], null, "Was geht am Wochenende?"],
  ["Was geht?", ["Was geht"], [], null, "Was geht – wer ist dabei?"],
  // Feinschliff (20.10.): Uhrzeiten, wie man sie sagt, Tage mit Tageszeit, Kurzformen am Rand
  ["kino am fr um halb 8", ["Kino"], ["2026-10-23"], "19:30", "Was geht Freitag?"],
  ["Restaurant am Mo um viertel nach 7", ["Restaurant"], ["2026-10-19"], "19:15", "Was geht heute?"],
  ["dreiviertel 8 bar", ["Bar"], [], "19:45", "Bar – wer ist dabei?"],
  ["Am So. um halb 8 Tatort", ["Tatort"], ["2026-10-25"], "19:30", "Was geht Sonntag?"],
  ["Kneipe? heute so gegen 9", ["Kneipe"], ["2026-10-19"], "21:00", "Was geht heute?"],
  ["kino um 8 rum", ["Kino"], [], "20:00", "Kino – wer ist dabei?"],
  ["kino 20h", ["Kino"], [], "20:00", "Kino – wer ist dabei?"],
  ["Karaoke am Samstagabend", ["Karaoke"], ["2026-10-24"], null, "Was geht Samstag?"],
  ["Freitagabend Bar", ["Bar"], ["2026-10-23"], null, "Was geht Freitag?"],
  ["morgenabend kino", ["Kino"], ["2026-10-20"], null, "Was geht morgen?"],
  ["Sonntagmorgen brunch", ["Brunch"], ["2026-10-25"], null, "Was geht Sonntag?"],
  ["lass mal am WE was trinken gehen", ["Was trinken gehen"], ["2026-10-23", "2026-10-24"], null, "Was geht am Wochenende?"],
  ["nächsten freitag kino", ["Kino"], ["2026-10-23"], null, "Was geht Freitag?"],
  ["Grillen am See am So", ["Grillen am See"], ["2026-10-25"], null, "Was geht Sonntag?"],
  ["Brunch so 11 uhr", ["Brunch"], ["2026-10-25"], "11:00", "Was geht Sonntag?"],
  ["Pizza & Film fr", ["Pizza & Film"], ["2026-10-23"], null, "Was geht Freitag?"],
  ["Rum Tasting fr", ["Rum Tasting"], ["2026-10-23"], null, "Was geht Freitag?"],
  // Bleibt wie bisher: „so“ mitten im Satz ist kein Sonntag
  ["Bar so wie immer", ["Bar so wie immer"], [], null, "Bar so wie immer – wer ist dabei?"],
];

for (const [input, acts, ds, time, title] of cases) {
  test(`„${input}“`, () => {
    const r = p(input);
    assert.deepEqual(r.activities, acts, "Aktivitäten");
    assert.deepEqual(dates(r), ds, "Tage");
    assert.equal(r.time, time, "Uhrzeit");
    assert.equal(r.title, title, "Titel");
    assert.ok(r.options.length >= 1, "mindestens eine Option");
  });
}

test("höchstens 10 Optionen", () => {
  const r = p("a1, b2, c3, d4, e5, f6 mo di mi do fr");
  assert.equal(r.options.length, MAX_OPTIONS);
});

test("leerer Satz: keine Option", () => {
  assert.equal(p("   ").options.length, 0);
});

test("Ende der Abstimmung: vor dem ersten Termin, mindestens 1 Stunde, ohne Termin nach 48 Stunden", () => {
  assert.equal(p("bowling freitag 20 uhr").endsAt, "2026-10-23T10:00:00.000Z", "Freitag 12:00 Berlin");
  assert.equal(p("kino").endsAt, "2026-10-21T18:00:00.000Z");
  const tonight = new Date(p("kino heute 21:30").endsAt).getTime();
  assert.equal(tonight, NOW.getTime() + 60 * 60_000, "heute 21:30 → spätestens 21:00, aber mindestens 1 Stunde");
});

test("Winterzeit: Termin nach der Zeitumstellung", () => {
  const r = p("bowling 30.10. 20 uhr");
  assert.equal(r.endsAt, "2026-10-30T11:00:00.000Z", "Freitag 30.10. 12:00 Berlin = 11:00 UTC");
});

// P11 · Englische Oberfläche: derselbe Parser versteht englische Sätze (Mittwoch, 21. Oktober 2026, 12:00 Berliner Zeit).
const WED = new Date("2026-10-21T10:00:00Z");
const en = (s) => parseQuickPoll(s, WED, "en");

test("Englisch: Beispiel der Oberfläche – zwei Aktivitäten, zwei Tage, 8 pm → 4 Optionen", () => {
  const r = en("bowling or cinema, fri or sat, 8 pm");
  assert.deepEqual(r.activities, ["Bowling", "Cinema"]);
  assert.deepEqual(dates(r), ["2026-10-23", "2026-10-24"]);
  assert.deepEqual(r.days.map((d) => d.label), ["Fri 23 Oct", "Sat 24 Oct"]);
  assert.equal(r.time, "20:00");
  assert.equal(r.options.length, 4);
  assert.equal(r.title, "What's on at the weekend?");
});

test("Englisch: Uhrzeiten wie im Chat", () => {
  const cases = [
    ["pizza tonight at 8", "20:00"],
    ["drinks friday night 9:30pm", "21:30"],
    ["Brunch on Sunday at 11am", "11:00"],
    ["cinema tomorrow half 8", "20:30"],
    ["bowling 20:00", "20:00"],
    ["climbing gym thursday around 7ish", "19:00"],
    ["lunch sat 12pm", "12:00"],
  ];
  for (const [s, time] of cases) assert.equal(en(s).time, time, s);
});

test("Englisch: Tage, Füllwörter und Trenner", () => {
  assert.deepEqual(dates(en("who's up for pizza tonight")), ["2026-10-21"]);
  assert.deepEqual(en("who's up for pizza tonight").activities, ["Pizza"]);
  assert.deepEqual(dates(en("karaoke or pub quiz this weekend")), ["2026-10-23", "2026-10-24"]);
  assert.deepEqual(en("karaoke or pub quiz this weekend").activities, ["Karaoke", "Pub quiz"]);
  assert.deepEqual(en("go to the lake sat or sun").activities, ["Lake"]);
  assert.deepEqual(en("bowling & burgers").activities, ["Bowling", "Burgers"]);
  assert.equal(en("drinks tomorrow").title, "What's on tomorrow?");
  assert.equal(en("darts").title, "Darts – who's in?");
  // Tag ohne Aktivität: Option heißt wie der Tag – auf Englisch.
  assert.deepEqual(en("fri or sat").options.map((o) => o.title), ["Friday", "Saturday"]);
});

test("Deutsch bleibt Standard – englische Wörter sind dort Aktivitäten", () => {
  assert.equal(parseQuickPoll("bowling fr 20 uhr", WED).time, "20:00");
  assert.deepEqual(parseQuickPoll("bowling or cinema", WED).activities, ["Bowling or cinema"]);
});
