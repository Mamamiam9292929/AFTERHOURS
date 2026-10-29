/**
 * Textsystem. Alle sichtbaren Texte liegen in Wörterbüchern unter src/i18n/<sprache>/.
 * Deutsch ist Standard und Vorlage; Englisch (P11) prüft seine Struktur mit `satisfies` gegen Deutsch.
 * Welche Sprache gilt, entscheidet `src/i18n/locale.ts` (eigene Wahl → Browser-Sprache → Deutsch).
 *
 * Das englische Wörterbuch wird nur bei Bedarf geladen – per Top-Level-Await, bevor irgendein Modul,
 * das `t` nutzt, ausgewertet wird. Deutsche Nutzer laden nichts zusätzlich. Scheitert das Nachladen
 * (z. B. offline ohne gespeicherte Dateien), bleibt die Oberfläche deutsch statt leer.
 * Datums-, Zahlen- und Währungsformate liegen in src/lib/time.ts und src/lib/format.ts.
 */
import { de } from "./de";
import { loadEnglish } from "./en";
import { intlLocale, readLocale, type Locale } from "./locale";

export type Messages = typeof de;
export type { Locale };

async function loadMessages(wanted: Locale): Promise<{ locale: Locale; messages: Messages }> {
  if (wanted === "en") {
    try {
      return { locale: "en", messages: await loadEnglish() };
    } catch {
      // Rückfall auf Deutsch – lieber die Standardsprache als eine kaputte Seite.
    }
  }
  return { locale: "de", messages: de };
}

const loaded = await loadMessages(readLocale());

export const locale: Locale = loaded.locale;
export const t: Messages = loaded.messages;

if (typeof document !== "undefined") document.documentElement.lang = intlLocale(locale).slice(0, 2);
