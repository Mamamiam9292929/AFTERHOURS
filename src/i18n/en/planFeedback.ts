import type { planFeedback as dePlanFeedback } from "../de/planFeedback";

/** P29 · How was it? – a quick verdict after the night. */
export const planFeedback = {
  title: "How was it?",
  lead: "One tap for the crew – they only see the numbers, not who said what.",
  leadDone: "Thanks! The crew only sees the numbers.",
  leadOthers: "Here's what the people who went say.",
  leadClosed: "Here's how the people who went found it.",
  label: "How was the night?",
  again: "Again!",
  ok: "It was okay",
  meh: "Not really",
  saved: {
    again: "Noted – sounds like a repeat.",
    ok: "Noted.",
    meh: "Noted – next time will be better.",
  },
  removed: "Answer withdrawn.",
  undo: "Withdraw answer",
  tally: {
    again: (n: number) => `${n} × again`,
    ok: (n: number) => `${n} × okay`,
    meh: (n: number) => `${n} × not really`,
  },
  tallyLabel: "What the crew says",
  none: "Nobody has answered yet.",
  closedNote: "Answers were open for 30 days after the night.",
  error: "Couldn't load “How was it?” just now.",
  retry: "Try again",
  againPill: (n: number) => `${n} want a repeat`,
  favorites: {
    title: "Your favourite nights",
    count: (n: number) => `${n} × again`,
    open: (title: string, date: string, n: number) => `${title}, ${date} – ${n} × again. Open the night`,
    empty: "When most people say “Again!” after a night, it shows up here.",
    loading: "Loading favourite nights",
    failed: "Couldn't load your favourite nights just now.",
  },
} satisfies typeof dePlanFeedback;
