/**
 * AFTERHOURS – Edge Function "push": Benachrichtigungen als Web-Push aufs Gerät (Roadmap P4).
 *
 * POST {"action": "config"}  → {"configured": true, "public_key": "<VAPID, base64url>"} oder {"configured": false}
 *                              (die App braucht den öffentlichen Schlüssel zum Abonnieren)
 * POST {"action": "send"}    → verschickt, was in der Warteschlange liegt (app_private.push_outbox):
 *   - angemeldete Person: erst push_kick (Rate Limit 60 je 10 Minuten, „gibt es überhaupt etwas?“),
 *   - service_role (z. B. pg_cron + pg_net jede Minute): direkt.
 *   Dann bis zu drei Runden à 50: claim_push_batch → verschlüsseln (RFC 8291) und mit VAPID (RFC 8292)
 *   an den Push-Dienst → report_push_results.
 *
 * Angeschrieben werden nur bekannte Push-Dienste (Google, Apple, Mozilla, Microsoft). Der Inhalt ist
 * Ende-zu-Ende verschlüsselt; der Push-Dienst sieht nur Geräteadresse, Größe und Zeitpunkt.
 *
 * Umgebung:
 *   VAPID_PUBLIC_KEY   öffentlicher Schlüssel (65 Byte, base64url)  – erzeugen: node scripts/vapid-keys.mjs
 *   VAPID_PRIVATE_KEY  privater Schlüssel (32 Byte, base64url)       – Secret, nie ins Frontend
 *   VAPID_SUBJECT      Kontakt für die Push-Dienste, z. B. mailto:push@deine-domain.de
 *   ALLOWED_ORIGIN     Standard: *
 *   PUSH_EXTRA_HOSTS, PUSH_PLAINTEXT_HOSTS  nur für Tests (Stellvertreter in der CI), in Produktion leer lassen
 * Ohne VAPID-Schlüssel antwortet die Function mit {"configured": false} und verschickt nichts.
 * Deploy: supabase functions deploy push
 */
import { deliverAll, type PushItem } from "./deliver.ts";
import { type EndpointRules, validVapidKeys, vapidKeysMatch, type VapidKeys } from "./webpush.ts";

const ROUNDS = 3;
const BATCH = 50;

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

class Failure extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

async function rpc(baseUrl: string, headers: Record<string, string>, name: string, args: unknown): Promise<unknown> {
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${name}`, { method: "POST", headers, body: JSON.stringify(args) });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (body as { message?: string } | null)?.message ?? "";
    if (message === "rate_limited") throw new Failure("rate_limited", 429);
    if (response.status === 401 || response.status === 403) throw new Failure("forbidden", 403);
    console.error(`push: rpc ${name} failed`, response.status, message);
    throw new Failure("database_error", 502);
  }
  return body;
}

const list = (value: string | undefined) => (value ?? "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);

// Die Schlüssel ändern sich nur mit einem neuen Deploy – einmal prüfen reicht.
let vapidChecked: Promise<VapidKeys | null> | null = null;
function loadVapid(): Promise<VapidKeys | null> {
  vapidChecked ??= (async () => {
    const keys = { publicKey: Deno.env.get("VAPID_PUBLIC_KEY")?.trim(), privateKey: Deno.env.get("VAPID_PRIVATE_KEY")?.trim(), subject: Deno.env.get("VAPID_SUBJECT")?.trim() };
    if (!validVapidKeys(keys)) return null;
    if (!(await vapidKeysMatch(keys))) {
      console.error("push: VAPID_PRIVATE_KEY passt nicht zu VAPID_PUBLIC_KEY – nichts wird verschickt");
      return null;
    }
    return keys;
  })();
  return vapidChecked;
}

Deno.serve(async (req) => {
  const origin = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
  if (req.method === "OPTIONS") return json({}, 200, origin);
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ configured: false }, 200, origin);

  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "not_authenticated" }, 401, origin);

  let action = "send";
  try {
    const body = await req.json();
    if (typeof body?.action === "string") action = body.action;
  } catch {
    // Leerer Rumpf: wie „send“.
  }
  if (action !== "config" && action !== "send") return json({ error: "invalid_request" }, 400, origin);

  const vapid = await loadVapid();
  if (action === "config") return json(vapid ? { configured: true, public_key: vapid.publicKey } : { configured: false }, 200, origin);
  if (!vapid) return json({ configured: false, sent: 0 }, 200, origin);

  const userHeaders = { apikey: anonKey, Authorization: authorization, "Content-Type": "application/json" };
  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const rules: EndpointRules = { extraHosts: list(Deno.env.get("PUSH_EXTRA_HOSTS")), plaintextHosts: list(Deno.env.get("PUSH_PLAINTEXT_HOSTS")) };

  try {
    if (authorization.slice(7) !== serviceKey) {
      const due = await rpc(supabaseUrl, userHeaders, "push_kick", {});
      if (due !== true) return json({ configured: true, sent: 0 }, 200, origin);
    }
    const totals = { sent: 0, gone: 0, retry: 0 };
    for (let round = 0; round < ROUNDS; round++) {
      const items = (await rpc(supabaseUrl, serviceHeaders, "claim_push_batch", { p_limit: BATCH })) as PushItem[];
      if (!Array.isArray(items) || items.length === 0) break;
      const outcomes = await deliverAll(items, vapid, rules);
      for (const outcome of outcomes) totals[outcome.result]++;
      await rpc(supabaseUrl, serviceHeaders, "report_push_results", { p_results: outcomes });
      if (items.length < BATCH) break;
    }
    return json({ configured: true, ...totals }, 200, origin);
  } catch (error) {
    const failure = error instanceof Failure ? error : new Failure("internal_error", 500);
    if (!(error instanceof Failure)) console.error("push: unexpected error", error instanceof Error ? error.message : error);
    return json({ error: failure.code }, failure.status, origin);
  }
});
