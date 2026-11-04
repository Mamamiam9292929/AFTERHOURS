/**
 * P21 · „Bin weg“ – Abwesenheiten bei der Terminsuche.
 *
 * Der Server liefert je Person laufende und kommende Zeiträume (`crew_absences`, Tage als YYYY-MM-DD, beide
 * eingeschlossen). Wer an einem Termin weg ist, rechnet die App. Kalenderdaten werden als Text verglichen –
 * das Format YYYY-MM-DD sortiert sich richtig, ganz ohne Zeitzone.
 *
 * Bewusst ohne Importe: Die Datei läuft unverändert im Unit-Test (`node --test`, Typen werden entfernt).
 */

export interface Absence {
  user_id: string;
  starts_on: string;
  ends_on: string;
}

/** So lang darf ein Zeitraum höchstens sein (Tage zwischen Beginn und Ende), so weit voraus darf er beginnen. */
export const ABSENCE_MAX_DAYS = 365;
export const ABSENCE_MAX_AHEAD_DAYS = 730;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const toUtc = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
};
const daysBetween = (from: string, to: string) => Math.round((toUtc(to) - toUtc(from)) / 86_400_000);

/**
 * Wer am Tag `date` weg ist – jede Person einmal, in der Reihenfolge von `order` (z. B. Mitglieder der Crew),
 * Unbekannte dahinter nach ID. Ohne Datum (Vorschlag ohne Termin): niemand.
 */
export function awayOn(list: readonly Absence[], date: string | null | undefined, order: readonly string[] = []): string[] {
  if (!date || !DATE.test(date)) return [];
  const ids = new Set(list.filter((a) => a.starts_on <= date && date <= a.ends_on).map((a) => a.user_id));
  const rank = (id: string) => {
    const index = order.indexOf(id);
    return index === -1 ? order.length : index;
  };
  return [...ids].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export type AbsenceProblem = "missing" | "order" | "past" | "long" | "far";

/** Prüft einen Zeitraum wie der Server (`add_my_absence`) – für eine Fehlermeldung, bevor gefragt wird. */
export function absenceProblem(starts: string, ends: string, today: string): AbsenceProblem | null {
  if (!DATE.test(starts) || !DATE.test(ends)) return "missing";
  if (ends < starts) return "order";
  if (ends < today) return "past";
  if (daysBetween(starts, ends) > ABSENCE_MAX_DAYS) return "long";
  if (daysBetween(today, starts) > ABSENCE_MAX_AHEAD_DAYS) return "far";
  return null;
}
