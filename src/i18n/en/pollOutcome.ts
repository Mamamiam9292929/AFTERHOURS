import type { pollOutcome as dePollOutcome } from "../de/pollOutcome";

/** P28 · What came of it – result on the poll link for guests. */
export const pollOutcome = {
  kicker: "Result",
  noWinner: "No option won – nobody said they were in.",
  planKicker: "It became a plan",
  planCancelled: "The plan has been cancelled.",
  toPlan: "Open the plan",
  planNoLink: "You'll get the link to the plan in the group chat.",
  noPlan: "No plan yet – the crew is settling time and place. Check back here later.",
  tie: "It's a tie – the crew decides in a runoff.",
  tieWaiting: "It's a tie. The crew decides what happens next.",
  runoffOpen: (when: string) => `Runoff open until ${when}`,
  runoffClosed: "The runoff is over.",
  toRunoff: "Vote in the runoff",
  runoffNoLink: "You'll get the link to the runoff in the group chat.",
  quick: {
    prompt: (winner: string) => `You were in for “${winner}”. Are you coming to the plan too?`,
    button: (name: string) => `I'm in – as ${name}`,
    privacy: "The crew sees your name and your answer. You can change it on the plan card.",
    going: (name: string) => `You're in, ${name}.`,
    maybe: (name: string) => `You answered “maybe”, ${name}.`,
    declined: (name: string) => `You said no, ${name}.`,
    full: "The plan is full right now. On the plan card you can join the waitlist.",
  },
} satisfies typeof dePollOutcome;
