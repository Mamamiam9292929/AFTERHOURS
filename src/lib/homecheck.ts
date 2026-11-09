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

/** Wann der Abend vorbei ist (Ende bzw. vier Stunden nach Beginn) – oder `null` ohne gültigen Beginn. */
function eveningOver(plan: HomeCheckPlan): number | null {
  const start = Date.parse(plan.starts_at);
  if (!Number.isFinite(start)) return null;
  const end = plan.ends_at ? Date.parse(plan.ends_at) : Number.NaN;
  return Number.isFinite(end) && end > start ? end : start + HOME_EVENING_HOURS * HOUR;
}

/** Bis wann „Gut heimgekommen?“ offen ist – oder `null`, wenn der Plan keinen gültigen Beginn hat. */
export function homeCheckUntil(plan: HomeCheckPlan): Date | null {
  const over = eveningOver(plan);
  return over === null ? null : new Date(over + HOME_AFTER_HOURS * HOUR);
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

/**
 * P31 Etappe 2 · Home zeigt die Karte erst gegen Ende des Abends: zwei Stunden vor dem Ende (ohne Ende also zwei
 * Stunden nach Beginn), nie vor Beginn. Vorher gehört Home dem Abend selbst (Ticket, Treffpunkt), danach bis zum
 * Vormittag dem Heimweg.
 */
export const HOME_ON_HOME_BEFORE_HOURS = 2;

export function homeCheckOnHomeFrom(plan: HomeCheckPlan): Date | null {
  const over = eveningOver(plan);
  if (over === null) return null;
  return new Date(Math.max(Date.parse(plan.starts_at), over - HOME_ON_HOME_BEFORE_HOURS * HOUR));
}

export interface HomeCheckCandidate extends HomeCheckPlan {
  id: string;
  participants: readonly { user_id: string; attendance_status: string }[];
}

/**
 * P31 Etappe 2 · der Abend, für den Home „Gut heimgekommen?“ zeigt: nur mit eigener Zusage („Bin dabei“ oder
 * „Vielleicht“ – wie beim Server), ab `homeCheckOnHomeFrom` bis zum Ende des Fensters, nicht ausgeblendet. Bei
 * mehreren der zuletzt begonnene – das ist der Abend, von dem man gerade heimkommt.
 */
export function planForHomeCheck<P extends HomeCheckCandidate>(plans: readonly P[], userId: string, hidden: readonly string[], now: Date = new Date()): P | null {
  const t = now.getTime();
  let best: P | null = null;
  for (const plan of plans) {
    if (hidden.includes(plan.id) || !homeCheckOpen(plan, now)) continue;
    const mine = plan.participants.find((p) => p.user_id === userId)?.attendance_status;
    if (mine !== "going" && mine !== "maybe") continue;
    const from = homeCheckOnHomeFrom(plan);
    if (!from || t < from.getTime()) continue;
    if (!best || Date.parse(plan.starts_at) > Date.parse(best.starts_at)) best = plan;
  }
  return best;
}

/** So viele ausgeblendete Abende merkt sich das Gerät (die ältesten fallen heraus). */
export const HOME_HIDDEN_LIMIT = 20;

export function hideHomeCheck(hidden: readonly string[], planId: string): string[] {
  return [...hidden.filter((id) => id !== planId), planId].slice(-HOME_HIDDEN_LIMIT);
}
