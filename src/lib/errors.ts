import { t } from "@/i18n";

interface ErrorLike {
  code?: string;
  message?: string;
  status?: number;
  name?: string;
  details?: string;
}

const LEGACY_AUTH_MESSAGES: Record<string, string> = {
  "Invalid login credentials": "invalid_credentials",
  "Email not confirmed": "email_not_confirmed",
  "User already registered": "user_already_exists",
  "New password should be different from the old password.": "same_password",
};

/**
 * Übersetzt Fehler aus Supabase (Auth, PostgREST, RPC) und dem Netzwerk in einen Satz, der sagt,
 * was passiert ist und was man tun kann. Technische Details landen nie in der Oberfläche.
 */
export function errorMessage(error: unknown): string {
  if (!error) return t.errors.generic;
  const e = error as ErrorLike;
  const known = t.errors.codes as Record<string, string>;

  if (e.name === "AuthRetryableFetchError" || (error instanceof TypeError && /fetch|network/i.test(error.message))) {
    return t.errors.network;
  }
  if (typeof e.message === "string" && /failed to fetch|networkerror|load failed/i.test(e.message)) {
    return t.errors.network;
  }
  // RPC-Fehler: P0001 mit maschinenlesbarem Schlüssel als message.
  if (e.code === "P0001" && e.message && known[e.message]) return known[e.message] as string;
  if (e.code === "42501" || e.message === "forbidden") return t.errors.forbidden;
  if (e.code === "23514" || e.code === "22P02" || e.code === "22007" || e.code === "22008" || e.code === "23502") return t.errors.invalidInput;
  if (e.code === "23505") return t.errors.conflict;
  if (e.code === "PGRST116") return t.errors.notFound;
  // Supabase Auth liefert sprechende Codes.
  if (e.code && known[e.code]) return known[e.code] as string;
  // Rückfall für Auth-Antworten ohne Code (ältere Auth-Versionen oder Proxys, die den Versions-Header entfernen).
  const legacy = e.message ? LEGACY_AUTH_MESSAGES[e.message] : undefined;
  if (legacy && known[legacy]) return known[legacy] as string;
  if (e.status === 429) return known.rate_limited ?? t.errors.generic;
  if (e.status === 401) return t.errors.sessionExpired;
  return t.errors.generic;
}
