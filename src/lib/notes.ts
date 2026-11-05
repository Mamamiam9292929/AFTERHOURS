import type { AttendanceStatus, PlanGuest, PlanParticipant } from "./types";

type Answer = Exclude<AttendanceStatus, "invited">;

/** P24 Etappe 3: ein Zusatz zur Antwort, wie ihn „Heute Abend“ auf Home zeigt. */
export interface AnswerNoteLine {
  key: string;
  /** Mitglied (user_id) oder Gast (Name ohne Konto). */
  userId: string | null;
  guestName: string | null;
  mine: boolean;
  status: Answer;
  note: string;
}

const ORDER: Record<Answer, number> = { going: 0, maybe: 1, declined: 2 };

/**
 * Alle Zusätze eines Plans für die Crew: die eigene zuerst, dann „dabei“, „vielleicht“, „abgesagt“, innerhalb
 * einer Gruppe nach Zeitpunkt der Antwort (älteste zuerst, Gäste nach Mitgliedern). Ohne Antwort zählt nichts.
 */
export function answerNotes(
  plan: { participants: Pick<PlanParticipant, "user_id" | "attendance_status" | "note" | "responded_at">[]; guests?: Pick<PlanGuest, "id" | "display_name" | "attendance_status" | "note" | "updated_at">[] },
  userId: string,
): AnswerNoteLine[] {
  const lines: (AnswerNoteLine & { at: string; guest: boolean })[] = [];
  for (const p of plan.participants) {
    if (p.attendance_status === "invited" || !p.note) continue;
    lines.push({ key: `u:${p.user_id}`, userId: p.user_id, guestName: null, mine: p.user_id === userId, status: p.attendance_status, note: p.note, at: p.responded_at ?? "", guest: false });
  }
  for (const g of plan.guests ?? []) {
    if (!g.note) continue;
    lines.push({ key: `g:${g.id}`, userId: null, guestName: g.display_name, mine: false, status: g.attendance_status, note: g.note, at: g.updated_at, guest: true });
  }
  lines.sort((a, b) => Number(b.mine) - Number(a.mine) || ORDER[a.status] - ORDER[b.status] || Number(a.guest) - Number(b.guest) || a.at.localeCompare(b.at));
  return lines.map((l) => ({ key: l.key, userId: l.userId, guestName: l.guestName, mine: l.mine, status: l.status, note: l.note }));
}
