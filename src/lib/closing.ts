/**
 * P30 · „Fand der Abend statt?“ – wann die Planseite oben fragt, ob der Abend stattgefunden hat.
 *
 * Nur bei offenen Plänen (Vorschlag, bestätigt, Reservierung), sobald der Abend vorbei ist: nach dem Ende bzw.
 * ohne Ende drei Stunden nach Beginn. Bis 30 Tage nach Beginn – danach ist es zu spät für „Wie war’s?“ und Fotos,
 * abschließen geht dann weiter über „Organisieren“. Wer fragen darf, entscheidet die Seite (Organisator:in, Owner,
 * Admins); der Server prüft es in `close_plan` noch einmal (Migration 20261109060000).
 *
 * Bewusst ohne Importe: Die Datei läuft unverändert im Unit-Test (`node --test`, Typen werden entfernt).
 */
export interface ClosablePlan {
  status: string;
  starts_at: string;
  ends_at: string | null;
}

const OPEN = new Set(["proposed", "confirmed", "booking_pending", "booked"]);
const HOUR = 60 * 60 * 1000;
/** Ohne Ende gilt der Abend drei Stunden nach Beginn als vorbei. */
export const EVENING_HOURS = 3;
export const CLOSE_PROMPT_DAYS = 30;

export function closePromptDue(plan: ClosablePlan, now: Date = new Date()): boolean {
  if (!OPEN.has(plan.status)) return false;
  const start = Date.parse(plan.starts_at);
  if (!Number.isFinite(start)) return false;
  const end = plan.ends_at ? Date.parse(plan.ends_at) : Number.NaN;
  const over = Number.isFinite(end) && end > start ? end : start + EVENING_HOURS * HOUR;
  const t = now.getTime();
  return t >= over && t < start + CLOSE_PROMPT_DAYS * 24 * HOUR;
}

/** P30 Etappe 2 · so viele offene Abende zeigt Home höchstens; der Rest steht als „+ N weitere“ in der Planliste. */
export const HOME_CLOSE_LIMIT = 3;

/**
 * P30 Etappe 2 · „Fand’s statt?“ auf Home: alle vergangenen, offenen Abende, die du abschließen darfst
 * (`canManage` – Organisator:in, Owner, Admins, wie auf der Planseite), der jüngste zuerst. Wer die Erinnerung am
 * Morgen danach weggewischt hat, sieht sie so beim nächsten Öffnen der App.
 */
export function plansToClose<P extends ClosablePlan>(plans: readonly P[], canManage: (plan: P) => boolean, now: Date = new Date()): P[] {
  return plans
    .filter((plan) => closePromptDue(plan, now) && canManage(plan))
    .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at));
}
