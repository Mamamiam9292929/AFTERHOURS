/**
 * D3 Etappe 1 · Home als „Heute Abend“-Bühne – reine Logik (ohne React, per `node --test` geprüft).
 * Abstimmen auf Home: Welcher Vorschlag kommt als Nächstes? Live-Countdown: Wie lange noch bis zum Plan?
 * Der Server entscheidet über Stimmen und Pläne; hier wird nur ausgewählt und angezeigt.
 */

export type QuickResponse = "yes" | "maybe" | "no";

export interface QuickOption {
  id: string;
  /** Eigene gespeicherte Antwort, `null` ohne Antwort. */
  mine: QuickResponse | null;
}

/**
 * Vorschläge, die auf Home noch zur Antwort anstehen – in der Reihenfolge der Abstimmung. Was schon
 * gespeichert ist, gerade in dieser Sitzung beantwortet oder übersprungen wurde, fällt weg.
 */
export function pendingOptions<T extends QuickOption>(options: T[], answered: ReadonlySet<string>, skipped: ReadonlySet<string>): T[] {
  return options.filter((option) => option.mine === null && !answered.has(option.id) && !skipped.has(option.id));
}

/**
 * Gehört eine laufende Abstimmung unter „Deine Antwort fehlt“? Ja, solange du noch gar nicht abgestimmt hast –
 * und auch danach, wenn du in dieser Sitzung auf Home angefangen hast (`touched`). So verschwindet die
 * Karte nicht nach dem ersten Tipp; wer durch ist, sieht „Danke“, bis Home neu geöffnet wird.
 */
export function needsQuickVote(options: QuickOption[], touched: boolean): boolean {
  const open = options.some((option) => option.mine === null);
  const voted = options.some((option) => option.mine !== null);
  return touched || (open && !voted);
}

export type LiveCountdown = { kind: "soon"; minutes: number } | { kind: "live" } | null;

/** Ab wann der Countdown auf Home live mitläuft (Stunden vor Beginn). */
export const LIVE_HOURS = 12;
/** Ohne Ende des Plans gilt er so lange nach Beginn als „läuft gerade“. */
export const LIVE_FALLBACK_MINUTES = 180;

/**
 * Live-Countdown für das große Ticket auf Home: in den letzten 12 Stunden vor Beginn minutengenau
 * („noch 2:14 h“, aufgerundet – nie „noch 0 min“), danach „läuft gerade“ bis zum Ende (ohne Ende 3 h).
 * Abgesagte und abgeschlossene Pläne zählen nicht herunter.
 */
export function liveCountdown(plan: { starts_at: string; ends_at: string | null; status: string }, now: Date): LiveCountdown {
  if (plan.status === "cancelled" || plan.status === "completed") return null;
  const start = new Date(plan.starts_at).getTime();
  const diff = start - now.getTime();
  if (diff > 0) {
    if (diff > LIVE_HOURS * 3600_000) return null;
    return { kind: "soon", minutes: Math.max(1, Math.ceil(diff / 60_000)) };
  }
  const end = plan.ends_at ? new Date(plan.ends_at).getTime() : start + LIVE_FALLBACK_MINUTES * 60_000;
  return now.getTime() < end ? { kind: "live" } : null;
}

/** „2:14 h“ bzw. „35 min“ – wie die Restzeit bei „Heute noch wer?“. */
export function formatCountdown(minutes: number): string {
  if (minutes >= 60) return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")} h`;
  return `${minutes} min`;
}
