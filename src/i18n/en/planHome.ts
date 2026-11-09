import type { planHome as dePlanHome } from "../de/planHome";

/** P31 · Home safe? – say “I'm home” after the night. */
export const planHome = {
  title: "Home safe?",
  lead: "One tap and the crew knows – no location, no message to everyone.",
  leadDone: (time: string) => `Glad you made it! The crew sees: home since ${time}.`,
  leadOthers: "Who's already home after the night:",
  action: "I'm home",
  saved: "Done – good night!",
  undo: "Not home yet after all",
  removed: "Check-in withdrawn.",
  listLabel: "Already home",
  person: (name: string, time: string) => `${name} · ${time}`,
  none: "Nobody has checked in yet.",
  missing: (n: number) => (n === 1 ? "1 person hasn't checked in yet" : `${n} people haven't checked in yet`),
  allHome: "Everyone's home.",
  honest: "Just a sign for the crew: the app doesn't notice if someone doesn't make it home. In an emergency call 112.",
  error: "Couldn't load “Home safe?” right now.",
  retry: "Try again",
} satisfies typeof dePlanHome;
