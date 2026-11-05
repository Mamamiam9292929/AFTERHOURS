/*
 * iCalendar (RFC 5545) ohne Abhängigkeiten – gemeinsam für den Plan der Crew (P2, `src/lib/ics.ts`) und die
 * Kalenderdatei für Gäste ohne Konto (P27). Bewusst ohne Importe, damit der Unit-Test die Datei direkt lädt.
 */

const CRLF = "\r\n";

/** 2026-10-17T17:00:00.000Z → 20261017T170000Z */
export function icsDate(value: string | Date): string {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Text-Werte nach RFC 5545 §3.3.11: Backslash, Semikolon, Komma und Zeilenumbrüche maskieren. */
export function icsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Zeilen nach 75 Oktetts falten (UTF-8, ohne Zeichen zu zerteilen); Folgezeilen beginnen mit einem Leerzeichen. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
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

/** Dateiname aus dem Titel: „Strike District Bowling“ → strike-district-bowling.ics */
export function icsFileName(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "afterhours-plan"}.ics`;
}

export type IcsEvent = {
  uid: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  description: string;
  url: string;
  status: "TENTATIVE" | "CONFIRMED" | "CANCELLED";
  sequence: number;
  lastModified: string | null;
};

/** Ein Termin als vollständige Kalenderdatei mit CRLF und gefalteten Zeilen. */
export function buildIcs(event: IcsEvent, now: Date = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AFTERHOURS//Plan//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${icsDate(now)}`,
    `DTSTART:${icsDate(event.startsAt)}`,
    // Ohne bekanntes Ende kein erfundenes: Der Termin hat dann nur einen Beginn (RFC 5545 §3.6.1).
    event.endsAt ? `DTEND:${icsDate(event.endsAt)}` : null,
    `SUMMARY:${icsText(event.title)}`,
    event.location ? `LOCATION:${icsText(event.location)}` : null,
    `DESCRIPTION:${icsText(event.description)}`,
    `URL:${event.url}`,
    `STATUS:${event.status}`,
    `SEQUENCE:${Math.max(0, Math.floor(event.sequence))}`,
    event.lastModified ? `LAST-MODIFIED:${icsDate(event.lastModified)}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines
    .filter((line): line is string => line !== null)
    .map(foldLine)
    .join(CRLF)
    .concat(CRLF);
}

// ---------------------------------------------------------------------------------------------
// P27 · Kalenderdatei für Gäste ohne Konto (Zusagekarte unter /s/<token>)
// ---------------------------------------------------------------------------------------------

/** Was die Zusagekarte vom Plan kennt (`shared_plan_rsvp`) – mehr kommt nicht in die Datei. */
export type GuestIcsPlan = {
  title: string;
  starts_at: string;
  ends_at: string | null;
  status: string;
  place: string | null;
  address: string | null;
  meeting_point: string | null;
};

export type GuestIcsLabels = {
  meetingPoint: (value: string) => string;
  answer: string;
  link: (url: string) => string;
  noUpdates: string;
};

/** Beginn der Zählung für SEQUENCE: Jede neue Datei hat eine höhere Nummer und ersetzt beim Import die alte. */
const SEQUENCE_EPOCH = Date.UTC(2026, 0, 1);

/**
 * Kalenderdatei für einen Gast: Titel, Zeit, Ort, Treffpunkt, eigene Antwort und der Link zurück zur Karte –
 * keine Namen der Crew, keine anderen Gäste. Gleiche UID je Teilen-Link, damit ein erneuter Import den Termin
 * ersetzt; „Vielleicht“ und vorgeschlagene Pläne stehen als vorläufig (TENTATIVE) im Kalender.
 */
export function guestPlanIcs(
  plan: GuestIcsPlan,
  input: { token: string; url: string; answer: "going" | "maybe"; labels: GuestIcsLabels },
  now: Date = new Date(),
): string {
  const description = [
    plan.meeting_point ? input.labels.meetingPoint(plan.meeting_point) : null,
    input.labels.answer,
    input.labels.link(input.url),
    input.labels.noUpdates,
  ]
    .filter(Boolean)
    .join("\n");
  const status = plan.status === "cancelled" ? "CANCELLED" : input.answer === "maybe" || plan.status === "proposed" ? "TENTATIVE" : "CONFIRMED";
  return buildIcs(
    {
      uid: `guest-${input.token.replace(/[^A-Za-z0-9_-]/g, "")}@afterhours`,
      title: plan.title,
      startsAt: plan.starts_at,
      endsAt: plan.ends_at,
      location: [plan.place, plan.address].filter((part): part is string => Boolean(part && part.trim())).join(", ") || null,
      description,
      url: input.url,
      status,
      sequence: (now.getTime() - SEQUENCE_EPOCH) / 1000,
      lastModified: null,
    },
    now,
  );
}

/** Stand des Termins, wie er in der Datei steht – auf dem Gerät gemerkt, um Änderungen zu erkennen. */
export type GuestIcsStamp = { title: string; starts_at: string; ends_at: string | null; where: string | null; meeting_point: string | null };

export function guestIcsStamp(plan: GuestIcsPlan): GuestIcsStamp {
  return {
    title: plan.title,
    starts_at: new Date(plan.starts_at).toISOString(),
    ends_at: plan.ends_at ? new Date(plan.ends_at).toISOString() : null,
    where: [plan.place, plan.address].filter(Boolean).join(", ") || null,
    meeting_point: plan.meeting_point,
  };
}

export type GuestIcsChange = "time" | "where" | "title";

/** Was sich seit der gespeicherten Datei geändert hat (Reihenfolge: Zeit, Ort/Treffpunkt, Titel). */
export function guestIcsChanges(saved: GuestIcsStamp | null, plan: GuestIcsPlan): GuestIcsChange[] {
  if (!saved) return [];
  const now = guestIcsStamp(plan);
  const changes: GuestIcsChange[] = [];
  if (saved.starts_at !== now.starts_at || saved.ends_at !== now.ends_at) changes.push("time");
  if (saved.where !== now.where || saved.meeting_point !== now.meeting_point) changes.push("where");
  if (saved.title !== now.title) changes.push("title");
  return changes;
}

/** Gespeicherten Stand prüfen – was auf dem Gerät liegt, ist nicht vertrauenswürdig und kann alt sein. */
export function parseGuestIcsStamp(raw: string | null): GuestIcsStamp | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<GuestIcsStamp>;
    const textOrNull = (v: unknown) => v === null || typeof v === "string";
    if (typeof value.title !== "string" || typeof value.starts_at !== "string" || Number.isNaN(Date.parse(value.starts_at))) return null;
    if (!textOrNull(value.ends_at) || !textOrNull(value.where) || !textOrNull(value.meeting_point)) return null;
    return { title: value.title, starts_at: value.starts_at, ends_at: value.ends_at ?? null, where: value.where ?? null, meeting_point: value.meeting_point ?? null };
  } catch {
    return null;
  }
}
