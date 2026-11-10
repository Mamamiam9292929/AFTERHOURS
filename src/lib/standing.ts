/**
 * P37 · „Zwischenstand“ für den Gruppenchat. Reine Rechen- und Textregeln: wie viele sind dabei, vielleicht, auf der
 * Nachrückliste, ohne Antwort – nur Zahlen, nie Namen (wie W8). Die Texte kommen von außen (`t.planCards.standing`),
 * damit die Regeln ohne i18n-Laufzeit testbar bleiben.
 */

type Answer = { attendance_status: string; waitlisted_at?: string | null };

export type StandingPlan = {
  status: string;
  starts_at: string;
  min_going?: number | null;
  max_going?: number | null;
  guests_allowed?: boolean;
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
  const going = all.filter(({ a }) => a.attendance_status === "going").length;
  const waiting = all.filter(({ a, guest }) => waits(a, guest)).length;
  const maybe = all.filter(({ a, guest }) => a.attendance_status === "maybe" && !waits(a, guest)).length;
  const open = plan.participants.filter((a) => a.attendance_status === "invited").length;
  // Gleiche Regeln wie `quorumLeft` (P25) und `spotsLeft` (P26) – hier ohne Laufzeit-Import, damit Node den Test
  // ohne Bundler laden kann; der Unit-Test prüft, dass beide übereinstimmen.
  const left = (limit: number | null | undefined) => (limit == null || limit < 1 ? null : Math.max(limit - going, 0));
  return { going, maybe, waiting, open, quorumLeft: left(plan.min_going), spotsLeft: left(plan.max_going) };
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
  /** Mit Zusagen über den Link (W10): Freunde ohne Konto antworten direkt. */
  answer: string;
  /** Sonst: Der Link führt Mitglieder zum Plan. */
  link: string;
};

/**
 * „Kartbahn, Samstag, 14. November, 20:00 Uhr – 5 dabei, 2 vielleicht, 3 haben noch nicht geantwortet. Noch 1 Zusage,
 * dann findet es statt. Antwort mit einem Tipp:“ – der Link folgt dahinter (Teilen-Menü bzw. Zwischenablage).
 */
export function standingText(tx: StandingTexts, s: Standing, title: string, when: string, guestsCanAnswer: boolean): string {
  const counts = [tx.going(s.going)];
  if (s.maybe > 0) counts.push(tx.maybe(s.maybe));
  if (s.waiting > 0) counts.push(tx.waiting(s.waiting));
  if (s.open > 0) counts.push(tx.open(s.open));
  const notes: string[] = [];
  if (s.quorumLeft != null) notes.push(s.quorumLeft > 0 ? tx.quorumLeft(s.quorumLeft) : tx.quorumReached);
  if (s.spotsLeft != null) notes.push(s.spotsLeft > 0 ? tx.spotsLeft(s.spotsLeft) : tx.full);
  return [`${tx.head(title, when)} – ${counts.join(", ")}.`, ...notes, guestsCanAnswer ? tx.answer : tx.link].join(" ");
}
