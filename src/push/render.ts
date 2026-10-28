/**
 * P4 · Texte für Push-Mitteilungen im Service Worker.
 *
 * Wird beim Build als eigenes Skript `/push-texts.js` gebaut (IIFE, siehe vite.config.ts) und von
 * `public/sw.js` per `importScripts` geladen. So zeigt die Mitteilung auf dem Sperrbildschirm genau den
 * Text, den die App in der Liste zeigt – aus denselben Wörterbüchern (`src/i18n`), ohne zweite Quelle.
 */
import { t } from "@/i18n";
import { pushView } from "@/lib/pushview";

const texts = t.notifications.text as Record<string, (actor: string, payload: Record<string, unknown>) => { title: string; body?: string }>;

export function render(message: unknown) {
  return pushView(message, (type) => (Object.prototype.hasOwnProperty.call(texts, type) ? texts[type] : undefined), {
    fallbackTitle: t.notifications.push.fallbackTitle,
    fallbackBody: t.notifications.push.fallbackBody,
    someone: t.notifications.someone,
  });
}
