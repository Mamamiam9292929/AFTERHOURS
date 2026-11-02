/**
 * AFTERHOURS – Edge Function "photo-cleanup": Dateien gelöschter und abgelaufener Plan-Fotos wirklich
 * aus dem Speicher entfernen (Roadmap P10 Etappe 3).
 *
 * POST (Rumpf egal):
 *   - angemeldete Person: erst plan_photo_cleanup_kick (Rate Limit 12 je Stunde; prüft die Fristen –
 *     12 Monate nach dem Abend, Reservierungen nach einem Tag – und sagt, ob etwas zu löschen ist),
 *   - service_role (z. B. pg_cron + pg_net einmal am Tag): direkt.
 *   Dann bis zu fünf Runden à 100 Pfade (siehe cleanup.ts). Antwort: {"removed": n, "failed": m}.
 *
 * Kein Inhalt eines Fotos verlässt die Datenbank; die Function kennt nur Pfade.
 * Umgebung: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (setzt Supabase selbst), ALLOWED_ORIGIN (Standard *).
 * Deploy: supabase functions deploy photo-cleanup
 */
import { CleanupError, rpc, runCleanup } from "./cleanup.ts";

const json = (body: unknown, status: number, origin: string) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });

Deno.serve(async (req) => {
  const origin = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
  if (req.method === "OPTIONS") return json({}, 200, origin);
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);
  await req.body?.cancel();

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "not_configured" }, 503, origin);

  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "not_authenticated" }, 401, origin);

  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  try {
    if (authorization.slice(7) !== serviceKey) {
      const userHeaders = { apikey: anonKey, Authorization: authorization, "Content-Type": "application/json" };
      const due = await rpc(fetch, supabaseUrl, userHeaders, "plan_photo_cleanup_kick", {});
      if (due !== true) return json({ removed: 0, failed: 0 }, 200, origin);
    }
    return json(await runCleanup(fetch, supabaseUrl, serviceHeaders), 200, origin);
  } catch (error) {
    const failure = error instanceof CleanupError ? error : new CleanupError("internal_error", 500);
    if (!(error instanceof CleanupError)) console.error("photo-cleanup: unexpected error", error instanceof Error ? error.message : error);
    return json({ error: failure.code }, failure.status, origin);
  }
});
