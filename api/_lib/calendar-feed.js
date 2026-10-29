// P2 Etappe 2 · Kalender-Abo: baut aus den Terminen von calendar_feed_events einen iCalendar-Kalender
// (RFC 5545), den Kalender-Apps regelmäßig abrufen. Reine Funktionen ohne Netz – getestet in
// tests/unit/calendar-feed.test.mjs.
//
// Aufbau wie die Einzeldatei der App (src/lib/ics.ts, P2 Etappe 1) und mit derselben UID je Plan.
// Die Texte stehen ausnahmsweise hier statt in src/i18n: Sie entstehen auf dem Server, ohne die App.
// P11 Etappe 2a: Deutsch oder Englisch – nach der Sprache im Profil (user_settings.locale), sonst Deutsch.

/** Texte im Kalender je Sprache. Englisch wie die Einzeldatei der App (src/i18n/en/plans.ts, calendar). */
export const FEED_TEXTS = {
  de: {
    plan: "Plan",
    cancelled: (title) => `Abgesagt: ${title}`,
    maybe: (title) => `Vielleicht: ${title}`,
    crew: (name) => `Crew: ${name}`,
    meetingPoint: (value) => `Treffpunkt: ${value}`,
    noAnswer: "Deine Antwort fehlt noch.",
    link: (url) => `Plan in AFTERHOURS: ${url}`,
    description: "Deine Pläne aus AFTERHOURS",
  },
  en: {
    plan: "Plan",
    cancelled: (title) => `Cancelled: ${title}`,
    maybe: (title) => `Maybe: ${title}`,
    crew: (name) => `Crew: ${name}`,
    meetingPoint: (value) => `Meeting point: ${value}`,
    noAnswer: "You haven't answered yet.",
    link: (url) => `Plan in AFTERHOURS: ${url}`,
    description: "Your plans from AFTERHOURS",
  },
};

/** Nur bekannte Sprachen; alles andere (auch fehlend) → Deutsch. */
export function feedLocale(value) {
  return value === "en" ? "en" : "de";
}

export const FEED_TOKEN = /^[0-9a-f]{64}$/;

const CRLF = "\r\n";
const encoder = new TextEncoder();

/** 2026-10-17T17:00:00.000Z → 20261017T170000Z */
export function icsDate(value) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Text-Werte nach RFC 5545 §3.3.11: Backslash, Semikolon, Komma und Zeilenumbrüche maskieren. */
export function icsText(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Zeilen nach 75 Oktetts falten (UTF-8, ohne Zeichen zu zerteilen); Folgezeilen beginnen mit einem Leerzeichen. */
export function foldLine(line) {
  const parts = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validDate = (value) => typeof value === "string" && !Number.isNaN(new Date(value).getTime());

/** Status im Kalender: abgesagt, vorläufig (Vorschlag oder eigene Antwort „Vielleicht“) oder fest. */
export function eventStatus(event) {
  if (event.status === "cancelled") return "CANCELLED";
  if (event.status === "proposed" || event.attendance === "maybe") return "TENTATIVE";
  return "CONFIRMED";
}

/** Titel im Kalender: Absagen und offene Antworten sieht man auf einen Blick, auch in Apps, die STATUS ignorieren. */
export function eventSummary(event, locale = "de") {
  const text = FEED_TEXTS[feedLocale(locale)];
  const title = String(event.title ?? "").trim() || text.plan;
  if (event.status === "cancelled") return text.cancelled(title);
  if (event.attendance === "maybe") return text.maybe(title);
  return title;
}

/** Ein VEVENT als Zeilen (ungefaltet); unbrauchbare Einträge (keine ID, kein Beginn) → null. */
export function eventLines(event, { site, now, locale = "de" }) {
  if (!event || !UUID.test(String(event.id ?? "")) || !validDate(event.starts_at)) return null;
  const text = FEED_TEXTS[feedLocale(locale)];
  const url = `${site}/plans/${event.id}`;
  const description = [
    event.crew ? text.crew(event.crew) : null,
    event.meeting_point ? text.meetingPoint(event.meeting_point) : null,
    event.attendance === "invited" && event.status !== "cancelled" ? text.noAnswer : null,
    text.link(url),
  ].filter(Boolean).join("\n");
  const created = validDate(event.created_at) ? new Date(event.created_at).getTime() : 0;
  const updated = validDate(event.updated_at) ? new Date(event.updated_at).getTime() : created;
  const ends = validDate(event.ends_at) && new Date(event.ends_at) > new Date(event.starts_at) ? event.ends_at : null;
  return [
    "BEGIN:VEVENT",
    `UID:plan-${String(event.id).toLowerCase()}@afterhours`,
    `DTSTAMP:${icsDate(now)}`,
    `DTSTART:${icsDate(event.starts_at)}`,
    // Ohne bekanntes Ende kein erfundenes: Der Termin hat dann nur einen Beginn (RFC 5545 §3.6.1).
    ends ? `DTEND:${icsDate(ends)}` : null,
    `SUMMARY:${icsText(eventSummary(event, locale))}`,
    event.address ? `LOCATION:${icsText(event.address)}` : null,
    `DESCRIPTION:${icsText(description)}`,
    `URL:${url}`,
    `STATUS:${eventStatus(event)}`,
    `SEQUENCE:${Math.max(0, Math.floor((updated - created) / 1000))}`,
    validDate(event.updated_at) ? `LAST-MODIFIED:${icsDate(event.updated_at)}` : null,
    "END:VEVENT",
  ].filter((line) => line !== null);
}

/** Der ganze Kalender. Leere Liste → gültiger Kalender ohne Termine (Kalender-Apps leeren ihn dann). */
export function buildCalendar(events, { site, now = new Date(), locale = "de" }) {
  const base = String(site).replace(/\/+$/, "");
  const lang = feedLocale(locale);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//AFTERHOURS//Kalender-Abo//${lang.toUpperCase()}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:AFTERHOURS",
    `X-WR-CALDESC:${icsText(FEED_TEXTS[lang].description)}`,
    // Hinweis an Kalender-Apps, stündlich nachzusehen (viele entscheiden das selbst).
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const event of Array.isArray(events) ? events : []) {
    const vevent = eventLines(event, { site: base, now, locale: lang });
    if (vevent) lines.push(...vevent);
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join(CRLF).concat(CRLF);
}

/** Token aus /c/<token>.ics bzw. ?token=<token>(.ics); alles andere → null. */
export function parseFeedToken(raw) {
  const token = String(raw ?? "").replace(/\.ics$/i, "");
  return FEED_TOKEN.test(token) ? token : null;
}
