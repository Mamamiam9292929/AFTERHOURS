import type { de, PageTexts } from ".";

/** F7 · Deutsche Seitentexte – je Bereich ein eigener Chunk, geladen erst mit der Seite. */
export const germanPageTexts: { [K in PageTexts]: () => Promise<(typeof de)[K]> } = {
  landing: () => import("./landing").then((m) => m.landing),
  rewards: () => import("./rewards").then((m) => m.rewards),
  privacy: () => import("./privacy").then((m) => m.privacy),
  admin: () => import("./admin").then((m) => m.admin),
  assistant: () => import("./assistant").then((m) => m.assistant),
  settings: () => import("./settings").then((m) => m.settings),
  planGuests: () => import("./planGuests").then((m) => m.planGuests),
  planQuorum: () => import("./planQuorum").then((m) => m.planQuorum),
  planCapacity: () => import("./planCapacity").then((m) => m.planCapacity),
  pollOutcome: () => import("./pollOutcome").then((m) => m.pollOutcome),
  planFeedback: () => import("./planFeedback").then((m) => m.planFeedback),
  planHome: () => import("./planHome").then((m) => m.planHome),
  notificationText: () => import("./notificationText").then((m) => m.notificationText),
};
