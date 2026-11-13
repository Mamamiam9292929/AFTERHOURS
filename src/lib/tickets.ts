/**
 * P53 · „Habt ihr alle Tickets?“ – Stand des Ticket-Checks eines Plans.
 * Gezählt wird, wer „Bin dabei“ gesagt hat; jede Person sagt selbst „Hab mein Ticket“ (Server: `set_my_plan_ticket`).
 * Wer abgesagt hat und trotzdem ein Ticket hat, steht als „Ticket übrig“ da – die Angabe hängt nicht an der Antwort.
 * Reihenfolge der Listen: wie die Teilnehmer kommen (Server sortiert nicht, die Planseite auch nicht).
 */
export interface TicketAnswer {
  user_id: string;
  attendance_status: string;
  has_ticket?: boolean | null;
}

export interface TicketStanding {
  /** so viele haben zugesagt */
  going: number;
  /** davon mit Ticket */
  have: number;
  /** zugesagt, noch ohne Ticket */
  missing: string[];
  /** abgesagt, hat aber ein Ticket */
  spare: string[];
  /** alle, die zugesagt haben, haben eins (und es hat überhaupt jemand zugesagt) */
  complete: boolean;
}

export function ticketStanding(participants: TicketAnswer[]): TicketStanding {
  const going = participants.filter((p) => p.attendance_status === "going");
  const missing = going.filter((p) => !p.has_ticket).map((p) => p.user_id);
  const spare = participants.filter((p) => p.attendance_status === "declined" && p.has_ticket).map((p) => p.user_id);
  const have = going.length - missing.length;
  return { going: going.length, have, missing, spare, complete: going.length > 0 && missing.length === 0 };
}

/** Darf die Person ihre Angabe ändern? Bei „Bin dabei“ und „Vielleicht“ – und wer schon „hab eins“ gesagt hat, kann es zurücknehmen. */
export function canSayTicket(answer: { attendance_status: string; has_ticket?: boolean | null } | undefined): boolean {
  if (!answer) return false;
  return answer.attendance_status === "going" || answer.attendance_status === "maybe" || Boolean(answer.has_ticket);
}
