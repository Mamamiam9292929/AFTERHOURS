/**
 * P11 · Sprache der Oberfläche. Ohne Importe, damit Unit-Tests, `src/lib/time.ts` und der Service Worker
 * (`push-texts.js`) die Datei laden können, ohne das Wörterbuch mitzuziehen.
 *
 * Reihenfolge: eigene Wahl auf diesem Gerät (Einstellungen bzw. Sprachlink auf der Startseite) → erste
 * Browser-Sprache, die Deutsch oder Englisch ist → Deutsch. Datum, Uhrzeit und Beträge bleiben in Berliner
 * Zeit und Euro; Englisch nutzt britische Schreibweise (24-Stunden-Uhr, „23 Oct“).
 */
export type Locale = "de" | "en";

export const LOCALES: readonly Locale[] = ["de", "en"];

/** Schlüssel im localStorage – gilt nur für dieses Gerät. */
export const LOCALE_KEY = "afterhours.locale";

const isLocale = (value: unknown): value is Locale => value === "de" || value === "en";

/** Reine Auswahl – getrennt von Browser-APIs, damit sie sich testen lässt. */
export function pickLocale(stored: string | null | undefined, languages: readonly string[] | undefined): Locale {
  if (isLocale(stored)) return stored;
  for (const language of languages ?? []) {
    const base = language.toLowerCase().split(/[-_]/)[0];
    if (isLocale(base)) return base;
  }
  return "de";
}

/** Sprache, die Intl für Datum, Zahl und Betrag nutzt. */
export function intlLocale(locale: Locale): string {
  return locale === "en" ? "en-GB" : "de-DE";
}

function storedLocale(): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(LOCALE_KEY);
  } catch {
    return null;
  }
}

/** Sprache dieses Geräts (im Browser und im Service Worker; dort ohne localStorage nur die Browser-Sprache). */
export function readLocale(): Locale {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  return pickLocale(storedLocale(), nav?.languages?.length ? nav.languages : nav?.language ? [nav.language] : []);
}

/** Wahl auf diesem Gerät merken. Gibt false zurück, wenn der Speicher gesperrt ist. */
export function storeLocale(locale: Locale): boolean {
  try {
    localStorage.setItem(LOCALE_KEY, locale);
    return true;
  } catch {
    return false;
  }
}

/** Name jeder Sprache in sich selbst – steht im Sprachwähler unabhängig von der aktuellen Sprache. */
export const LANGUAGE_NAMES: Record<Locale, string> = { de: "Deutsch", en: "English" };
