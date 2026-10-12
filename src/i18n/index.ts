/**
 * Textsystem. Alle sichtbaren Texte liegen in Wörterbüchern unter src/i18n/<sprache>/.
 * Standardsprache ist Deutsch. Eine weitere Sprache hinzufügen:
 *   1. src/i18n/en/index.ts anlegen und mit `satisfies Messages` gegen die deutsche Struktur prüfen,
 *   2. unten in `dictionaries` eintragen,
 *   3. `resolveLocale()` um die gewünschte Auswahl (Browser-Sprache, Profil-Einstellung) erweitern.
 * Datums-, Zahlen- und Währungsformate liegen getrennt in src/lib/time.ts und src/lib/format.ts.
 */
import { de } from "./de";

export type Messages = typeof de;
export type Locale = "de";

const dictionaries: Record<Locale, Messages> = { de };

function resolveLocale(): Locale {
  return "de";
}

export const locale: Locale = resolveLocale();
export const t: Messages = dictionaries[locale];
