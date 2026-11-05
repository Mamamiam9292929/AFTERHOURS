/**
 * P26 · „Nur 6 Plätze“ – Höchstzahl mit Nachrückliste. Reine Rechenregeln für die Planseite (und später Tickets
 * und die geteilte Karte). Die Grenze selbst prüft der Server; hier geht es nur um die Anzeige.
 */

type CapacityPlan = { max_going?: number | null; status: string; starts_at: string };

/**
 * Wie viele Plätze sind noch frei? `null`: keine Anzeige – keine Höchstzahl, Plan vorbei/abgesagt oder schon
 * begonnen. `0`: voll (weitere Zusagen gehen auf die Nachrückliste).
 */
export function spotsLeft(plan: CapacityPlan, going: number, now: Date = new Date()): number | null {
  const max = plan.max_going ?? null;
  if (max == null || max < 1) return null;
  if (plan.status === "completed" || plan.status === "cancelled") return null;
  if (new Date(plan.starts_at).getTime() <= now.getTime()) return null;
  return Math.max(max - Math.max(going, 0), 0);
}

/**
 * P26 · Wird „Bin dabei“ zu „Nachrücken“? Ja, wenn die Runde voll ist und man selbst nicht schon dabei ist –
 * gleiche Regel auf der Planseite und bei der schnellen Antwort auf Home (Etappe 3a).
 */
export function joinsWaitlist(plan: CapacityPlan, mine: string | null | undefined, going: number, now: Date = new Date()): boolean {
  return mine !== "going" && spotsLeft(plan, going, now) === 0;
}

type Waiting = { user_id: string; waitlisted_at?: string | null };

/** Nachrückliste in der Reihenfolge des Servers: wer sich zuerst eingetragen hat, rückt zuerst nach. */
export function waitlist<T extends Waiting>(participants: T[]): T[] {
  return participants
    .filter((p) => p.waitlisted_at)
    .sort((a, b) => {
      const ta = new Date(a.waitlisted_at as string).getTime();
      const tb = new Date(b.waitlisted_at as string).getTime();
      return ta - tb || (a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0);
    });
}

/** Eigener Platz auf der Nachrückliste (1 = als Nächstes), sonst `null`. */
export function waitlistPosition(participants: Waiting[], userId: string): number | null {
  const index = waitlist(participants).findIndex((p) => p.user_id === userId);
  return index < 0 ? null : index + 1;
}

/** Zur Wahl stehende Höchstzahlen: nie unter den Zusagen, nie unter der Mindestzahl; eine gespeicherte bleibt wählbar. */
export function capacityOptions(going: number, min: number | null | undefined, current: number | null | undefined): number[] {
  const floor = Math.max(2, going, min ?? 0);
  const options = [4, 5, 6, 8, 10, 12, 16, 20].filter((n) => n >= floor);
  if (!options.includes(floor) && floor <= 50) options.unshift(floor);
  if (current != null && !options.includes(current)) options.push(current);
  return options.sort((a, b) => a - b);
}
