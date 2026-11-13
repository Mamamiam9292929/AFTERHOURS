/**
 * P50 · „Danach noch wohin?“ – Stationen am Abend. Gleiche Regeln wie `public.add_plan_stop`
 * (Migration 20261113010000): höchstens vier Stationen, Uhrzeit nach dem Beginn und höchstens 18 Stunden danach.
 *
 * Die Uhrzeit wird wie gesprochen eingegeben („22:30“): Sie gehört zum Abend des Plans in Berliner Zeit – liegt sie
 * vor (oder auf) dem Beginn, ist der nächste Tag gemeint („01:00“ nach einem Abend ab 20 Uhr).
 *
 * Bewusst ohne Importe: Die Datei läuft unverändert im Unit-Test (`node --test`, Typen werden entfernt).
 */
export const STOP_MAX = 4;
export const STOP_MAX_HOURS = 18;

export interface StopLike {
  id: string;
  at: string | null;
  created_at: string;
}

const ZONE = "Europe/Berlin";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function berlin(ms: number): { y: number; m: number; d: number; h: number; min: number } {
  const map: Record<string, string> = {};
  for (const p of parts.formatToParts(new Date(ms))) map[p.type] = p.value;
  return { y: Number(map.year), m: Number(map.month), d: Number(map.day), h: Number(map.hour), min: Number(map.minute) };
}

/** Abstand Berlin – UTC in Minuten zu einem Zeitpunkt. */
function offsetAt(ms: number): number {
  const b = berlin(ms);
  return (Date.UTC(b.y, b.m - 1, b.d, b.h, b.min) - Math.floor(ms / MINUTE) * MINUTE) / MINUTE;
}

/** Berliner Wanduhrzeit → UTC-Millisekunden (sommerzeitfest, wie `zonedToUtc`). */
function wallToUtc(y: number, m: number, d: number, h: number, min: number): number {
  const wall = Date.UTC(y, m - 1, d, h, min);
  let utc = wall - offsetAt(wall) * MINUTE;
  utc = wall - offsetAt(utc) * MINUTE;
  return utc;
}

/**
 * Uhrzeit „HH:MM“ am Abend des Plans → Zeitpunkt (ISO), oder `null`, wenn die Eingabe kein Uhrzeit ist oder der
 * Zeitpunkt mehr als 18 Stunden nach dem Beginn läge.
 */
export function stopTimeFromClock(startsAt: string, clock: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  const start = Date.parse(startsAt);
  if (!match || !Number.isFinite(start)) return null;
  const h = Number(match[1]);
  const min = Number(match[2]);
  if (h > 23 || min > 59) return null;
  const day = berlin(start);
  let at = wallToUtc(day.y, day.m, day.d, h, min);
  if (at <= start) at = wallToUtc(day.y, day.m, day.d + 1, h, min);
  if (at <= start || at > start + STOP_MAX_HOURS * HOUR) return null;
  return new Date(at).toISOString();
}

/** Reihenfolge auf der Planseite: mit Uhrzeit zuerst (früh → spät), danach ohne Uhrzeit in Eintragsreihenfolge. */
export function sortStops<T extends StopLike>(stops: readonly T[]): T[] {
  return [...stops].sort((a, b) => {
    if (a.at && b.at) return Date.parse(a.at) - Date.parse(b.at) || a.created_at.localeCompare(b.created_at);
    if (a.at) return -1;
    if (b.at) return 1;
    return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
  });
}
