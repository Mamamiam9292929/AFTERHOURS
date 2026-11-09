/**
 * P31 · „Gut heimgekommen?“ – wann die Planseite die Karte zeigt. Gleiche Regel wie `app_private.plan_home_open`
 * (Migration 20261109190000): ab Beginn bis 12 Stunden nach dem Ende; ohne (gültiges) Ende gilt der Abend vier
 * Stunden nach Beginn als vorbei – wie beim Live-Standort (P13). Abgesagte Pläne nie; abgeschlossene schon, denn wer
 * organisiert, schließt oft noch in derselben Nacht ab.
 *
 * Bewusst ohne Importe: Die Datei läuft unverändert im Unit-Test (`node --test`, Typen werden entfernt).
 */
export interface HomeCheckPlan {
  status: string;
  starts_at: string;
  ends_at: string | null;
}

const HOUR = 60 * 60 * 1000;
/** Ohne Ende: so lange nach Beginn gilt der Abend als vorbei (wie `LIVE_AFTER_MS`). */
export const HOME_EVENING_HOURS = 4;
/** So lange nach dem Ende kann man noch „Bin zuhause“ sagen. */
export const HOME_AFTER_HOURS = 12;

/** Bis wann „Gut heimgekommen?“ offen ist – oder `null`, wenn der Plan keinen gültigen Beginn hat. */
export function homeCheckUntil(plan: HomeCheckPlan): Date | null {
  const start = Date.parse(plan.starts_at);
  if (!Number.isFinite(start)) return null;
  const end = plan.ends_at ? Date.parse(plan.ends_at) : Number.NaN;
  const over = Number.isFinite(end) && end > start ? end : start + HOME_EVENING_HOURS * HOUR;
  return new Date(over + HOME_AFTER_HOURS * HOUR);
}

export function homeCheckOpen(plan: HomeCheckPlan, now: Date = new Date()): boolean {
  if (plan.status === "cancelled") return false;
  const until = homeCheckUntil(plan);
  if (!until) return false;
  const t = now.getTime();
  return t >= Date.parse(plan.starts_at) && t < until.getTime();
}

/** Wer zuhause ist, in der Reihenfolge der Meldung; die eigene Meldung zuerst, damit man sich gleich findet. */
export function homeOrder<T extends { user_id: string; arrived_at: string }>(home: readonly T[], userId: string): T[] {
  return [...home].sort((a, b) => {
    if (a.user_id === userId) return -1;
    if (b.user_id === userId) return 1;
    return Date.parse(a.arrived_at) - Date.parse(b.arrived_at);
  });
}
