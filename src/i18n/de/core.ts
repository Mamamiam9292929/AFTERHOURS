import { auth } from "./auth";
import { common, errors, validation } from "./common";
import { crews } from "./crews";
import { discover } from "./discover";
import { enums } from "./enums";
import { home, onboarding } from "./home";
import { notifications, profile } from "./misc";
import { plans } from "./plans";
import { polls } from "./polls";

/**
 * F7 · Deutscher Kern: alles, was gleich beim Start gebraucht wird (Navigation, Home, Crews, Abstimmungen,
 * Pläne, Fehlertexte …). Die Texte einzelner Seiten (Startseite, Datenschutz, Punkte, Admin, Assistent, Einstellungen) liegen
 * in eigenen Dateien und kommen erst mit ihrer Seite – siehe `loadTexts` in src/i18n/index.ts.
 */
export const deCore = {
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
  profile,
};
