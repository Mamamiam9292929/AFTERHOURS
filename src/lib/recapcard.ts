/**
 * P9 Etappe 2 · Rückblick als Bild zum Teilen – was auf das Bild kommt (ohne Zeichnen, per `node --test`
 * geprüft). Bewusst nur Zahlen: keine Namen, keine Crew-Bezeichnung, keine Orte – Stammorte heißen oft
 * „Grillen bei Bob“. Was im Rückblick fehlt (z. B. kein Lieblingstag), fehlt auch auf dem Bild.
 *
 * Bewusst ohne Importe: Die Datei läuft unverändert im Unit-Test (Typen werden entfernt).
 */

export interface RecapCardInput {
  evenings: number;
  firstAt: string | null;
  longestStreak: number;
  biggestRound: number;
  favoriteWeekday: number | null;
  months: readonly { key: string; count: number }[];
}

export type RecapCardFact = { kind: "streak"; value: number } | { kind: "round"; value: number } | { kind: "weekday"; value: number };

export interface RecapCardBar {
  key: string;
  count: number;
  /** Höhe in Bildpunkten (0 < height ≤ maxHeight); leere Monate als flacher Strich. */
  height: number;
}

export interface RecapCardModel {
  evenings: number;
  firstAt: string | null;
  facts: RecapCardFact[];
  bars: RecapCardBar[];
}

/** Flacher Strich für Monate ohne Abend, damit die Zeitachse lesbar bleibt. */
export const EMPTY_BAR = 4;
/** Mindesthöhe eines Monats mit Abend – auch eine 1 neben einer 9 soll sichtbar sein. */
export const MIN_BAR = 16;

/** Gleiche Regeln wie die Kacheln auf der Crew-Seite: nur, was etwas aussagt. */
export function recapCardModel(recap: RecapCardInput, maxBarHeight = 200): RecapCardModel {
  const facts: RecapCardFact[] = [];
  if (recap.longestStreak >= 2) facts.push({ kind: "streak", value: recap.longestStreak });
  if (recap.biggestRound >= 2) facts.push({ kind: "round", value: recap.biggestRound });
  if (recap.favoriteWeekday !== null) facts.push({ kind: "weekday", value: recap.favoriteWeekday });
  const max = Math.max(1, ...recap.months.map((m) => m.count));
  const bars = recap.months.map((m) => ({
    key: m.key,
    count: m.count,
    height: m.count > 0 ? Math.max(MIN_BAR, Math.round((m.count / max) * maxBarHeight)) : EMPTY_BAR,
  }));
  return { evenings: recap.evenings, firstAt: recap.firstAt, facts, bars };
}

/** Dateiname mit Datum in Berliner Zeit, z. B. „afterhours-rueckblick-2026-10-21.png“. */
export function recapCardFileName(now: Date): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return `afterhours-rueckblick-${day}.png`;
}
