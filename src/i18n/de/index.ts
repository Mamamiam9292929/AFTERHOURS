import { auth } from "./auth";
import { common, errors, validation } from "./common";
import { crews } from "./crews";
import { discover } from "./discover";
import { enums } from "./enums";
import { home, onboarding } from "./home";
import { admin, assistant, notifications, privacy, profile, rewards, settings } from "./misc";
import { plans } from "./plans";
import { polls } from "./polls";

/** Deutsches Wörterbuch. Seine Struktur ist die Vorlage für jede weitere Sprache. */
export const de = {
  ...common,
  validation,
  errors,
  enums,
  auth,
  home,
  onboarding,
  discover,
  crews,
  polls,
  plans,
  notifications,
  rewards,
  profile,
  settings,
  privacy,
  admin,
  assistant,
};
