/**
 * Datum und Uhrzeit. Die App rechnet durchgehend in der Zeitzone des Marktes (Europe/Berlin),
 * unabhängig davon, wie das Gerät eingestellt ist. Gespeichert wird UTC.
 */
import { intlLocale, readLocale } from "@/i18n/locale";
import type { Weekday } from "./types";

export const APP_TIME_ZONE = "Europe/Berlin";
/** P11: „de-DE“ oder „en-GB“ – je nach Sprache der Oberfläche; Zeitzone bleibt immer Berlin. */
export const APP_LOCALE = intlLocale(readLocale());
const GERMAN = APP_LOCALE === "de-DE";
/** Deutsch „20:00 Uhr“, Englisch „20:00“. */
const withClock = (time: string) => (GERMAN ? `${time} Uhr` : time);

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  weekday: "short",
});

const WEEKDAYS: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export interface ZonedParts {
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  time: string;
  weekday: Weekday;
  year: number; month: number; day: number; hour: number; minute: number;
}

export function zonedParts(input: Date | string | number = new Date()): ZonedParts {
  const map: Record<string, string> = {};
  for (const part of partsFormatter.formatToParts(new Date(input))) map[part.type] = part.value;
  const year = Number(map.year), month = Number(map.month), day = Number(map.day);
  const hour = Number(map.hour), minute = Number(map.minute);
  const weekdayIndex = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    time: `${map.hour}:${map.minute}`,
    weekday: WEEKDAYS[weekdayIndex] ?? "mon",
    year, month, day, hour, minute,
  };
}

function offsetMinutesAt(utcMillis: number): number {
  const p = zonedParts(utcMillis);
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(utcMillis / 60000) * 60000) / 60000;
}

/** Wandelt eine Berliner Ortszeit ("2026-06-14", "19:30") in einen UTC-Zeitpunkt um (sommerzeitfest). */
export function zonedToUtc(date: string, time: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})/.exec(time);
  if (!d || !t) return null;
  const wall = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  if (Number.isNaN(wall)) return null;
  let utc = wall - offsetMinutesAt(wall) * 60000;
  utc = wall - offsetMinutesAt(utc) * 60000;
  return new Date(utc);
}

/** YYYY-MM-DD plus n Tage (Kalenderrechnung, ohne Zeitzonenfallen). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  return next.toISOString().slice(0, 10);
}

export function today(): string {
  return zonedParts().date;
}

/** Nächster Tag mit diesem Wochentag; heute zählt nur, wenn includeToday gesetzt ist. */
export function nextWeekday(target: Weekday, includeToday = false): string {
  const now = zonedParts();
  const diff = (WEEKDAYS.indexOf(target) - WEEKDAYS.indexOf(now.weekday) + 7) % 7;
  return addDays(now.date, diff === 0 && !includeToday ? 7 : diff);
}

const dateLong = new Intl.DateTimeFormat(APP_LOCALE, { timeZone: APP_TIME_ZONE, weekday: "long", day: "numeric", month: "long" });
const dateShort = new Intl.DateTimeFormat(APP_LOCALE, { timeZone: APP_TIME_ZONE, weekday: "short", day: "numeric", month: "short" });
const dateWithYear = new Intl.DateTimeFormat(APP_LOCALE, { timeZone: APP_TIME_ZONE, day: "numeric", month: "long", year: "numeric" });
const timeOnly = new Intl.DateTimeFormat(APP_LOCALE, { timeZone: APP_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const weekdayShort = new Intl.DateTimeFormat(APP_LOCALE, { timeZone: APP_TIME_ZONE, weekday: "short" });
const monthShort = new Intl.DateTimeFormat(APP_LOCALE, { timeZone: APP_TIME_ZONE, month: "short" });
const relative = new Intl.RelativeTimeFormat(APP_LOCALE, { numeric: "auto" });

export const formatDateLong = (v: Date | string) => dateLong.format(new Date(v));
export const formatDateShort = (v: Date | string) => dateShort.format(new Date(v));
export const formatDateWithYear = (v: Date | string) => dateWithYear.format(new Date(v));
export const formatTime = (v: Date | string) => withClock(timeOnly.format(new Date(v)));
export const formatDateTime = (v: Date | string) => `${formatDateShort(v)}, ${formatTime(v)}`;

const monthYear = new Intl.DateTimeFormat(APP_LOCALE, { timeZone: APP_TIME_ZONE, month: "long", year: "numeric" });
/** "Oktober 2026" – z. B. für „Dabei seit …“ im Profil. */
export const formatMonthYear = (v: Date | string) => monthYear.format(new Date(v));

/** Für den Ticket-Abriss: Wochentag, Tag und Monat getrennt. */
export function ticketDate(v: Date | string): { weekday: string; day: string; month: string } {
  const d = new Date(v);
  return {
    weekday: weekdayShort.format(d).replace(".", ""),
    day: String(zonedParts(d).day),
    month: monthShort.format(d).replace(".", ""),
  };
}

/** Kalenderdatum ohne Uhrzeit ("2026-06-14") lesbar machen. */
export function formatPlainDate(date: string, style: "short" | "long" = "short"): string {
  const utc = zonedToUtc(date, "12:00");
  if (!utc) return date;
  return style === "long" ? formatDateLong(utc) : formatDateShort(utc);
}

export const formatPlainTime = (time: string) => withClock(time.slice(0, 5));

/** "in 3 Stunden", "vor 5 Minuten", "morgen" – für Fristen und Verläufe. */
export function formatRelative(v: Date | string, now: Date = new Date()): string {
  const diffSeconds = Math.round((new Date(v).getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diffSeconds);
  if (abs < 60) return relative.format(Math.round(diffSeconds), "second");
  if (abs < 3600) return relative.format(Math.round(diffSeconds / 60), "minute");
  if (abs < 86400) return relative.format(Math.round(diffSeconds / 3600), "hour");
  // Ab einem Tag in Kalendertagen (Berlin), wie der Countdown auf dem Ticket: Samstag 19 Uhr ist am
  // Mittwochmorgen „in 3 Tagen“, nicht gerundet „in 4 Tagen“.
  if (abs < 86400 * 30) {
    const days = calendarDaysBetween(now, v);
    return relative.format(days === 0 ? Math.sign(diffSeconds) : days, "day");
  }
  return formatDateWithYear(v);
}

/** Tageszeit-Abschnitt in Berlin – steuert Begrüßung und Leitfrage auf Home. */
/** Kalendertage zwischen zwei Zeitpunkten in Berliner Zeit (heute = 0, morgen = 1). */
export function calendarDaysBetween(from: Date | string, to: Date | string): number {
  const day = (v: Date | string) => {
    const p = zonedParts(v);
    return Date.UTC(p.year, p.month - 1, p.day) / 86_400_000;
  };
  return Math.round(day(to) - day(from));
}

export function dayPhase(now: Date = new Date()): "morning" | "day" | "evening" | "night" {
  const { hour } = zonedParts(now);
  if (hour < 5) return "night";
  if (hour < 11) return "morning";
  if (hour < 17) return "day";
  if (hour < 23) return "evening";
  return "night";
}

/** Wert für <input type="datetime-local"> in Berliner Zeit. */
export function toLocalInputValue(v: Date | string): string {
  const p = zonedParts(v);
  return `${p.date}T${p.time}`;
}

export function fromLocalInputValue(value: string): Date | null {
  const [date, time] = value.split("T");
  if (!date || !time) return null;
  return zonedToUtc(date, time);
}

/** Wie formatRelative, aber nie in der Zukunft: Zeitstempel des Servers können der Geräteuhr minimal vorauslaufen. */
export function formatAgo(v: Date | string, now: Date = new Date()): string {
  const then = new Date(v);
  if (now.getTime() - then.getTime() < 45_000) return "gerade eben";
  return formatRelative(then, now);
}
