import { t } from "@/i18n";
import { siteUrl } from "@/lib/supabase";
import type { Plan } from "@/lib/types";

/*
 * P2 Etappe 1 · Plan in den eigenen Kalender. Erzeugt eine iCalendar-Datei (RFC 5545) im Browser –
 * nichts geht an einen Server oder an Dritte. Enthalten sind nur Titel, Beginn, (bekanntes) Ende,
 * Adresse, Treffpunkt und der Link zum Plan; keine Namen, keine Teilnehmerliste, keine E-Mail-Adressen.
 * Gleiche UID für denselben Plan: Ein erneuter Import ersetzt den Termin, SEQUENCE steigt mit jeder Änderung.
 */

type IcsPlan = Pick<Plan, "id" | "title" | "starts_at" | "ends_at" | "address" | "meeting_point" | "status" | "created_at" | "updated_at">;

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

export function planToIcs(plan: IcsPlan, now: Date = new Date()): string {
  const url = `${siteUrl()}/plans/${plan.id}`;
  const description = [plan.meeting_point ? t.plans.calendar.meetingPoint(plan.meeting_point) : null, t.plans.calendar.link(url)].filter(Boolean).join("\n");
  const sequence = Math.max(0, Math.floor((new Date(plan.updated_at).getTime() - new Date(plan.created_at).getTime()) / 1000));
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AFTERHOURS//Plan//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:plan-${plan.id}@afterhours`,
    `DTSTAMP:${icsDate(now)}`,
    `DTSTART:${icsDate(plan.starts_at)}`,
    // Ohne bekanntes Ende kein erfundenes: Der Termin hat dann nur einen Beginn (RFC 5545 §3.6.1).
    plan.ends_at ? `DTEND:${icsDate(plan.ends_at)}` : null,
    `SUMMARY:${icsText(plan.title)}`,
    plan.address ? `LOCATION:${icsText(plan.address)}` : null,
    `DESCRIPTION:${icsText(description)}`,
    `URL:${url}`,
    `STATUS:${plan.status === "proposed" ? "TENTATIVE" : plan.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
    `SEQUENCE:${sequence}`,
    `LAST-MODIFIED:${icsDate(plan.updated_at)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines
    .filter((line): line is string => line !== null)
    .map(foldLine)
    .join(CRLF)
    .concat(CRLF);
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

/** Lädt die Datei herunter; Handys bieten danach „Zum Kalender hinzufügen“ an. */
export function downloadPlanIcs(plan: IcsPlan): void {
  const blob = new Blob([planToIcs(plan)], { type: "text/calendar;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = icsFileName(plan.title);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
