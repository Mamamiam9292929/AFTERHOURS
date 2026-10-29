import { useEffect, useRef } from "react";
import { localeSyncStep, readLocale, storedLocale, storeLocale } from "@/i18n/locale";
import { saveMyLocale, useSettings } from "./api";

/**
 * P11 Etappe 2a · Sprache im Profil abgleichen – einmal je Anmeldung, unsichtbar.
 * Kennt das Konto noch keine Sprache, speichert die App die des Geräts. Kennt es eine und hat dieses Gerät
 * keine eigene Wahl, übernimmt das Gerät sie (merken, einmal neu laden). Regeln: `localeSyncStep`.
 * Scheitert das Speichern (offline, Rate Limit), versucht es der nächste Start wieder.
 */
export function LocaleSync() {
  const settings = useSettings();
  const done = useRef(false);
  const saved = settings.data?.locale;
  const loaded = Boolean(settings.data);

  useEffect(() => {
    if (!loaded || done.current) return;
    done.current = true;
    const step = localeSyncStep(saved, storedLocale(), readLocale());
    if (step.kind === "save") void saveMyLocale(step.locale).catch(() => undefined);
    // Nur neu laden, wenn das Merken geklappt hat – sonst stünde das Gerät nach dem Neuladen wieder hier.
    if (step.kind === "adopt" && storeLocale(step.locale)) window.location.reload();
  }, [loaded, saved]);

  return null;
}
