import { useState } from "react";
import { IconGlobe } from "@/components/icons";
import { useAuth } from "@/features/auth/AuthProvider";
import { saveMyLocale } from "@/features/profile/api";
import { locale, t } from "@/i18n";
import { LANGUAGE_NAMES, LOCALES, storeLocale, type Locale } from "@/i18n/locale";
import { cn } from "@/lib/cn";
import { Chip } from "./Controls";

/**
 * P11 · Sprache wechseln. Die Wahl gilt für dieses Gerät (localStorage) und braucht ein Neuladen, weil
 * Wörterbuch und Datumsformate beim Start feststehen. Ohne Speicher (privates Fenster) bleibt es bei der
 * Browser-Sprache – dann passiert beim Antippen nichts Falsches, nur nichts Dauerhaftes.
 *
 * Etappe 2a: Angemeldet speichert die App die Wahl vorher im Profil (`persist`) – für Kalender-Abo, Push und
 * neue Geräte. Höchstens 4 Sekunden; scheitert es, wechselt das Gerät trotzdem (der Server bleibt beim Alten).
 */
export async function switchLocale(next: Locale, persist?: (locale: Locale) => Promise<void>) {
  if (next === locale) return;
  storeLocale(next);
  if (persist) {
    await Promise.race([persist(next).catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 4000))]);
  }
  window.location.reload();
}

/** Sprachnamen in ihrer eigenen Sprache – wer die aktuelle Sprache nicht liest, findet seine trotzdem. */
export function LanguageChips({ className }: { className?: string }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const choose = (option: Locale) => {
    if (busy || option === locale) return;
    setBusy(true);
    void switchLocale(option, user ? saveMyLocale : undefined);
  };
  return (
    <div role="group" aria-label={t.settings.language.label} aria-busy={busy || undefined} className={cn("flex flex-wrap gap-2", className)} data-testid="language-chips">
      {LOCALES.map((option) => (
        <Chip key={option} selected={option === locale} onToggle={() => choose(option)}>
          <span lang={option}>{LANGUAGE_NAMES[option]}</span>
        </Chip>
      ))}
    </div>
  );
}

/** Kleiner Link für Seiten ohne Konto (Startseite): wechselt zur jeweils anderen Sprache. */
export function LanguageLink({ className }: { className?: string }) {
  const other: Locale = locale === "de" ? "en" : "de";
  return (
    <button type="button" onClick={() => void switchLocale(other)} lang={other} data-testid="language-link" className={cn("inline-flex items-center gap-1.5", className)}>
      <IconGlobe className="size-4" aria-hidden />
      {LANGUAGE_NAMES[other]}
    </button>
  );
}
