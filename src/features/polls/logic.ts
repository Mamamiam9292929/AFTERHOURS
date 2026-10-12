import type { Poll, PollOption, PollVote, VoteResponse } from "@/lib/types";

export interface PollWithDetails extends Poll {
  options: PollOption[];
  votes: PollVote[];
}

export interface OptionTally {
  option: PollOption;
  yes: string[];
  maybe: string[];
  no: string[];
  /** Anteil der Zusagen an allen Mitgliedern (0–1) – Breite des Balkens. */
  yesShare: number;
  mine: VoteResponse | null;
  leading: boolean;
}

export interface PollSummary {
  tallies: OptionTally[];
  /** Personen, die mindestens eine Antwort gespeichert haben. */
  voterIds: string[];
  memberCount: number;
  participation: number;
  /** Optionen mit den meisten Zusagen; leer, wenn noch niemand zugesagt hat. */
  leadingOptionIds: string[];
  isTie: boolean;
  maxYes: number;
  iHaveVoted: boolean;
  /** Fristablauf oder beendet. */
  isOver: boolean;
  missingForMinimum: number | null;
}

/** Abstimmung gilt als vorbei, sobald sie geschlossen ist ODER ihre Frist abgelaufen ist. */
export function isPollOver(poll: Pick<Poll, "status" | "ends_at">, now: Date = new Date()): boolean {
  return poll.status === "closed" || new Date(poll.ends_at) <= now;
}

/**
 * Wertet eine Abstimmung aus. Gezählt werden ausschließlich gespeicherte Antworten; es zählt die
 * Zahl der Zusagen ("Bin dabei"). Dieselbe Regel wendet die Datenbank beim Schließen an.
 */
export function summarizePoll(poll: PollWithDetails, memberIds: string[], userId: string, now: Date = new Date()): PollSummary {
  const memberCount = Math.max(memberIds.length, 1);
  const options = [...poll.options].sort((a, b) => a.position - b.position);
  const byOption = new Map<string, PollVote[]>();
  for (const vote of poll.votes) {
    const list = byOption.get(vote.poll_option_id) ?? [];
    list.push(vote);
    byOption.set(vote.poll_option_id, list);
  }

  const raw = options.map((option) => {
    const votes = byOption.get(option.id) ?? [];
    const pick = (response: VoteResponse) => votes.filter((v) => v.response === response).map((v) => v.user_id);
    return { option, yes: pick("yes"), maybe: pick("maybe"), no: pick("no"), mine: votes.find((v) => v.user_id === userId)?.response ?? null };
  });

  const maxYes = raw.reduce((max, r) => Math.max(max, r.yes.length), 0);
  const leadingOptionIds = maxYes > 0 ? raw.filter((r) => r.yes.length === maxYes).map((r) => r.option.id) : [];
  const voterIds = [...new Set(poll.votes.map((v) => v.user_id))];

  return {
    tallies: raw.map((r) => ({ ...r, yesShare: r.yes.length / memberCount, leading: leadingOptionIds.includes(r.option.id) })),
    voterIds,
    memberCount: memberIds.length,
    participation: Math.min(1, voterIds.filter((id) => memberIds.includes(id)).length / memberCount),
    leadingOptionIds,
    isTie: leadingOptionIds.length > 1,
    maxYes,
    iHaveVoted: voterIds.includes(userId),
    isOver: isPollOver(poll, now),
    missingForMinimum: poll.min_participants != null && maxYes < poll.min_participants ? poll.min_participants - maxYes : null,
  };
}
