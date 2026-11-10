import type { crewMute as deCrewMute } from "../de/crewMute";

/** P35 · Mute a crew. */
export const crewMute = {
  title: "Notifications from this crew",
  lead: "Too noisy? Mute the crew – you stay in and still see everything in the app, your phone just stays quiet.",
  status: {
    on: "On",
    always: "Muted",
    until: (when: string) => `Muted until ${when}`,
  },
  choose: "Mute for",
  modes: {
    "8h": "8 hours",
    week: "1 week",
    always: "Until I change it",
  },
  unmute: "Unmute",
  saved: {
    "8h": "Muted for 8 hours.",
    week: "Muted for a week.",
    always: "Muted until you change it.",
    off: "The crew is unmuted.",
  },
  hint: "Applies to all your devices. Nobody in the crew can see that you muted it.",
  error: "Couldn't load this setting right now.",
} satisfies typeof deCrewMute;
