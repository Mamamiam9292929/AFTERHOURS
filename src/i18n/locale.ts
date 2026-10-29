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

/** Eigene Wahl auf diesem Gerät, falls es eine gibt (sonst null – auch bei gesperrtem Speicher). */
export function storedLocale(): string | null {
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

/**
 * P11 Etappe 2a · Sprache im Profil. Was beim Start nach der Anmeldung passiert:
 * - Das Konto kennt noch keine Sprache → die Sprache, die dieses Gerät gerade will, wird gespeichert („save“).
 * - Das Konto kennt eine, das Gerät hat keine eigene Wahl und will eine andere → das Gerät übernimmt sie
 *   („adopt“: merken und neu laden). Nach dem Neuladen ist sie die eigene Wahl – kein zweites Neuladen.
 * - Sonst nichts. Eine eigene Wahl auf dem Gerät bleibt; sie überschreibt das Konto nur, wenn jemand in den
 *   Einstellungen wechselt (sonst würden sich zwei Geräte mit verschiedener Wahl bei jedem Start abwechseln).
 */
export type LocaleSyncStep = { kind: "none" } | { kind: "save"; locale: Locale } | { kind: "adopt"; locale: Locale };

export function localeSyncStep(saved: unknown, stored: string | null | undefined, wanted: Locale): LocaleSyncStep {
  if (!isLocale(saved)) return { kind: "save", locale: isLocale(stored) ? stored : wanted };
  if (!isLocale(stored) && saved !== wanted) return { kind: "adopt", locale: saved };
  return { kind: "none" };
}
