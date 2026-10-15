/**
 * AFTERHOURS – Edge Function "places": echte Orte einer Stadt aus OpenStreetMap importieren.
 *
 * Ablauf (POST {"city": "Leipzig"}):
 *   1. request_place_sync (mit dem Token der anfragenden Person): Sind die Daten frisch, ist nichts zu
 *      tun. Sonst wird das Kontingent geprüft (10 Importe/Person/Stunde, 60 insgesamt).
 *   2. Nominatim: Stadtname → OSM-Objekt (nur Deutschland).
 *   3. begin_place_sync (service_role): Region anlegen und für den Import sperren.
 *   4. Overpass: Orte der passenden Kategorien abfragen, in osm.ts umwandeln.
 *   5. ingest_place_batch / complete_place_sync: Orte schreiben, verschwundene deaktivieren.
 *
 * Nutzungsregeln der OSM-Dienste: Nominatim höchstens 1 Anfrage/Sekunde mit erkennbarer Kennung,
 * Overpass für moderate Last. Deshalb werden Städte nur einmal importiert und 30 Tage zwischengespeichert.
 * Für den Produktivbetrieb mit vielen Nutzern: eigene Overpass-Instanz oder kommerziellen Anbieter
 * über OVERPASS_URLS / NOMINATIM_URL eintragen.
 *
 * Ersatzserver (Roadmap O1): Hängt ein Overpass-Server, fragt overpass.ts den nächsten. Jeder Import,
 * der OSM erreicht hat oder daran gescheitert ist, landet mit allen Versuchen in `place_sync_runs`
 * (record_place_sync_run); Admins sehen die Fehlerquote über admin_place_sync_health.
 *
 * Secrets / Umgebung (alle optional):
 *   OSM_CONTACT    E-Mail oder Website für die Kennung gegenüber OSM (Pflicht laut Nominatim-Regeln
 *                  im Produktivbetrieb), z. B. "kontakt@example.de"
 *   OVERPASS_URLS  Komma-getrennte Liste, der Reihe nach gefragt (höchstens 4). Standard:
 *                  overpass-api.de, dann overpass.private.coffee (beide öffentlich, siehe overpass.ts)
 *   OVERPASS_URL   ein einzelner Server (älter, gilt nur ohne OVERPASS_URLS)
 *   NOMINATIM_URL  Standard: https://nominatim.openstreetmap.org
 *   ALLOWED_ORIGIN Standard: *
 * Deploy: supabase functions deploy places
 *
 * Datenlizenz: © OpenStreetMap-Mitwirkende, ODbL 1.0 – die App nennt die Quelle bei jedem Ort.
 */
import { buildOverpassQuery, selectPlaces, type OsmElement, type SearchArea } from "./osm.ts";
import { OverpassError, overpassEndpoints, queryOverpass, type Attempt } from "./overpass.ts";

const BATCH_SIZE = 1000;

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

function userAgent(): string {
  const contact = Deno.env.get("OSM_CONTACT")?.trim();
  return `AFTERHOURS/0.2 (${contact && contact.length > 3 ? contact : "self-hosted instance"})`;
}

async function rpc(baseUrl: string, headers: Record<string, string>, name: string, args: unknown): Promise<unknown> {
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${name}`, { method: "POST", headers, body: JSON.stringify(args) });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (body as { message?: string } | null)?.message ?? "";
    if (message === "rate_limited") throw new Failure("rate_limited", 429);
    if (message === "invalid_city") throw new Failure("invalid_city", 400);
    if (response.status === 401 || response.status === 403) throw new Failure("not_authenticated", 401);
    console.error(`places: rpc ${name} failed`, response.status, message);
    throw new Failure("database_error", 502);
  }
  return body;
}

interface GeocodeResult {
  name: string;
  osmType: "node" | "way" | "relation";
  osmId: number;
  lat: number;
  lon: number;
}

async function geocode(city: string): Promise<GeocodeResult> {
  const base = (Deno.env.get("NOMINATIM_URL") ?? "https://nominatim.openstreetmap.org").replace(/\/$/, "");
  const url = new URL(`${base}/search`);
  url.searchParams.set("q", city);
  url.searchParams.set("countrycodes", "de");
  url.searchParams.set("featureType", "settlement");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("accept-language", "de");
  const response = await fetch(url, { headers: { "User-Agent": userAgent(), Accept: "application/json" }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!response) throw new Failure("osm_unavailable", 502);
  if (response.status === 429) throw new Failure("osm_busy", 503);
  if (!response.ok) throw new Failure("osm_unavailable", 502);
  const results = (await response.json().catch(() => [])) as { osm_type?: string; osm_id?: number; lat?: string; lon?: string; name?: string }[];
  const hit = results[0];
  const osmType = hit?.osm_type;
  if (!hit || !hit.name || !hit.osm_id || (osmType !== "node" && osmType !== "way" && osmType !== "relation")) throw new Failure("city_not_found", 404);
  return { name: hit.name.trim().slice(0, 80), osmType, osmId: hit.osm_id, lat: Number(hit.lat), lon: Number(hit.lon) };
}

async function overpass(area: SearchArea, attempts: Attempt[]): Promise<OsmElement[]> {
  try {
    const result = await queryOverpass(overpassEndpoints(Deno.env), {
      buildQuery: (timeoutSeconds) => buildOverpassQuery(area, timeoutSeconds),
      parse: (data) => {
        const elements = (data as { elements?: unknown }).elements;
        return Array.isArray(elements) ? (elements as OsmElement[]) : null;
      },
      userAgent: userAgent(),
    });
    attempts.push(...result.attempts);
    return result.data;
  } catch (error) {
    if (error instanceof OverpassError) {
      attempts.push(...error.attempts);
      throw new Failure(error.code, error.code === "osm_busy" ? 503 : 502);
    }
    throw error;
  }
}

function userIdFromToken(authorization: string): string | null {
  try {
    const payload = authorization.replace(/^Bearer\s+/i, "").split(".")[1] ?? "";
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=")));
    return typeof decoded.sub === "string" ? decoded.sub : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const origin = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
  if (req.method === "OPTIONS") return json({}, 200, origin);
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "places_not_configured" }, 503, origin);

  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "not_authenticated" }, 401, origin);
  const userHeaders = { apikey: anonKey, Authorization: authorization, "Content-Type": "application/json" };
  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  let city = "";
  try {
    const body = await req.json();
    city = typeof body?.city === "string" ? body.city.replace(/\s+/g, " ").trim() : "";
  } catch {
    return json({ error: "invalid_request" }, 400, origin);
  }
  if (city.length < 2 || city.length > 80) return json({ error: "invalid_city" }, 400, origin);

  let region: { id: string; started_at?: string } | null = null;
  // Import-Protokoll (O1): nur Importe, die OSM tatsächlich gefragt haben.
  let contactedOsm = false;
  let syncStarted = 0;
  const attempts: Attempt[] = [];
  const record = (outcome: "ready" | "failed", error: string | null) =>
    contactedOsm
      ? rpc(supabaseUrl, serviceHeaders, "record_place_sync_run", {
        p_city: city, p_region: region?.id ?? null, p_outcome: outcome, p_error: error,
        p_attempts: attempts, p_duration_ms: Math.round(Date.now() - syncStarted),
      }).catch(() => undefined)
      : Promise.resolve(undefined);
  try {
    // 1. Nötig? Und darf diese Person gerade einen Import auslösen?
    const check = (await rpc(supabaseUrl, userHeaders, "request_place_sync", { p_city: city })) as { action: string };
    if (check.action !== "sync") return json({ status: check.action, region: check }, 200, origin);

    // 2.–3. Stadt finden und sperren.
    contactedOsm = true;
    syncStarted = Date.now();
    const place = await geocode(city);
    const begin = (await rpc(supabaseUrl, serviceHeaders, "begin_place_sync", {
      p_query: city, p_name: place.name, p_osm_type: place.osmType, p_osm_id: place.osmId,
      p_latitude: place.lat, p_longitude: place.lon, p_user: userIdFromToken(authorization),
    })) as { action: string; id: string; name: string; started_at?: string };
    if (begin.action !== "sync") {
      contactedOsm = false; // ein anderer Import lief schon – zählt dort
      return json({ status: begin.action, region: begin }, 200, origin);
    }
    region = begin;

    // 4. Orte abfragen. Kleine Orte (nur als Punkt erfasst) werden im Umkreis von 4 km gesucht.
    const area: SearchArea = place.osmType === "node"
      ? { kind: "around", lat: place.lat, lon: place.lon, radiusM: 4000 }
      : { kind: "area", osmType: place.osmType, osmId: place.osmId };
    const places = selectPlaces(await overpass(area, attempts), begin.name);

    // 5. Schreiben und abschließen.
    for (let i = 0; i < places.length; i += BATCH_SIZE) {
      await rpc(supabaseUrl, serviceHeaders, "ingest_place_batch", { p_region: begin.id, p_started: begin.started_at, p_places: places.slice(i, i + BATCH_SIZE) });
    }
    const done = await rpc(supabaseUrl, serviceHeaders, "complete_place_sync", { p_region: begin.id, p_started: begin.started_at });
    await record("ready", null);
    return json({ status: "ready", region: done }, 200, origin);
  } catch (error) {
    const failure = error instanceof Failure ? error : new Failure("internal_error", 500);
    if (!(error instanceof Failure)) console.error("places: unexpected error", error instanceof Error ? error.message : error);
    if (region?.started_at) {
      await rpc(supabaseUrl, serviceHeaders, "fail_place_sync", { p_region: region.id, p_started: region.started_at, p_error: failure.code }).catch(() => undefined);
    }
    // Eine unbekannte Stadt ist kein Ausfall von OSM.
    if (failure.code !== "city_not_found") await record("failed", failure.code);
    return json({ error: failure.code }, failure.status, origin);
  }
});
