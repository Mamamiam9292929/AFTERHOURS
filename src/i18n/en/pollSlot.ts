import type { pollSlot as dePollSlot } from "../de/pollSlot";

/** P40 · Suggest another date in a running date poll. Loaded with the poll page. */
export const pollSlot = {
  open: "Suggest another date",
  title: "Which other date?",
  lead: "You’re in for it straight away. Anyone who has already voted gets a heads-up.",
  date: "Day",
  time: "Time",
  submit: "Suggest",
  done: (label: string) => `${label} is now up for a vote.`,
  full: "10 dates – a poll can’t hold more.",
  problems: {
    invalid: "Pick a day – at most a year ahead.",
    past: "That date has already passed.",
    duplicate: "That date is already in the poll.",
    full: "A poll can’t hold more than 10 dates.",
  },
} satisfies typeof dePollSlot;
