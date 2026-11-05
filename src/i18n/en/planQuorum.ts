import type { planQuorum as dePlanQuorum } from "../de/planQuorum";

export const planQuorum = {
  meter: {
    title: (min: number) => `On if ${min} are in`,
    reached: "It's on",
    missing: (n: number) => (n === 1 ? "1 more needed" : `${n} more needed`),
    count: (going: number, min: number) => `${going} of ${min} are in`,
    progress: (going: number, min: number) => `${going} of at least ${min} yeses`,
  },
  card: {
    title: "It's on if …",
    intro: "How many yeses make the night worth it? Everyone sees how many are still missing – once there are enough, the group gets a heads-up.",
    label: "Minimum number of yeses",
    none: "None",
    noneLabel: "No minimum",
    option: (n: number) => `From ${n} yeses`,
    saved: (n: number) => `On if ${n} are in – everyone can see how many are still missing.`,
    removed: "No minimum any more.",
    alreadyReached: "Already reached – it's on.",
  },
} satisfies typeof dePlanQuorum;
