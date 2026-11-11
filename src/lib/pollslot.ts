/**
 * P40 · „Und Sonntag?“ – weiteren Termin in einer laufenden Termin-Abstimmung vorschlagen. Gleiche Regeln wie
 * `add_poll_slot` in der Datenbank, damit die Seite den Fehler zeigt, bevor sie fragt. Ohne Laufzeit-Importe, damit
 * der Unit-Test sie direkt laden kann – den Zeitpunkt des Termins rechnet die Seite in Berliner Zeit aus
 * (`zonedToUtc`) und gibt ihn als Millisekunden herein.
 */

export const MAX_POLL_SLOTS = 10;

type SlotPoll = {
  kind: string;
  status: string;
  ends_at: string;
  parent_poll_id: string | null;
  options: { proposed_date: string | null; proposed_time: string | null }[];
};

/** Ob „Anderen Termin vorschlagen“ überhaupt erscheint: laufende Termin-Abstimmung, keine Stichwahl. */
export function canSuggestSlot(poll: SlotPoll, now: Date = new Date()): boolean {
  return poll.kind === "date" && poll.status === "open" && new Date(poll.ends_at).getTime() > now.getTime() && !poll.parent_poll_id;
}

export function slotsFull(poll: Pick<SlotPoll, "options">): boolean {
  return poll.options.length >= MAX_POLL_SLOTS;
}

export type SlotProblem = "invalid" | "past" | "duplicate" | "full";

/** "HH:MM" aus einer Eingabe oder aus der Datenbank ("20:00:00"); leer bleibt leer. */
const minute = (time: string | null | undefined) => (time ? time.slice(0, 5) : "");

/**
 * Prüft einen Vorschlag. `date` und `time` wie aus den Feldern (YYYY-MM-DD, HH:MM oder leer), `today` ist der Tag in
 * Berliner Zeit, `startMs` der Zeitpunkt des Termins (ohne Uhrzeit egal – dann zählt nur der Tag).
 */
export function slotProblem(
  poll: Pick<SlotPoll, "options">,
  input: { date: string; time: string },
  today: string,
  startMs: number | null,
  now: Date = new Date(),
): SlotProblem | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return "invalid";
  const limit = new Date(`${today}T12:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + 365);
  if (input.date > limit.toISOString().slice(0, 10)) return "invalid";
  if (input.date < today) return "past";
  if (input.time && (startMs == null || startMs <= now.getTime())) return "past";
  if (poll.options.some((o) => o.proposed_date === input.date && minute(o.proposed_time) === minute(input.time))) return "duplicate";
  if (slotsFull(poll)) return "full";
  return null;
}
