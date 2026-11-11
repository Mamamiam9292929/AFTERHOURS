/**
 * P38 · Zwischenstand der Abstimmung für den Gruppenchat (wie P37 beim Plan). Reine Rechen- und Textregeln:
 * Zusagen je Vorschlag (höchstens vier, die meisten zuerst), wie viele aus der Crew noch fehlen, bis wann es läuft –
 * nur Zahlen, nie Namen. Die Texte kommen von außen (`t.pollStanding`), damit der Unit-Test ohne i18n-Laufzeit läuft.
 */

/** Höchstens so viele Vorschläge stehen im Text, der Rest als „und 2 weitere“. */
export const POLL_STANDING_MAX_OPTIONS = 4;

export type PollStandingInput = {
  status: string;
  ends_at: string;
  /** Vorschläge in der Reihenfolge der Abstimmung; `label` ist bei Termin-Abstimmungen das Datum. */
  options: { label: string; yes: number }[];
  /** Mitglieder und Gäste, die mindestens eine Antwort gegeben haben. */
  voters: number;
  /** Mitglieder ohne Antwort. */
  open: number;
};

export type PollStanding = {
  /** Die führenden Vorschläge (meiste Zusagen zuerst, bei Gleichstand in der Reihenfolge der Abstimmung). */
  options: { label: string; yes: number }[];
  /** Vorschläge, die nicht mehr in den Text passen. */
  more: number;
  voters: number;
  open: number;
};

/** Stand einer laufenden Abstimmung – `null` nach dem Ende (dafür gibt es „Ergebnis teilen“, P28). */
export function pollStanding(poll: PollStandingInput, now: Date = new Date()): PollStanding | null {
  if (poll.status !== "open") return null;
  if (new Date(poll.ends_at).getTime() <= now.getTime()) return null;
  const ranked = poll.options.map((o, i) => ({ ...o, i })).sort((a, b) => b.yes - a.yes || a.i - b.i);
  const shown = ranked.slice(0, POLL_STANDING_MAX_OPTIONS).map(({ label, yes }) => ({ label, yes }));
  return { options: shown, more: ranked.length - shown.length, voters: Math.max(poll.voters, 0), open: Math.max(poll.open, 0) };
}

export type PollStandingTexts = {
  option: (label: string, yes: number) => string;
  more: (n: number, date: boolean) => string;
  noVotes: string;
  open: (n: number) => string;
  allVoted: string;
  until: (when: string) => string;
  /** Mit Gäste-Stimmen (W3): Freunde ohne Konto stimmen über den Link direkt ab. */
  vote: string;
  /** Sonst: Der Link führt Mitglieder zur Abstimmung. */
  link: string;
};

/**
 * „Bowling oder Kino? – Bowling: 4 dabei · Kino: 2 dabei. 3 haben noch nicht abgestimmt. Läuft bis Fr., 13.11.,
 * 18:00. Stimm mit einem Tipp ab:“ – der Link folgt dahinter (Teilen-Menü bzw. Zwischenablage).
 */
export function pollStandingText(tx: PollStandingTexts, s: PollStanding, title: string, until: string, date: boolean, guestsCanVote: boolean): string {
  const parts = s.voters === 0 ? [tx.noVotes] : s.options.map((o) => tx.option(o.label, o.yes));
  if (s.voters > 0 && s.more > 0) parts.push(tx.more(s.more, date));
  return [`${title} – ${parts.join(" · ")}.`, s.open > 0 ? tx.open(s.open) : tx.allVoted, tx.until(until), guestsCanVote ? tx.vote : tx.link].join(" ");
}
