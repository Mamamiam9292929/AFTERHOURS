/**
 * P4 · Texte für Push-Mitteilungen im Service Worker.
 *
 * Wird beim Build als eigenes Skript `/push-texts.js` gebaut (IIFE, siehe vite.config.ts) und von
 * `public/sw.js` per `importScripts` geladen. So zeigt die Mitteilung auf dem Sperrbildschirm genau den
 * Text, den die App in der Liste zeigt – aus denselben Wörterbüchern (`src/i18n`), ohne zweite Quelle.
 */
import { notifications as deNotifications } from "@/i18n/de/misc";
import { notifications as enNotifications } from "@/i18n/en/misc";
import { readLocale } from "@/i18n/locale";
import { pushLocale, pushView } from "@/lib/pushview";

// P11: Der Service Worker kennt kein localStorage. Etappe 2a: Bringt der Push die Sprache aus dem Profil mit
// (`locale`), gilt sie; sonst die Browser-Sprache. Beide Texte stehen fest im Skript (kein Nachladen, kein
// Top-Level-Await im IIFE-Build).
export const lang = readLocale();
const DICTIONARIES = { de: deNotifications, en: enNotifications } as const;
type Texts = Record<string, (actor: string, payload: Record<string, unknown>) => { title: string; body?: string }>;

export function render(message: unknown) {
  const locale = pushLocale(message, lang);
  const n = DICTIONARIES[locale];
  const texts = n.text as Texts;
  const view = pushView(message, (type) => (Object.prototype.hasOwnProperty.call(texts, type) ? texts[type] : undefined), {
    fallbackTitle: n.push.fallbackTitle,
    fallbackBody: n.push.fallbackBody,
    someone: n.someone,
  });
  return { ...view, lang: locale };
}
