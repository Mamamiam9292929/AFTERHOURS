/**
 * P11 Etappe 2e · Titel, die der Server selbst auf Deutsch vergibt, in der Sprache der Oberfläche.
 *
 * Startet eine Stichwahl von selbst (S5 Etappe 2, `app_private` in 20261020000000_poll_auto_runoff.sql), heißt sie
 * „Stichwahl: <Titel der Abstimmung>“ – auch in Benachrichtigungen und auf der Teilen-Karte. Auf Englisch zeigt
 * die App „Runoff: <Titel>“, wie bei einer von Hand gestarteten Stichwahl (`runoffDefaultTitle`). Nur genau
 * dieser Anfang wird ersetzt; der Rest des Titels bleibt, wie die Crew ihn geschrieben hat.
 *
 * Ohne Importe, damit Unit-Tests die Datei direkt laden können. `api/_lib/share-card.js` hat dieselbe Regel.
 */

type Locale = "de" | "en";

const GERMAN_RUNOFF = "Stichwahl: ";

export function localizedServerTitle(title: string, locale: Locale): string {
  if (locale === "de" || !title.startsWith(GERMAN_RUNOFF)) return title;
  return `Runoff: ${title.slice(GERMAN_RUNOFF.length)}`;
}
