/**
 * S3 · Teilen-Ziel: Wer in WhatsApp & Co. eine Nachricht mit AFTERHOURS teilt, landet mit dem Text in der
 * Ein-Satz-Abstimmung (S1). Das Betriebssystem ruft dafür `/share-target?title=…&text=…&url=…` auf
 * (`share_target` im Manifest). Hier wird daraus ein Satz für das Eingabefeld:
 *
 * - Kopf einer weitergeleiteten Chat-Nachricht fällt weg („[19.10.26, 21:04] Carol: …“, „19.10.26, 21:04 - Carol: …“),
 *   damit weder Namen noch Uhrzeit des Chats als Vorschlag auftauchen.
 * - Links fallen weg (Messenger hängen sie gern an; ein Link ist kein Vorschlag).
 * - Mehrere Zeilen werden zu einem Satz, Anführungszeichen außen weg, höchstens 200 Zeichen (wie das Feld).
 *
 * Nichts davon wird gespeichert oder verschickt: Der Satz steht nur im Feld, die Vorschau zeigt alles,
 * bevor jemand „Los“ tippt. Keine Importe aus `@/`, damit `tests/unit/sharetarget.test.mjs` die Datei direkt lädt.
 */

export const MAX_SENTENCE = 200;

export interface SharedInput {
  title?: string | null;
  text?: string | null;
  url?: string | null;
}

// [19.10.26, 21:04] Name: … (iOS-Export) bzw. 19.10.26, 21:04 - Name: … (Android-Export), auch mit vierstelligem Jahr und Sekunden.
const CHAT_HEAD = /^\s*\[?\d{1,2}\.\d{1,2}\.\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\]?\s*(?:-\s*)?[^:\n]{1,40}:\s+/;
const LINK = /\b(?:https?:\/\/|www\.)\S+/gi;
const QUOTES = /^[\s"'„“”‚‘’«»]+|[\s"'„“”‚‘’«»]+$/g;

function clean(line: string): string {
  return line.replace(CHAT_HEAD, "").replace(LINK, " ").replace(/\s+/g, " ").replace(QUOTES, "").trim();
}

/** Kürzt auf höchstens `max` Zeichen, möglichst an einer Wortgrenze, ohne Satzzeichen am Ende. */
function cut(sentence: string, max: number): string {
  if (sentence.length <= max) return sentence;
  const head = sentence.slice(0, max);
  const space = head.lastIndexOf(" ");
  return (space > max * 0.6 ? head.slice(0, space) : head).replace(/[\s,;:–-]+$/, "");
}

/** Macht aus dem, was das Teilen-Menü liefert, einen Satz für die Ein-Satz-Abstimmung (leer, wenn nichts übrig bleibt). */
export function sharedSentence(input: SharedInput, max = MAX_SENTENCE): string {
  const source = [input.text, input.title].map((s) => (typeof s === "string" ? s : "")).find((s) => clean(s) !== "") ?? "";
  const lines = source
    .split(/\r?\n/)
    .map(clean)
    .filter((l) => l !== "");
  const sentence = lines
    .map((l, i) => (i < lines.length - 1 && !/[,.;!?]$/.test(l) ? `${l},` : l))
    .join(" ");
  return cut(sentence, max);
}

/** Liest die Parameter aus der Adresse des Teilen-Ziels. */
export function sharedSentenceFromSearch(search: string, max = MAX_SENTENCE): string {
  const params = new URLSearchParams(search);
  return sharedSentence({ title: params.get("title"), text: params.get("text"), url: params.get("url") }, max);
}
