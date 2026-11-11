import type { pollExtend as dePollExtend } from "../de/pollExtend";

/** P39 · Extend a running poll. Loaded with the poll page. */
export const pollExtend = {
  title: "Extend the deadline",
  lead: "All votes stay. Anyone who hasn’t voted yet gets a heads-up.",
  presets: { hours2: "+2 hrs", day1: "+1 day", days3: "+3 days" },
  presetLabel: (preset: string, until: string) => `${preset} – until ${until}`,
  done: (until: string) => `Extended until ${until}.`,
  tooLate: "Can’t go longer – the poll has to end at least 30 minutes before the first date.",
  series: "Repeats every week – the deadline stays so the next rounds don’t shift.",
} satisfies typeof dePollExtend;
