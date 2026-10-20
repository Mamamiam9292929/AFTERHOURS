/**
 * S4 · „Heute noch wer?“ – reine Logik für die Spontan-Frage (ohne React, per `node --test` geprüft).
 * Der Server entscheidet über Ablauf, Antworten und „Runde steht“; hier wird nur angezeigt.
 */

export type SpontaneousAnswerValue = "in" | "out";

export interface SpontaneousAnswer {
  ask_id: string;
  user_id: string;
  answer: SpontaneousAnswerValue;
  answered_at: string;
}

export interface SpontaneousAsk {
  id: string;
  crew_id: string;
  created_by: string;
  note: string | null;
  created_at: string;
  expires_at: string;
  closed_at: string | null;
  matched_at: string | null;
  answers: SpontaneousAnswer[];
}

/** Ab so vielen „Bock“ steht die Runde (gleich wie im Server, `answer_spontaneous`). */
export const SPONTANEOUS_MATCH = 3;

export function isAskOpen(ask: Pick<SpontaneousAsk, "closed_at" | "expires_at">, now: Date): boolean {
  return ask.closed_at === null && new Date(ask.expires_at).getTime() > now.getTime();
}

/** Laufende Fragen, die jüngste zuerst; je Crew höchstens eine (der Server lässt nur eine zu). */
export function openAsks<T extends Pick<SpontaneousAsk, "crew_id" | "closed_at" | "expires_at" | "created_at">>(asks: readonly T[], now: Date): T[] {
  const seen = new Set<string>();
  return [...asks]
    .filter((ask) => isAskOpen(ask, now))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .filter((ask) => (seen.has(ask.crew_id) ? false : (seen.add(ask.crew_id), true)));
}

/** Restzeit in ganzen Minuten (aufgerundet, nie negativ). */
export function minutesLeft(ask: Pick<SpontaneousAsk, "expires_at">, now: Date): number {
  return Math.max(0, Math.ceil((new Date(ask.expires_at).getTime() - now.getTime()) / 60_000));
}

/** „1:34 h“ bzw. „12 min“ – kurz genug für eine Pille. */
export function formatLeft(minutes: number): string {
  if (minutes >= 60) return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")} h`;
  return `${minutes} min`;
}

export interface AskSummary {
  inIds: string[];
  outIds: string[];
  mine: SpontaneousAnswerValue | null;
  matched: boolean;
  /** Wie viele „Bock“ noch fehlen, bis die Runde steht (0, wenn sie steht). */
  missing: number;
}

/**
 * Zusagen zuerst in der Reihenfolge, in der sie kamen. Wer die Crew verlassen hat, zählt nicht mehr mit
 * (`memberIds`), genau wie in der Benachrichtigung des Servers.
 */
export function summarizeAsk(ask: Pick<SpontaneousAsk, "answers" | "matched_at">, userId: string, memberIds?: readonly string[]): AskSummary {
  const members = memberIds ? new Set(memberIds) : null;
  const answers = [...ask.answers]
    .filter((a) => !members || members.has(a.user_id))
    .sort((a, b) => a.answered_at.localeCompare(b.answered_at) || a.user_id.localeCompare(b.user_id));
  const inIds = answers.filter((a) => a.answer === "in").map((a) => a.user_id);
  const outIds = answers.filter((a) => a.answer === "out").map((a) => a.user_id);
  const mine = ask.answers.find((a) => a.user_id === userId)?.answer ?? null;
  const matched = ask.matched_at !== null || inIds.length >= SPONTANEOUS_MATCH;
  return { inIds, outIds, mine, matched, missing: matched ? 0 : SPONTANEOUS_MATCH - inIds.length };
}

/** Crews, in denen gerade keine Frage läuft – nur dort lässt sich neu fragen. */
export function crewsFreeToAsk<C extends { id: string }>(crews: readonly C[], asks: readonly Pick<SpontaneousAsk, "crew_id" | "closed_at" | "expires_at">[], now: Date): C[] {
  const busy = new Set(asks.filter((ask) => isAskOpen(ask, now)).map((ask) => ask.crew_id));
  return crews.filter((crew) => !busy.has(crew.id));
}
