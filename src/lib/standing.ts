/**
 * P37 · „Zwischenstand“ für den Gruppenchat. Reine Rechen- und Textregeln: wie viele sind dabei, vielleicht, auf der
 * Nachrückliste, ohne Antwort – nur Zahlen, nie Namen (wie W8). Die Texte kommen von außen (`t.planCards.standing`),
 * damit die Regeln ohne i18n-Laufzeit testbar bleiben.
 */

type Answer = { attendance_status: string; waitlisted_at?: string | null; plus_ones?: number | null; has_ticket?: boolean | null };

export type StandingPlan = {
  status: string;
  starts_at: string;
  min_going?: number | null;
  max_going?: number | null;
  guests_allowed?: boolean;
  /** P53: Ticket-Check an. */
  tickets_needed?: boolean | null;
  participants: Answer[];
  guests?: Answer[] | null;
};

export type Standing = {
  going: number;
  maybe: number;
  /** P26: auf der Nachrückliste (zählt nicht bei „vielleicht“). */
  waiting: number;
  /** Mitglieder ohne Antwort. Gäste haben immer eine Antwort. */
  open: number;
  /** P25: `null` ohne Mindestzahl, `0` erreicht. */
  quorumLeft: number | null;
  /** P26: `null` ohne Höchstzahl, `0` voll. */
  spotsLeft: number | null;
  /**
   * P53 Etappe 2b: Zusagen, die noch kein Ticket angegeben haben. `null` ohne Ticket-Check oder solange niemand
   * zugesagt hat, `0` alle haben eins. Etappe 2c: Gäste zählen mit, solange Zusagen über den Link an sind.
   */
  ticketsMissing: number | null;
};

/**
 * Stand eines Plans wie bei „Wer kommt mit?“. `null`, wenn es nichts mehr zu fragen gibt: abgesagt, abgeschlossen
 * oder schon begonnen – dann gibt es keinen Knopf.
 */
export function planStanding(plan: StandingPlan, now: Date = new Date()): Standing | null {
  if (plan.status === "cancelled" || plan.status === "completed") return null;
  if (new Date(plan.starts_at).getTime() <= now.getTime()) return null;
  // Gäste auf der Nachrückliste zählen nur, solange Zusagen über den Link an sind (wie auf der Planseite).
  const guests = plan.guests ?? [];
  const waits = (a: Answer, guest: boolean) => a.attendance_status === "maybe" && Boolean(a.waitlisted_at) && (!guest || Boolean(plan.guests_allowed));
  const all = [...plan.participants.map((a) => ({ a, guest: false })), ...guests.map((a) => ({ a, guest: true }))];
  // P51: Begleitung zählt bei „dabei“ mit – auch bei Gästen (Etappe 2), wie `goingWithGuests` und
  // `app_private.plan_going_count`.
  const going = all.reduce((sum, { a }) => sum + (a.attendance_status !== "going" ? 0 : 1 + Math.min(Math.max(Math.trunc(a.plus_ones ?? 0), 0), 3)), 0);
  const waiting = all.filter(({ a, guest }) => waits(a, guest)).length;
  const maybe = all.filter(({ a, guest }) => a.attendance_status === "maybe" && !waits(a, guest)).length;
  const open = plan.participants.filter((a) => a.attendance_status === "invited").length;
  // Gleiche Regeln wie `quorumLeft` (P25) und `spotsLeft` (P26) – hier ohne Laufzeit-Import, damit Node den Test
  // ohne Bundler laden kann; der Unit-Test prüft, dass beide übereinstimmen.
  const left = (limit: number | null | undefined) => (limit == null || limit < 1 ? null : Math.max(limit - going, 0));
  // P53: wie `ticketStanding` (Unit-Test prüft, dass beide übereinstimmen) – Gäste nur mit Zusagen über den Link.
  const ticketGoing = [...plan.participants, ...(plan.guests_allowed ? guests : [])].filter((a) => a.attendance_status === "going");
  const ticketsMissing = plan.tickets_needed && ticketGoing.length > 0 ? ticketGoing.filter((a) => !a.has_ticket).length : null;
  return { going, maybe, waiting, open, quorumLeft: left(plan.min_going), spotsLeft: left(plan.max_going), ticketsMissing };
}

export type StandingTexts = {
  head: (title: string, when: string) => string;
  going: (n: number) => string;
  maybe: (n: number) => string;
  waiting: (n: number) => string;
  open: (n: number) => string;
  quorumLeft: (n: number) => string;
  quorumReached: string;
  spotsLeft: (n: number) => string;
  full: string;
  /** P53 Etappe 2b: Ticket-Check – so viele mit Zusage haben noch keins bzw. alle haben eins. */
  ticketsMissing: (n: number) => string;
  ticketsComplete: string;
  /** P46: Antwortfrist, solange sie läuft. */
  answerBy: (when: string) => string;
  /** Mit Zusagen über den Link (W10): Freunde ohne Konto antworten direkt. */
  answer: string;
  /** Sonst: Der Link führt Mitglieder zum Plan. */
  link: string;
};

/**
 * „Kartbahn, Samstag, 14. November, 20:00 Uhr – 5 dabei, 2 vielleicht, 3 haben noch nicht geantwortet. Noch 1 Zusage,
 * dann findet es statt. Antwort mit einem Tipp:“ – der Link folgt dahinter (Teilen-Menü bzw. Zwischenablage).
 */
export function standingText(tx: StandingTexts, s: Standing, title: string, when: string, guestsCanAnswer: boolean, answerBy?: string | null): string {
  const counts = [tx.going(s.going)];
  if (s.maybe > 0) counts.push(tx.maybe(s.maybe));
  if (s.waiting > 0) counts.push(tx.waiting(s.waiting));
  if (s.open > 0) counts.push(tx.open(s.open));
  const notes: string[] = [];
  if (s.quorumLeft != null) notes.push(s.quorumLeft > 0 ? tx.quorumLeft(s.quorumLeft) : tx.quorumReached);
  if (s.spotsLeft != null) notes.push(s.spotsLeft > 0 ? tx.spotsLeft(s.spotsLeft) : tx.full);
  if (s.ticketsMissing != null) notes.push(s.ticketsMissing > 0 ? tx.ticketsMissing(s.ticketsMissing) : tx.ticketsComplete);
  // P46: „Bitte bis Do., 12. Nov., 20:00 Uhr Bescheid sagen.“ – nur, solange die Frist läuft (formatiert von außen).
  if (answerBy) notes.push(tx.answerBy(answerBy));
  return [`${tx.head(title, when)} – ${counts.join(", ")}.`, ...notes, guestsCanAnswer ? tx.answer : tx.link].join(" ");
}
