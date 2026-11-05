import type { planCapacity as dePlanCapacity } from "../de/planCapacity";

export const planCapacity = {
  meter: {
    title: (max: number) => `${max} spots max`,
    full: "Full",
    left: (n: number) => (n === 1 ? "1 spot left" : `${n} spots left`),
    count: (going: number, max: number) => `${going} of ${max} spots taken`,
    progress: (going: number, max: number) => `${going} of at most ${max} spots taken`,
    waitlistTitle: (n: number) => `Waiting list (${n})`,
    waitlistHint: "If someone drops out, the first person moves up automatically.",
  },
  mine: {
    position: (n: number) => (n === 1 ? "You're next in line" : `You're number ${n} on the waiting list`),
    positionBody: "If a spot opens up, you're in automatically and get a heads-up.",
    full: (max: number) => `All ${max} spots are taken.`,
    fullBody: "Tap “Waitlist” – if someone drops out, you're in automatically.",
    leave: "Leave the list",
    left: "You're no longer on the waiting list.",
  },
  card: {
    title: "At most …",
    intro: "How many fit – one table, one lane, one car? Once it's full, further yeses go on the waiting list and move up automatically.",
    label: "Maximum number of yeses",
    none: "Open",
    noneLabel: "No maximum",
    option: (n: number) => `At most ${n} yeses`,
    saved: (n: number) => `At most ${n} – once it's full, people go on the waiting list.`,
    removed: "No maximum any more – everyone on the list is now in.",
    floor: "Can't go lower: that many are already in (or that's the minimum).",
  },
} satisfies typeof dePlanCapacity;
