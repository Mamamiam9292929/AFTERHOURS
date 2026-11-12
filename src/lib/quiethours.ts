/**
 * P49 · Nachtruhe fürs Handy – reine Regeln ohne Laufzeit-Importe (Unit-Test ohne Bundler). Gleiche Regel wie
 * `app_private.in_quiet_hours` auf dem Server: volle Stunden in Berliner Zeit, „bis“ ausschließlich, über Mitternacht.
 */

export type QuietHours = { from: number; to: number };

/** Auswahl in den Einstellungen; „Aus“ ist `null`. */
export const QUIET_PRESETS: readonly QuietHours[] = [
  { from: 22, to: 7 },
  { from: 23, to: 8 },
  { from: 0, to: 9 },
];

const hourFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hourCycle: "h23" });

/** Stunde (0–23) in Berlin. */
export function berlinHour(at: Date): number {
  return Number(hourFormat.format(at)) % 24;
}

const validHour = (h: unknown): h is number => typeof h === "number" && Number.isInteger(h) && h >= 0 && h <= 23;

/** Einstellung aus der Datenbank (beide null = aus); Ungültiges zählt als aus. */
export function quietFromSettings(from: number | null | undefined, to: number | null | undefined): QuietHours | null {
  return validHour(from) && validHour(to) && from !== to ? { from, to } : null;
}

export function inQuietHours(quiet: QuietHours | null, hour: number): boolean {
  if (!quiet || quiet.from === quiet.to) return false;
  return quiet.from < quiet.to ? hour >= quiet.from && hour < quiet.to : hour >= quiet.from || hour < quiet.to;
}

/** Läuft die Nachtruhe gerade? Dann bis wann (Stunde), sonst null. */
export function quietNow(quiet: QuietHours | null, at: Date): number | null {
  return inQuietHours(quiet, berlinHour(at)) ? quiet!.to : null;
}

export const samePreset = (a: QuietHours | null, b: QuietHours | null) => (a === null ? b === null : b !== null && a.from === b.from && a.to === b.to);
