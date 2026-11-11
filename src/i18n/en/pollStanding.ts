import type { pollStanding as dePollStanding } from "../de/pollStanding";

/** P38 · Poll standing for the group chat – numbers only, no names. Loaded with the poll page. */
export const pollStanding = {
  button: "Share standing",
  hint: "Numbers only, no names – with a link to vote.",
  option: (label: string, yes: number) => `${label}: ${yes === 0 ? "nobody in yet" : `${yes} in`}`,
  more: (n: number, date: boolean) =>
    date ? (n === 1 ? "and 1 more date" : `and ${n} more dates`) : n === 1 ? "and 1 more option" : `and ${n} more options`,
  noVotes: "no votes yet",
  open: (n: number) => (n === 1 ? "1 hasn’t voted yet." : `${n} haven’t voted yet.`),
  allVoted: "Everyone in the crew has voted.",
  until: (when: string) => `Open until ${when}.`,
  vote: "Vote with one tap:",
  link: "To the poll:",
} satisfies typeof dePollStanding;
