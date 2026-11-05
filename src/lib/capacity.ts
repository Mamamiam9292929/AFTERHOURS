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
type WaitingGuest = { id: string; waitlisted_at?: string | null };

/** Nachrückliste der Crew in der Reihenfolge des Servers: wer sich zuerst eingetragen hat, rückt zuerst nach. */
export function waitlist<T extends Waiting>(participants: T[]): T[] {
  return planWaitlist(participants).flatMap((e) => (e.kind === "member" ? [e.entry] : []));
}

/** P26 Etappe 3b · Ein Platz auf der gemeinsamen Liste: Mitglied oder Gast ohne Konto. */
export type WaitlistEntry<P extends Waiting = Waiting, G extends WaitingGuest = WaitingGuest> =
  | { kind: "member"; key: string; entry: P }
  | { kind: "guest"; key: string; entry: G };

const time = (at: string | null | undefined) => new Date(at as string).getTime();

/**
 * P26 Etappe 3b · Gemeinsame Nachrückliste von Crew und Gästen – Reihenfolge wie `app_private.plan_waitlist_queue`:
 * nach Zeitpunkt, bei Gleichstand erst Mitglieder, dann nach Kennung. Gäste nur übergeben, wenn Zusagen über den
 * Link an sind (sonst rücken sie nicht nach und zählen auch nicht).
 */
export function planWaitlist<P extends Waiting, G extends WaitingGuest>(participants: P[], guests: G[] = []): WaitlistEntry<P, G>[] {
  const entries: WaitlistEntry<P, G>[] = [
    ...participants.filter((p) => p.waitlisted_at).map((p) => ({ kind: "member" as const, key: p.user_id, entry: p })),
    ...guests.filter((g) => g.waitlisted_at).map((g) => ({ kind: "guest" as const, key: g.id, entry: g })),
  ];
  return entries.sort(
    (a, b) =>
      time(a.entry.waitlisted_at) - time(b.entry.waitlisted_at) ||
      (a.kind === b.kind ? 0 : a.kind === "member" ? -1 : 1) ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
}

/** Eigener Platz auf der Nachrückliste (1 = als Nächstes), sonst `null`. Gäste davor zählen mit (Etappe 3b). */
export function waitlistPosition(participants: Waiting[], userId: string, guests: WaitingGuest[] = []): number | null {
  const index = planWaitlist(participants, guests).findIndex((e) => e.kind === "member" && e.key === userId);
  return index < 0 ? null : index + 1;
}

/** Gäste, die auf der gemeinsamen Liste mitzählen – nur solange Zusagen über den Link an sind. */
export function waitingGuests<G extends WaitingGuest>(plan: { guests_allowed?: boolean; guests?: G[] }): G[] {
  return plan.guests_allowed ? (plan.guests ?? []) : [];
}

/** Zur Wahl stehende Höchstzahlen: nie unter den Zusagen, nie unter der Mindestzahl; eine gespeicherte bleibt wählbar. */
export function capacityOptions(going: number, min: number | null | undefined, current: number | null | undefined): number[] {
  const floor = Math.max(2, going, min ?? 0);
  const options = [4, 5, 6, 8, 10, 12, 16, 20].filter((n) => n >= floor);
  if (!options.includes(floor) && floor <= 50) options.unshift(floor);
  if (current != null && !options.includes(current)) options.push(current);
  return options.sort((a, b) => a - b);
}
