// P27 · Kalenderdatei für Gäste ohne Konto (src/lib/icsformat.ts, Typen entfernt Node selbst).
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildIcs, foldLine, guestIcsChanges, guestIcsStamp, guestPlanIcs, icsFileName, icsText, parseGuestIcsStamp } from "../../src/lib/icsformat.ts";

const labels = {
  meetingPoint: (v) => `Treffpunkt: ${v}`,
  answer: "Deine Antwort: Bin dabei",
  link: (url) => `Zur Karte: ${url}`,
  noUpdates: "Dieser Termin ändert sich nicht von selbst.",
};
const plan = {
  title: "Strike District; Bowling, mit \\ Bahn",
  // 20:00 Uhr Berliner Winterzeit = 19:00 UTC
  starts_at: "2026-11-20T19:00:00+00:00",
  ends_at: "2026-11-20T22:30:00+00:00",
  status: "confirmed",
  place: "Strike District",
  address: "Demochaussee 220, 10115 Berlin",
  meeting_point: "U-Bahn Ausgang Nord",
};
const NOW = new Date("2026-11-05T21:00:00Z");
const TOKEN = "abcDEF123_-xyz";
const URL_ = `https://afterhours.example/s/${TOKEN}`;

/** Gefaltete Zeilen wieder zusammensetzen (RFC 5545 §3.1). */
const unfold = (ics) => ics.replace(/\r\n /g, "");
const field = (ics, name) => unfold(ics).split("\r\n").find((line) => line.startsWith(`${name}:`))?.slice(name.length + 1);

test("gültiges iCalendar mit CRLF, Zeiten in UTC (aus Berliner Zeit)", () => {
  const ics = guestPlanIcs(plan, { token: TOKEN, url: URL_, answer: "going", labels }, NOW);
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(ics.endsWith("END:VEVENT\r\nEND:VCALENDAR\r\n"));
  assert.ok(!/[^\r]\n/.test(ics), "nur CRLF");
  assert.equal(field(ics, "DTSTART"), "20261120T190000Z");
  assert.equal(field(ics, "DTEND"), "20261120T223000Z");
  assert.equal(field(ics, "DTSTAMP"), "20261105T210000Z");
  assert.equal(field(ics, "UID"), `guest-${TOKEN}@afterhours`);
  assert.equal(field(ics, "URL"), URL_);
  assert.equal(field(ics, "STATUS"), "CONFIRMED");
});

test("Sonderzeichen maskiert, Ort aus Name und Adresse, Treffpunkt und Antwort in der Beschreibung", () => {
  const ics = guestPlanIcs(plan, { token: TOKEN, url: URL_, answer: "going", labels }, NOW);
  assert.equal(field(ics, "SUMMARY"), "Strike District\\; Bowling\\, mit \\\\ Bahn");
  assert.equal(field(ics, "LOCATION"), "Strike District\\, Demochaussee 220\\, 10115 Berlin");
  assert.equal(field(ics, "DESCRIPTION"), `Treffpunkt: U-Bahn Ausgang Nord\\nDeine Antwort: Bin dabei\\nZur Karte: ${URL_}\\nDieser Termin ändert sich nicht von selbst.`);
  assert.equal(icsText("a\r\nb"), "a\\nb");
});

test("Zeilen höchstens 75 Oktetts, Umlaute nicht zerteilt", () => {
  const long = { ...plan, title: "Ü".repeat(80), meeting_point: "ä".repeat(120) };
  const ics = guestPlanIcs(long, { token: TOKEN, url: URL_, answer: "going", labels }, NOW);
  for (const line of ics.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  assert.equal(field(ics, "SUMMARY"), "Ü".repeat(80));
  assert.equal(foldLine("x".repeat(75)), "x".repeat(75));
});

test("„Vielleicht“ und vorgeschlagene Pläne vorläufig, abgesagte abgesagt", () => {
  assert.equal(field(guestPlanIcs(plan, { token: TOKEN, url: URL_, answer: "maybe", labels }, NOW), "STATUS"), "TENTATIVE");
  assert.equal(field(guestPlanIcs({ ...plan, status: "proposed" }, { token: TOKEN, url: URL_, answer: "going", labels }, NOW), "STATUS"), "TENTATIVE");
  assert.equal(field(guestPlanIcs({ ...plan, status: "cancelled" }, { token: TOKEN, url: URL_, answer: "going", labels }, NOW), "STATUS"), "CANCELLED");
});

test("ohne Ende, Ort und Treffpunkt: nichts erfunden", () => {
  const bare = { ...plan, ends_at: null, place: null, address: "  ", meeting_point: null };
  const ics = guestPlanIcs(bare, { token: TOKEN, url: URL_, answer: "going", labels }, NOW);
  assert.equal(field(ics, "DTEND"), undefined);
  assert.equal(field(ics, "LOCATION"), undefined);
  assert.ok(!field(ics, "DESCRIPTION").includes("Treffpunkt"));
});

test("SEQUENCE steigt mit jeder neuen Datei, UID bleibt – der neue Import ersetzt den alten", () => {
  const first = guestPlanIcs(plan, { token: TOKEN, url: URL_, answer: "going", labels }, NOW);
  const later = guestPlanIcs({ ...plan, starts_at: "2026-11-21T19:00:00Z" }, { token: TOKEN, url: URL_, answer: "going", labels }, new Date(NOW.getTime() + 60_000));
  assert.equal(field(first, "UID"), field(later, "UID"));
  assert.ok(Number(field(later, "SEQUENCE")) > Number(field(first, "SEQUENCE")));
});

test("UID ohne fremde Zeichen aus dem Token", () => {
  const ics = guestPlanIcs(plan, { token: "ab:c\r\nX", url: URL_, answer: "going", labels }, NOW);
  assert.equal(field(ics, "UID"), "guest-abcX@afterhours");
});

test("keine Namen der Crew: nur, was übergeben wird", () => {
  const ics = guestPlanIcs(plan, { token: TOKEN, url: URL_, answer: "going", labels }, NOW);
  assert.ok(!/ATTENDEE|ORGANIZER|Alice|Bob/.test(ics));
});

test("Änderungen seit der Datei: Zeit, Ort/Treffpunkt, Titel", () => {
  const saved = guestIcsStamp(plan);
  assert.deepEqual(guestIcsChanges(null, plan), []);
  assert.deepEqual(guestIcsChanges(saved, plan), []);
  // Gleiche Zeit anders geschrieben ist keine Änderung.
  assert.deepEqual(guestIcsChanges(saved, { ...plan, starts_at: "2026-11-20T20:00:00+01:00" }), []);
  assert.deepEqual(guestIcsChanges(saved, { ...plan, starts_at: "2026-11-20T19:30:00Z" }), ["time"]);
  assert.deepEqual(guestIcsChanges(saved, { ...plan, ends_at: null }), ["time"]);
  assert.deepEqual(guestIcsChanges(saved, { ...plan, meeting_point: "Haupteingang" }), ["where"]);
  assert.deepEqual(guestIcsChanges(saved, { ...plan, address: null, place: null, title: "Kino" }), ["where", "title"]);
  // Nur die Antwort ändert sich: kein Hinweis.
  assert.deepEqual(guestIcsChanges(saved, { ...plan, status: "proposed" }), []);
});

test("gespeicherter Stand vom Gerät wird geprüft", () => {
  const saved = guestIcsStamp(plan);
  assert.deepEqual(parseGuestIcsStamp(JSON.stringify(saved)), saved);
  assert.equal(parseGuestIcsStamp(null), null);
  assert.equal(parseGuestIcsStamp("{kaputt"), null);
  assert.equal(parseGuestIcsStamp(JSON.stringify({ ...saved, starts_at: "nie" })), null);
  assert.equal(parseGuestIcsStamp(JSON.stringify({ ...saved, where: 3 })), null);
  assert.equal(parseGuestIcsStamp(JSON.stringify([1])), null);
});

test("Plan der Crew (P2) nutzt dieselben Bausteine unverändert", () => {
  const ics = buildIcs(
    { uid: "plan-1@afterhours", title: "A", startsAt: plan.starts_at, endsAt: null, location: null, description: "d", url: "u", status: "CONFIRMED", sequence: -5, lastModified: "2026-11-01T10:00:00Z" },
    NOW,
  );
  assert.equal(field(ics, "SEQUENCE"), "0");
  assert.equal(field(ics, "LAST-MODIFIED"), "20261101T100000Z");
  assert.equal(icsFileName("Größte Übung"), "grosste-ubung.ics");
});
