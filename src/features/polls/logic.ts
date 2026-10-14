import type { Poll, PollGuest, PollGuestVote, PollOption, PollVote, VoteResponse } from "@/lib/types";

export interface PollWithDetails extends Poll {
  options: PollOption[];
  votes: PollVote[];
  /** W3: Gäste ohne Konto und ihre Antworten (fehlen in älteren Offline-Ständen). */
  guests?: PollGuest[];
  guest_votes?: PollGuestVote[];
}

/** Gäste stehen in den Listen der Antworten als „guest:<id>“ neben den Konto-IDs. */
export const GUEST_PREFIX = "guest:";
export const isGuestId = (id: string) => id.startsWith(GUEST_PREFIX);

export interface OptionTally {
  option: PollOption;
  yes: string[];
  maybe: string[];
  no: string[];
  /** Anteil der Zusagen an allen Mitgliedern und Gästen (0–1) – Breite des Balkens. */
  yesShare: number;
  mine: VoteResponse | null;
  leading: boolean;
}

export interface PollSummary {
  tallies: OptionTally[];
  /** Personen mit Konto, die mindestens eine Antwort gespeichert haben. */
  voterIds: string[];
  /** W3: Gäste ohne Konto, die mindestens eine Antwort gespeichert haben. */
  guestVoterCount: number;
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
 * Zahl der Zusagen ("Bin dabei") von Crew und Gästen (W3). Dieselbe Regel wendet die Datenbank beim Schließen an.
 */
export function summarizePoll(poll: PollWithDetails, memberIds: string[], userId: string, now: Date = new Date()): PollSummary {
  const guestVotes = poll.guest_votes ?? [];
  const guestVoterCount = new Set(guestVotes.map((v) => v.guest_id)).size;
  const memberCount = Math.max(memberIds.length + guestVoterCount, 1);
  const options = [...poll.options].sort((a, b) => a.position - b.position);
  const byOption = new Map<string, { user_id: string; response: VoteResponse }[]>();
  const all = [
    ...poll.votes.map((v) => ({ option: v.poll_option_id, user_id: v.user_id, response: v.response })),
    ...guestVotes.map((v) => ({ option: v.poll_option_id, user_id: GUEST_PREFIX + v.guest_id, response: v.response })),
  ];
  for (const vote of all) {
    const list = byOption.get(vote.option) ?? [];
    list.push(vote);
    byOption.set(vote.option, list);
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
    guestVoterCount,
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
