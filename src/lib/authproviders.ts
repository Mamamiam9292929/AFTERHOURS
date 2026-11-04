/**
 * P12 · Anmeldung mit Google und Apple – reine Hilfen ohne React und ohne Supabase-Client (Unit-Test:
 * tests/unit/authproviders.test.mjs).
 *
 * Ob ein Anbieter angeboten wird, entscheidet allein das Supabase-Projekt: Die App liest die öffentlichen
 * Auth-Einstellungen (`/auth/v1/settings` → `external.google`, `external.apple`). Solange Benito die
 * Anbieter nicht eingeschaltet hat, erscheinen keine Knöpfe – es gibt keinen Knopf, der ins Leere führt.
 */
export const OAUTH_PROVIDERS = ["google", "apple"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

/** Eingeschaltete Anbieter in fester Reihenfolge; alles Unerwartete zählt als „aus“. */
export function enabledProviders(settings: unknown): OAuthProvider[] {
  if (!settings || typeof settings !== "object") return [];
  const external = (settings as { external?: unknown }).external;
  if (!external || typeof external !== "object") return [];
  return OAUTH_PROVIDERS.filter((provider) => (external as Record<string, unknown>)[provider] === true);
}

/**
 * Konten, die über Google oder Apple entstanden sind, haben das Registrierungsformular mit der
 * Altersbestätigung nie gesehen – das Onboarding fragt sie deshalb nach.
 */
export function needsAgeConfirmation(appMetadata: unknown): boolean {
  if (!appMetadata || typeof appMetadata !== "object") return false;
  const provider = (appMetadata as { provider?: unknown }).provider;
  return typeof provider === "string" && (OAUTH_PROVIDERS as readonly string[]).includes(provider);
}

/** Zurück vom Anbieter mit Fehler (abgebrochen, abgelehnt, Anbieter nicht eingerichtet)? */
export function oauthReturnFailed(search: string, hash: string): boolean {
  return /(^|[?&#])error(_code|_description)?=/.test(search) || /(^|[?&#])error(_code|_description)?=/.test(hash);
}
