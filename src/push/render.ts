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
import { pushView } from "@/lib/pushview";

// P11: Der Service Worker kennt kein localStorage – er folgt der Browser-Sprache. Beide Texte stehen fest im
// Skript (kein Nachladen, kein Top-Level-Await im IIFE-Build).
export const lang = readLocale();
const n = lang === "en" ? enNotifications : deNotifications;
const texts = n.text as Record<string, (actor: string, payload: Record<string, unknown>) => { title: string; body?: string }>;

export function render(message: unknown) {
  return pushView(message, (type) => (Object.prototype.hasOwnProperty.call(texts, type) ? texts[type] : undefined), {
    fallbackTitle: n.push.fallbackTitle,
    fallbackBody: n.push.fallbackBody,
    someone: n.someone,
  });
}
