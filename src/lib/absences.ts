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

const addDay = (date: string, days: number) => new Date(toUtc(date) + days * 86_400_000).toISOString().slice(0, 10);

export interface AwaySoon {
  user_id: string;
  starts_on: string;
  ends_on: string;
  /** Läuft schon (Beginn ≤ heute). */
  now: boolean;
}

/**
 * P21 Etappe 2 · „Gerade weg“ auf der Crew-Seite: je Person der Zeitraum, der heute läuft oder innerhalb von
 * `horizonDays` beginnt. Überlappende oder lückenlos aneinander anschließende Zeiträume einer Person zählen als
 * einer („bis 25.11.“ statt „bis 20.11.“). Laufende zuerst (früheres Ende vorn), dann kommende nach Beginn;
 * bei Gleichstand in der Reihenfolge von `order`, Unbekannte dahinter nach ID.
 */
export function awaySoon(list: readonly Absence[], today: string, horizonDays = 14, order: readonly string[] = []): AwaySoon[] {
  if (!DATE.test(today)) return [];
  const until = addDay(today, horizonDays);
  const byUser = new Map<string, Absence[]>();
  for (const a of list) {
    if (!DATE.test(a.starts_on) || !DATE.test(a.ends_on) || a.ends_on < a.starts_on) continue;
    byUser.set(a.user_id, [...(byUser.get(a.user_id) ?? []), a]);
  }
  const result: AwaySoon[] = [];
  for (const [userId, ranges] of byUser) {
    const sorted = [...ranges].sort((a, b) => a.starts_on.localeCompare(b.starts_on));
    const merged: { starts_on: string; ends_on: string }[] = [];
    for (const r of sorted) {
      const last = merged[merged.length - 1];
      if (last && r.starts_on <= addDay(last.ends_on, 1)) {
        if (r.ends_on > last.ends_on) last.ends_on = r.ends_on;
      } else merged.push({ starts_on: r.starts_on, ends_on: r.ends_on });
    }
    const hit = merged.find((r) => r.ends_on >= today && r.starts_on <= until);
    if (hit) result.push({ user_id: userId, ...hit, now: hit.starts_on <= today });
  }
  const rank = (id: string) => {
    const index = order.indexOf(id);
    return index === -1 ? order.length : index;
  };
  return result.sort(
    (a, b) =>
      Number(b.now) - Number(a.now) ||
      (a.now ? a.ends_on.localeCompare(b.ends_on) : a.starts_on.localeCompare(b.starts_on)) ||
      rank(a.user_id) - rank(b.user_id) ||
      a.user_id.localeCompare(b.user_id),
  );
}
