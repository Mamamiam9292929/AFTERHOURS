// P2 Etappe 2 · Kalender-Abo (api/calendar.js): Aufbau des Kalenders, Maskierung, Status, Fehlerfälle.
// Läuft ohne Netz: node --test tests/unit/
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCalendar, eventStatus, eventSummary, foldLine, icsText, parseFeedToken } from "../../api/_lib/calendar-feed.js";
import { handleCalendar } from "../../api/calendar.js";

const TOKEN = "0123456789abcdef".repeat(4);
const NOW = new Date("2026-10-19T08:00:00Z");
const SITE = "https://afterhours.test";
const event = (extra = {}) => ({
  id: "11111111-2222-4333-8444-555555555555",
  title: "Bowling",
  starts_at: "2026-10-23T18:00:00Z",
  ends_at: "2026-10-23T20:00:00Z",
  address: "Bahnstraße 1, Leipzig",
  meeting_point: "Vor dem Eingang",
  status: "confirmed",
  attendance: "going",
  crew: "Weekend Crew",
  created_at: "2026-10-18T10:00:00Z",
  updated_at: "2026-10-18T10:05:00Z",
  ...extra,
});
const lines = (ics) => ics.split("\r\n");

test("Token: 64 Hex-Zeichen, mit oder ohne .ics", () => {
  assert.equal(parseFeedToken(TOKEN), TOKEN);
  assert.equal(parseFeedToken(`${TOKEN}.ics`), TOKEN);
  assert.equal(parseFeedToken(`${TOKEN}.ICS`), TOKEN);
  for (const bad of [null, "", TOKEN.toUpperCase(), TOKEN.slice(1), `${TOKEN}0`, "../../etc/passwd", `${TOKEN}.ics.ics`]) {
    assert.equal(parseFeedToken(bad), null, `abgelehnt: ${bad}`);
  }
});

test("Kalender: Kopf, ein Termin, CRLF, gleiche UID wie die Einzeldatei", () => {
  const ics = buildCalendar([event()], { site: `${SITE}/`, now: NOW });
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  const l = lines(ics);
  assert.ok(l.includes("X-WR-CALNAME:AFTERHOURS"));
  assert.ok(l.includes("METHOD:PUBLISH"));
  assert.ok(l.includes("UID:plan-11111111-2222-4333-8444-555555555555@afterhours"));
  assert.ok(l.includes("DTSTART:20261023T180000Z"));
  assert.ok(l.includes("DTEND:20261023T200000Z"));
  assert.ok(l.includes("DTSTAMP:20261019T080000Z"));
  assert.ok(l.includes("SUMMARY:Bowling"));
  assert.ok(l.includes("LOCATION:Bahnstraße 1\\, Leipzig"));
  assert.ok(l.includes("URL:https://afterhours.test/plans/11111111-2222-4333-8444-555555555555"), "Link ohne doppelten Schrägstrich");
  assert.ok(l.includes("STATUS:CONFIRMED"));
  assert.ok(l.includes("SEQUENCE:300"), "SEQUENCE steigt mit jeder Änderung (Sekunden seit dem Anlegen)");
  assert.ok(ics.replace(/\r\n /g, "").includes("Crew: Weekend Crew\\nTreffpunkt: Vor dem Eingang\\nPlan in AFTERHOURS:"));
  assert.equal(ics.match(/BEGIN:VEVENT/g)?.length, 1);
});

test("Zeilen höchstens 75 Byte, Umlaute werden nicht zerteilt", () => {
  const ics = buildCalendar([event({ title: "Ä".repeat(120), meeting_point: "Ü".repeat(200) })], { site: SITE, now: NOW });
  for (const line of lines(ics)) assert.ok(Buffer.byteLength(line) <= 75, `zu lang: ${line}`);
  const unfolded = ics.replace(/\r\n /g, "");
  assert.ok(unfolded.includes(`SUMMARY:${"Ä".repeat(120)}`), "nach dem Entfalten wieder der ganze Titel");
  assert.equal(foldLine("kurz"), "kurz");
});

test("Maskierung: Kommas, Semikolons, Backslashes und Zeilenumbrüche", () => {
  assert.equal(icsText("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
  const ics = buildCalendar([event({ title: "Pizza; dann Bar\nBEGIN:VEVENT" })], { site: SITE, now: NOW });
  assert.ok(ics.includes("SUMMARY:Pizza\\; dann Bar\\nBEGIN:VEVENT"));
  assert.equal(ics.match(/\r\nBEGIN:VEVENT\r\n/g)?.length, 1, "ein Titel kann keinen Termin einschleusen");
});

test("Status und Titel: abgesagt, Vorschlag, vielleicht, Antwort fehlt", () => {
  assert.equal(eventStatus(event({ status: "cancelled" })), "CANCELLED");
  assert.equal(eventSummary(event({ status: "cancelled" })), "Abgesagt: Bowling");
  assert.equal(eventStatus(event({ status: "proposed" })), "TENTATIVE");
  assert.equal(eventStatus(event({ attendance: "maybe" })), "TENTATIVE");
  assert.equal(eventSummary(event({ attendance: "maybe" })), "Vielleicht: Bowling");
  assert.equal(eventStatus(event({ status: "completed" })), "CONFIRMED");
  assert.ok(buildCalendar([event({ attendance: "invited" })], { site: SITE, now: NOW }).replace(/\r\n /g, "").includes("Deine Antwort fehlt noch."));
  assert.ok(!buildCalendar([event({ attendance: "invited", status: "cancelled" })], { site: SITE, now: NOW }).includes("Deine Antwort fehlt"));
});

test("Ohne Ende kein erfundenes; ohne Adresse kein LOCATION; Unbrauchbares fällt weg", () => {
  const ics = buildCalendar([event({ ends_at: null, address: null, meeting_point: null, crew: null })], { site: SITE, now: NOW });
  assert.ok(!ics.includes("DTEND"));
  assert.ok(!ics.includes("LOCATION"));
  assert.ok(!buildCalendar([event({ ends_at: "2026-10-23T17:00:00Z" })], { site: SITE, now: NOW }).includes("DTEND"), "Ende vor Beginn wird ignoriert");
  const broken = buildCalendar([event({ id: "x" }), event({ starts_at: "nie" }), null, event()], { site: SITE, now: NOW });
  assert.equal(broken.match(/BEGIN:VEVENT/g)?.length, 1);
  const empty = buildCalendar([], { site: SITE, now: NOW });
  assert.ok(empty.includes("BEGIN:VCALENDAR") && !empty.includes("VEVENT"), "leerer Kalender ist gültig");
});

test("Keine Namen, Teilnehmer oder E-Mail-Adressen", () => {
  const ics = buildCalendar([event()], { site: SITE, now: NOW });
  assert.ok(!/ATTENDEE|ORGANIZER|MAILTO|@(?!afterhours)/i.test(ics));
});

// ---- Vercel-Funktion ---------------------------------------------------------------------------
const env = { VITE_SUPABASE_URL: "https://db.test", VITE_SUPABASE_ANON_KEY: "eyJ.anon", VITE_SITE_URL: SITE };
function fakeFetch(status, body, calls = []) {
  return async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
}

test("Funktion: gültiger Link liefert text/calendar mit den Terminen", async () => {
  const calls = [];
  const response = await handleCalendar(new Request(`${SITE}/api/calendar?token=${TOKEN}.ics`), env, fakeFetch(200, { status: "valid", events: [event()] }, calls), NOW);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/calendar; charset=utf-8");
  assert.equal(response.headers.get("x-robots-tag"), "noindex");
  assert.match(response.headers.get("cache-control"), /private/);
  const ics = await response.text();
  assert.ok(ics.includes("SUMMARY:Bowling"));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://db.test/rest/v1/rpc/calendar_feed_events");
  assert.deepEqual(JSON.parse(calls[0].init.body), { p_token: TOKEN });
  assert.equal(calls[0].init.headers.Authorization, "Bearer eyJ.anon", "klassischer anon-Key auch als Bearer");
});

test("Funktion: Token aus dem Pfad /c/<token>.ics", async () => {
  const response = await handleCalendar(new Request(`${SITE}/c/${TOKEN}.ics`), env, fakeFetch(200, { status: "valid", events: [] }), NOW);
  assert.equal(response.status, 200);
});

test("Funktion: ungültiger Token fragt die Datenbank gar nicht", async () => {
  const calls = [];
  const response = await handleCalendar(new Request(`${SITE}/c/abc`), env, fakeFetch(200, {}, calls), NOW);
  assert.equal(response.status, 404);
  assert.equal(calls.length, 0);
});

test("Funktion: unbekannter oder beendeter Link → 404, kein leerer Kalender", async () => {
  const response = await handleCalendar(new Request(`${SITE}/c/${TOKEN}`), env, fakeFetch(200, { status: "not_found" }), NOW);
  assert.equal(response.status, 404);
  assert.match(await response.text(), /Einstellungen → Kalender-Abo/);
});

test("Funktion: Rate Limit → 429, Datenbankfehler und fehlende Konfiguration → 503", async () => {
  const limited = await handleCalendar(new Request(`${SITE}/c/${TOKEN}`), env, fakeFetch(400, { code: "P0001", message: "rate_limited" }), NOW);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "600");
  const broken = await handleCalendar(new Request(`${SITE}/c/${TOKEN}`), env, fakeFetch(500, { message: "boom" }), NOW);
  assert.equal(broken.status, 503);
  const offline = await handleCalendar(new Request(`${SITE}/c/${TOKEN}`), env, async () => { throw new Error("offline"); }, NOW);
  assert.equal(offline.status, 503);
  const unconfigured = await handleCalendar(new Request(`${SITE}/c/${TOKEN}`), {}, fakeFetch(200, { status: "valid", events: [] }), NOW);
  assert.equal(unconfigured.status, 503);
});

test("Funktion: ohne VITE_SITE_URL zeigen Links auf die eigene Adresse; publishable Key ohne Bearer", async () => {
  const calls = [];
  const response = await handleCalendar(new Request(`https://eigene.test/c/${TOKEN}`), { VITE_SUPABASE_URL: "https://db.test", VITE_SUPABASE_ANON_KEY: "sb_publishable_x" }, fakeFetch(200, { status: "valid", events: [event()] }, calls), NOW);
  assert.ok((await response.text()).includes("URL:https://eigene.test/plans/"));
  assert.equal(calls[0].init.headers.Authorization, undefined);
});
