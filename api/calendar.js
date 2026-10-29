// P2 Etappe 2 · Kalender-Abo (Vercel Function, Node-Laufzeit).
// vercel.json leitet /c/<token>.ics hierher. Kalender-Apps (Apple, Google, Outlook …) rufen den Link
// regelmäßig ab und bekommen die Pläne der Person als iCalendar.
//
// Daten holt die Funktion wie ein Besucher ohne Konto: mit dem öffentlichen anon-Key über die
// Datenbankfunktion calendar_feed_events. Kein Secret, keine Rechte darüber hinaus.
import { buildCalendar, parseFeedToken } from "./_lib/calendar-feed.js";

export async function GET(request) {
  return handleCalendar(request, process.env, fetch);
}

const TEXT = { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex", "Cache-Control": "no-store" };

export async function handleCalendar(request, env, fetchImpl, now = new Date()) {
  const url = new URL(request.url);
  const token = parseFeedToken(url.searchParams.get("token") ?? url.pathname.split("/").filter(Boolean).pop());
  if (!token) return new Response("Diesen Kalender gibt es nicht.\n", { status: 404, headers: TEXT });

  const result = await loadEvents(token, env, fetchImpl);
  if (result.state === "rate_limited") {
    return new Response("Zu viele Abrufe. Der Kalender versucht es später erneut.\n", { status: 429, headers: { ...TEXT, "Retry-After": "600" } });
  }
  if (result.state !== "ok") {
    return new Response("Der Kalender ist gerade nicht erreichbar.\n", { status: 503, headers: { ...TEXT, "Retry-After": "300" } });
  }
  if (result.data?.status !== "valid") {
    // Unbekannt, ersetzt oder beendet: Kalender-Apps zeigen dann einen Fehler statt alter Termine.
    return new Response("Diesen Kalender gibt es nicht (mehr). Einen neuen Link findest du in AFTERHOURS unter Einstellungen → Kalender-Abo.\n", { status: 404, headers: TEXT });
  }

  const site = (env.VITE_SITE_URL || url.origin).replace(/\/+$/, "");
  // P11 Etappe 2a: Sprache aus dem Profil der Person, der das Abo gehört (fehlt sie: Deutsch).
  return new Response(buildCalendar(result.data.events, { site, now, locale: result.data.locale }), {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="afterhours.ics"',
      "X-Robots-Tag": "noindex",
      // Kurz im CDN, damit viele Abrufe desselben Kalenders die Datenbank nicht belasten; Browser speichern nichts.
      "Cache-Control": "private, max-age=0, s-maxage=300",
    },
  });
}

/** Antwort der Datenbank: ok (mit Daten), rate_limited oder unavailable. */
async function loadEvents(token, env, fetchImpl) {
  const base = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
  const key = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || "";
  if (!base || !key) return { state: "unavailable" };
  const headers = { apikey: key, "Content-Type": "application/json" };
  // Klassische anon-Keys sind JWTs und gehören zusätzlich in Authorization; „publishable keys“ nicht.
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  try {
    const response = await fetchImpl(`${base}/rest/v1/rpc/calendar_feed_events`, {
      method: "POST",
      headers,
      body: JSON.stringify({ p_token: token }),
      signal: AbortSignal.timeout(5000),
    });
    const body = await response.json().catch(() => null);
    if (response.ok) return { state: "ok", data: body };
    return { state: body?.message === "rate_limited" ? "rate_limited" : "unavailable" };
  } catch {
    return { state: "unavailable" };
  }
}
