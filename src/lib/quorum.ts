/**
 * P25 Etappe 2 · Wie viele Zusagen fehlen noch bis zur Mindestzahl? Für Tickets (Home, Pläne, Crew) und die
 * geteilte Plan-Karte. `null`: keine Anzeige – keine Mindestzahl, Plan vorbei/abgesagt oder schon begonnen.
 * `0`: erreicht („Findet statt“). Sonst die Zahl, die noch fehlt.
 */
export function quorumLeft(
  plan: { min_going?: number | null; status: string; starts_at: string },
  going: number,
  now: Date = new Date(),
): number | null {
  const min = plan.min_going ?? null;
  if (min == null || min < 1) return null;
  if (plan.status === "completed" || plan.status === "cancelled") return null;
  if (new Date(plan.starts_at).getTime() <= now.getTime()) return null;
  return Math.max(min - Math.max(going, 0), 0);
}

/** P51: Köpfe einer Antwort – die Person selbst plus Begleitung (nur bei „Bin dabei“, 0–3). */
export function heads(answer: { attendance_status: string; plus_ones?: number | null }): number {
  if (answer.attendance_status !== "going") return 0;
  return 1 + Math.min(Math.max(Math.trunc(answer.plus_ones ?? 0), 0), 3);
}

/** P51: Zusagen der Crew samt Begleitung (ohne Gäste) – z. B. für Reservierung und Kosten. */
export function goingHeads(participants: { attendance_status: string; plus_ones?: number | null }[]): number {
  return participants.reduce((sum, p) => sum + heads(p), 0);
}

/**
 * Zusagen wie bei „Wer kommt mit?“: Mitglieder und Gäste mit „Bin dabei“, jeweils mit Begleitung (P51, Etappe 2
 * für Gäste) – gleiche Zählung wie `app_private.plan_going_count` auf dem Server.
 */
export function goingWithGuests(plan: {
  participants: { attendance_status: string; plus_ones?: number | null }[];
  guests?: { attendance_status: string; plus_ones?: number | null }[] | null;
}): number {
  return goingHeads(plan.participants) + goingHeads(plan.guests ?? []);
}
