/**
 * P43 · „Seid ihr schon da?“ – wann die Planseite die Karte zeigt und in welcher Reihenfolge. Gleiche Regel wie
 * `app_private.plan_arrival_open` (Migration 20261111200000): ab 1 Stunde vor Beginn bis 3 Stunden nach Beginn,
 * höchstens bis zum Ende; ohne (gültiges) Ende gilt der Abend vier Stunden nach Beginn als vorbei – wie bei P13/P31.
 * Abgesagte Pläne nie.
 *
 * Bewusst ohne Importe: Die Datei läuft unverändert im Unit-Test (`node --test`, Typen werden entfernt).
 */
export interface ArrivalPlan {
  status: string;
  starts_at: string;
  ends_at: string | null;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
/** So lange vor Beginn kann man schon „Bin da“ sagen (wer früher kommt, sucht einen Tisch). */
export const ARRIVAL_BEFORE_HOURS = 1;
/** So lange nach Beginn ist Ankommen noch ein Thema. */
export const ARRIVAL_AFTER_HOURS = 3;
/** Ohne Ende: so lange nach Beginn gilt der Abend als vorbei (wie `HOME_EVENING_HOURS`). */
export const ARRIVAL_EVENING_HOURS = 4;
/** Die Knöpfe „Bin in … Min. da“ – der Server nimmt 1 bis 120 Minuten. */
export const ARRIVAL_MINUTES = [10, 20, 30, 60] as const;

/** Fenster von „Seid ihr schon da?“ – oder `null` ohne gültigen Beginn. */
export function arrivalWindow(plan: ArrivalPlan): { from: Date; until: Date } | null {
  const start = Date.parse(plan.starts_at);
  if (!Number.isFinite(start)) return null;
  const end = plan.ends_at ? Date.parse(plan.ends_at) : Number.NaN;
  const over = Number.isFinite(end) && end > start ? end : start + ARRIVAL_EVENING_HOURS * HOUR;
  return { from: new Date(start - ARRIVAL_BEFORE_HOURS * HOUR), until: new Date(Math.min(start + ARRIVAL_AFTER_HOURS * HOUR, over)) };
}

export function arrivalOpen(plan: ArrivalPlan, now: Date = new Date()): boolean {
  if (plan.status === "cancelled") return false;
  const window = arrivalWindow(plan);
  if (!window) return false;
  const t = now.getTime();
  return t >= window.from.getTime() && t < window.until.getTime();
}

export interface ArrivalEntry {
  user_id: string;
  state: "here" | "late";
  eta: string | null;
  updated_at: string;
}

/**
 * Reihenfolge der Liste: du zuerst, dann wer schon da ist (wer zuerst kam, zuerst), dann wer noch kommt (wer am
 * frühesten da sein will, zuerst).
 */
export function arrivalOrder<T extends ArrivalEntry>(people: readonly T[], userId: string): T[] {
  const key = (entry: T) => (entry.state === "here" ? Date.parse(entry.updated_at) : Date.parse(entry.eta ?? entry.updated_at));
  return [...people].sort((a, b) => {
    if (a.user_id === userId) return -1;
    if (b.user_id === userId) return 1;
    if (a.state !== b.state) return a.state === "here" ? -1 : 1;
    return key(a) - key(b);
  });
}

/** Ist die angesagte Uhrzeit schon vorbei? Dann heißt es „wollte … da sein“ statt „gegen …“. */
export function arrivalOverdue(entry: Pick<ArrivalEntry, "state" | "eta">, now: Date = new Date()): boolean {
  return entry.state === "late" && entry.eta !== null && Date.parse(entry.eta) <= now.getTime();
}

/** Wie viele schon da sind und wie viele noch kommen – für die Kurzzeile unter der Überschrift. */
export function arrivalCounts(people: readonly Pick<ArrivalEntry, "state">[]): { here: number; late: number } {
  let here = 0;
  for (const entry of people) if (entry.state === "here") here += 1;
  return { here, late: people.length - here };
}
