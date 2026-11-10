import { admin } from "./admin";
import { assistant } from "./assistant";
import { crewMute } from "./crewMute";
import { deCore } from "./core";
import { landing } from "./landing";
import { notificationText } from "./notificationText";
import { planCards } from "./planCards";
import { planFeedback } from "./planFeedback";
import { planHome } from "./planHome";
import { planGuests } from "./planGuests";
import { planCapacity } from "./planCapacity";
import { planQuorum } from "./planQuorum";
import { pollOutcome } from "./pollOutcome";
import { privacy } from "./privacy";
import { rewards } from "./rewards";
import { settings } from "./settings";

/**
 * Deutsches Wörterbuch, vollständig. Seine Struktur ist die Vorlage für jede weitere Sprache.
 * Die App importiert hiervon nur den Typ; zur Laufzeit lädt sie den Kern (`deCore`) sofort und die
 * Seitentexte (`PageTexts`) erst mit ihrer Seite. Die Unit-Tests prüfen das ganze Wörterbuch.
 */
export const de = {
  ...deCore,
  landing,
  rewards,
  privacy,
  admin,
  assistant,
  settings,
  planGuests,
  planQuorum,
  planCapacity,
  pollOutcome,
  planFeedback,
  planHome,
  planCards,
  notificationText,
  crewMute,
};

/** F7 · Bereiche, die nicht im Start-Bundle liegen, sondern mit ihrer Seite nachgeladen werden. */
export type PageTexts = Exclude<keyof typeof de, keyof typeof deCore>;
