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

/** Zusagen wie bei „Wer kommt mit?“: Mitglieder und Gäste mit „Bin dabei“. */
export function goingWithGuests(plan: {
  participants: { attendance_status: string }[];
  guests?: { attendance_status: string }[] | null;
}): number {
  return plan.participants.filter((p) => p.attendance_status === "going").length + (plan.guests ?? []).filter((g) => g.attendance_status === "going").length;
}
