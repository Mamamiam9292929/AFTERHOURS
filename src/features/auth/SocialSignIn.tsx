import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormMessage } from "@/components/ui/Field";
import { t } from "@/i18n";
import { enabledProviders, type OAuthProvider } from "@/lib/authproviders";
import { errorMessage } from "@/lib/errors";
import { qk } from "@/lib/query";
import { isSupabaseConfigured, siteUrl, supabase } from "@/lib/supabase";

/** Öffentliche Auth-Einstellungen des Projekts (`/auth/v1/settings`, nur mit anon-Key). */
async function fetchAuthSettings(signal: AbortSignal): Promise<unknown> {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!isSupabaseConfigured || !url || !anonKey) return null;
  const response = await fetch(`${url.replace(/\/+$/, "")}/auth/v1/settings`, { headers: { apikey: anonKey }, signal });
  if (!response.ok) throw new Error(`auth settings ${response.status}`);
  return response.json();
}

/**
 * P12 · „Weiter mit Google / Apple“ über dem E-Mail-Formular (Anmeldung, Registrierung, Einladungs-Landingpage).
 *
 * Die Knöpfe erscheinen nur, wenn das Supabase-Projekt den Anbieter eingeschaltet hat; solange die Abfrage
 * läuft oder scheitert, bleibt es beim E-Mail-Formular. Nach dem Anbieter geht es auf `/auth/confirm`, wo die
 * Sitzung übernommen und – wie nach der E-Mail-Bestätigung – zum gemerkten Ziel (z. B. Einladung)
 * weitergeleitet wird. Neue Konten bestätigen ihr Alter im Onboarding.
 */
export function SocialSignIn() {
  const providers = useQuery({
    queryKey: qk.authProviders,
    queryFn: async ({ signal }) => enabledProviders(await fetchAuthSettings(signal)),
    staleTime: 10 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const [busy, setBusy] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!providers.data?.length) return null;

  async function start(provider: OAuthProvider) {
    setError(null);
    setBusy(provider);
    const { error: apiError } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: `${siteUrl()}/auth/confirm?via=oauth` } });
    // Erfolg: Der Browser verlässt die Seite Richtung Anbieter.
    if (apiError) {
      setBusy(null);
      setError(errorMessage(apiError));
    }
  }

  return (
    <div className="mb-7 space-y-3" role="group" aria-label={t.auth.social.label} data-testid="social-sign-in">
      {providers.data.map((provider) => (
        <Button key={provider} variant="secondary" size="lg" block loading={busy === provider} disabled={busy !== null && busy !== provider} onClick={() => void start(provider)}>
          {t.auth.social[provider]}
        </Button>
      ))}
      {error && <FormMessage>{error}</FormMessage>}
      <p className="flex items-center gap-3 pt-2 text-[13px] text-faint" aria-hidden>
        <span className="h-px flex-1 bg-white/10" />
        {t.auth.social.or}
        <span className="h-px flex-1 bg-white/10" />
      </p>
    </div>
  );
}
