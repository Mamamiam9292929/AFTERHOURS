import { Navigate, useLocation } from "react-router-dom";
import { sharedSentenceFromSearch } from "@/lib/sharetarget";

/** Übergabe an Home: Text für die Ein-Satz-Abstimmung, die sich dort sofort öffnet (S3). */
export interface QuickPollHandoff {
  quickPollText: string;
}

export function isQuickPollHandoff(state: unknown): state is QuickPollHandoff {
  return typeof state === "object" && state !== null && typeof (state as QuickPollHandoff).quickPollText === "string";
}

/**
 * S3 · Teilen-Ziel (`share_target` im Manifest): Das Teilen-Menü des Handys öffnet `/share-target?text=…`.
 * Der Text wird bereinigt (`src/lib/sharetarget.ts`) und im Verlaufseintrag an Home übergeben – nicht in der
 * Adresse, damit er nach dem Start der Abstimmung nicht beim Neuladen zurückkommt. Ohne Anmeldung merkt sich
 * `RequireAuth` die Adresse und kommt danach hierher zurück.
 */
export function ShareTargetPage() {
  const location = useLocation();
  const state: QuickPollHandoff = { quickPollText: sharedSentenceFromSearch(location.search) };
  return <Navigate to="/home" replace state={state} />;
}
