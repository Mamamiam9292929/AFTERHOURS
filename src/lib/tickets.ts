/**
 * P53 · „Habt ihr alle Tickets?“ – Stand des Ticket-Checks eines Plans.
 * Gezählt wird, wer „Bin dabei“ gesagt hat; jede Person sagt selbst „Hab mein Ticket“ (Server: `set_my_plan_ticket`).
 * Wer abgesagt hat und trotzdem ein Ticket hat, steht als „Ticket übrig“ da – die Angabe hängt nicht an der Antwort.
 * Reihenfolge der Listen: wie die Teilnehmer kommen (Server sortiert nicht, die Planseite auch nicht).
 * Etappe 2c: Gäste über den Teilen-Link (W10) sagen es auch (`guest_ticket_shared_plan`) und zählen mit – die
 * Planseite gibt sie nur mit, solange Zusagen über den Link an sind (sonst könnten sie nichts mehr ändern).
 * P54: Wer ein Ticket übrig hat, bietet es an (`offer_plan_ticket`); wer zugesagt und keins hat, nimmt es mit
 * „Nehm ich“ (`take_plan_ticket`). Das Angebot steht in `ticket_offered_at` und gilt nur mit Absage und Ticket.
 */
export interface TicketAnswer {
  user_id: string;
  attendance_status: string;
  has_ticket?: boolean | null;
  /** P54: seit wann die Person ihr übriges Ticket anbietet */
  ticket_offered_at?: string | null;
  /** P26: auf der Nachrückliste (zählt nicht als Zusage zum Nehmen) */
  waitlisted_at?: string | null;
}

export interface TicketGuest {
  id: string;
  display_name: string;
  attendance_status: string;
  has_ticket?: boolean | null;
}

export interface TicketStanding {
  /** so viele haben zugesagt */
  going: number;
  /** davon mit Ticket */
  have: number;
  /** zugesagt, noch ohne Ticket (Mitglieder, user_id) */
  missing: string[];
  /** abgesagt, hat aber ein Ticket (Mitglieder, user_id) */
  spare: string[];
  /** P54: davon bieten ihr Ticket an (Mitglieder, user_id) */
  offered: string[];
  /** Etappe 2c: Gäste mit Zusage, noch ohne Ticket (Namen) */
  missingGuests: string[];
  /** Etappe 2c: Gäste mit Absage, aber Ticket (Namen) */
  spareGuests: string[];
  /** alle, die zugesagt haben, haben eins (und es hat überhaupt jemand zugesagt) */
  complete: boolean;
}

export function ticketStanding(participants: TicketAnswer[], guests: TicketGuest[] = []): TicketStanding {
  const going = participants.filter((p) => p.attendance_status === "going");
  const missing = going.filter((p) => !p.has_ticket).map((p) => p.user_id);
  const spareRows = participants.filter((p) => p.attendance_status === "declined" && p.has_ticket);
  const spare = spareRows.map((p) => p.user_id);
  const offered = spareRows.filter((p) => Boolean(p.ticket_offered_at)).map((p) => p.user_id);
  const guestsGoing = guests.filter((g) => g.attendance_status === "going");
  const missingGuests = guestsGoing.filter((g) => !g.has_ticket).map((g) => g.display_name);
  const spareGuests = guests.filter((g) => g.attendance_status === "declined" && g.has_ticket).map((g) => g.display_name);
  const total = going.length + guestsGoing.length;
  const open = missing.length + missingGuests.length;
  return { going: total, have: total - open, missing, spare, offered, missingGuests, spareGuests, complete: total > 0 && open === 0 };
}

/** Darf die Person ihre Angabe ändern? Bei „Bin dabei“ und „Vielleicht“ – und wer schon „hab eins“ gesagt hat, kann es zurücknehmen. */
export function canSayTicket(answer: { attendance_status: string; has_ticket?: boolean | null } | undefined): boolean {
  if (!answer) return false;
  return answer.attendance_status === "going" || answer.attendance_status === "maybe" || Boolean(answer.has_ticket);
}

/** P54: Darf die Person ihr Ticket anbieten? Abgesagt, „Hab mein Ticket“ und noch nicht angeboten. */
export function canOfferTicket(answer: TicketAnswer | undefined): boolean {
  return Boolean(answer && answer.attendance_status === "declined" && answer.has_ticket && !answer.ticket_offered_at);
}

/** P54: Darf die Person ein angebotenes Ticket nehmen? Zugesagt (nicht auf der Nachrückliste) und noch ohne Ticket. */
export function canTakeTicket(answer: TicketAnswer | undefined): boolean {
  return Boolean(answer && answer.attendance_status === "going" && !answer.waitlisted_at && !answer.has_ticket);
}
