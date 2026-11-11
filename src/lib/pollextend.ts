/**
 * P39 · „Noch einen Tag?“ – Frist einer laufenden Abstimmung verlängern. Gleiche Grenzen wie `extend_poll` in der
 * Datenbank: nur nach hinten, höchstens 14 Tage ab jetzt, spätestens 30 Minuten vor dem frühesten Termin, der noch
 * bevorsteht. Ohne Laufzeit-Importe, damit der Unit-Test sie direkt laden kann – den frühesten Termin rechnet die
 * Seite in Berliner Zeit aus (`zonedToUtc`) und gibt ihn als Millisekunden herein.
 */

export const EXTEND_PRESETS = [
  { key: "hours2", ms: 2 * 3_600_000 },
  { key: "day1", ms: 24 * 3_600_000 },
  { key: "days3", ms: 3 * 24 * 3_600_000 },
] as const;
export type ExtendPreset = (typeof EXTEND_PRESETS)[number]["key"];

const MAX_AHEAD_MS = 14 * 24 * 3_600_000;
const BEFORE_FIRST_MS = 30 * 60_000;

export type ExtendChoice = { key: ExtendPreset; endsAt: Date; allowed: boolean };

/**
 * Wahlmöglichkeiten ab der aktuellen Frist (auf die Minute). `null`, wenn es nichts zu verlängern gibt: beendet,
 * abgelaufen oder in einer laufenden Serie „Jede Woche neu“.
 * `firstStarts`: Beginn der Termine aller Vorschläge in Millisekunden (vergangene zählen nicht).
 */
export function extendChoices(
  poll: { status: string; ends_at: string; seriesActive?: boolean },
  firstStarts: (number | null)[],
  now: Date = new Date(),
): ExtendChoice[] | null {
  const ends = new Date(poll.ends_at).getTime();
  if (poll.status !== "open" || !(ends > now.getTime()) || poll.seriesActive) return null;
  const upcoming = firstStarts.filter((s): s is number => s != null && s > now.getTime());
  const limit = Math.min(now.getTime() + MAX_AHEAD_MS, upcoming.length ? Math.min(...upcoming) - BEFORE_FIRST_MS : Infinity);
  return EXTEND_PRESETS.map(({ key, ms }) => {
    const endsAt = new Date(Math.floor((ends + ms) / 60_000) * 60_000);
    return { key, endsAt, allowed: endsAt.getTime() > ends && endsAt.getTime() <= limit };
  });
}
