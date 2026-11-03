/**
 * Textsystem. Alle sichtbaren Texte liegen in Wörterbüchern unter src/i18n/<sprache>/.
 * Deutsch ist Standard und Vorlage; Englisch (P11) prüft seine Struktur mit `satisfies` gegen Deutsch.
 * Welche Sprache gilt, entscheidet `src/i18n/locale.ts` (eigene Wahl → Browser-Sprache → Deutsch).
 *
 * Das englische Wörterbuch wird nur bei Bedarf geladen – per Top-Level-Await, bevor irgendein Modul,
 * das `t` nutzt, ausgewertet wird. Deutsche Nutzer laden nichts zusätzlich. Scheitert das Nachladen
 * (z. B. offline ohne gespeicherte Dateien), bleibt die Oberfläche deutsch statt leer.
 * F7 · Startet schlank: Sofort geladen wird nur der Kern (`deCore` bzw. `loadEnglish`). Die Texte einzelner
 * Seiten (`PageTexts`: Startseite, Punkte, Datenschutz, Admin, Assistent, Einstellungen) lädt `loadTexts` erst mit ihrer
 * Seite – der Router startet das parallel zum Seiten-Chunk, und jede dieser Seiten wartet am Modulanfang
 * per `await loadTexts(…)`, bevor sie `t.<bereich>` liest. `t` behält den vollen Typ; ein Bereich, der
 * noch nicht geladen ist, fehlt zur Laufzeit.
 * Datums-, Zahlen- und Währungsformate liegen in src/lib/time.ts und src/lib/format.ts.
 */
import type { de, PageTexts } from "./de";
import { deCore } from "./de/core";
import { germanPageTexts } from "./de/pages";
import { englishPageTexts, loadEnglish } from "./en";
import { intlLocale, readLocale, type Locale } from "./locale";

export type Messages = typeof de;
export type { Locale, PageTexts };

async function loadMessages(wanted: Locale): Promise<{ locale: Locale; messages: typeof deCore }> {
  if (wanted === "en") {
    try {
      return { locale: "en", messages: await loadEnglish() };
    } catch {
      // Rückfall auf Deutsch – lieber die Standardsprache als eine kaputte Seite.
    }
  }
  return { locale: "de", messages: deCore };
}

const loaded = await loadMessages(readLocale());

export const locale: Locale = loaded.locale;
/** Kopie des Kerns, damit nachgeladene Seitentexte nie das Modulobjekt `deCore` verändern. */
export const t = { ...loaded.messages } as Messages;

const pending = new Map<PageTexts, Promise<void>>();

async function fetchSection<K extends PageTexts>(name: K): Promise<Messages[K]> {
  if (locale === "en") {
    try {
      return await englishPageTexts[name]();
    } catch {
      // wie oben: dann eben Deutsch
    }
  }
  return germanPageTexts[name]();
}

/**
 * F7 · Seitentexte nachladen (einmal je Bereich, danach sofort erfüllt). Scheitert das Laden – etwa offline
 * ohne gespeicherte Datei –, wird der nächste Aufruf es erneut versuchen; die Seite zeigt dann wie bei einem
 * fehlenden Seiten-Chunk die Fehlerseite.
 */
export function loadTexts(...names: PageTexts[]): Promise<void> {
  return Promise.all(
    names.map((name) => {
      let job = pending.get(name);
      if (!job) {
        job = fetchSection(name).then(
          (texts) => {
            (t as Record<PageTexts, unknown>)[name] = texts;
          },
          (error: unknown) => {
            pending.delete(name);
            throw error;
          },
        );
        pending.set(name, job);
      }
      return job;
    }),
  ).then(() => undefined);
}

if (typeof document !== "undefined") document.documentElement.lang = intlLocale(locale).slice(0, 2);
