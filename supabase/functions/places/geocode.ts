/**
 * Stadtsuche mit Ersatz (Roadmap O2).
 *
 * Bisher hing jeder Import neuer Städte an Nominatim. Jetzt der Reihe nach:
 *   1. Nominatim (NOMINATIM_URL) – liefert in der Regel die Verwaltungsgrenze (Relation).
 *   2. Schon importierte Region aus der Datenbank (gleiche Schreibweise oder früherer Suchbegriff) –
 *      ohne Netz, mit der OSM-Kennung, die Nominatim damals geliefert hat. Hilft beim Auffrischen
 *      nach 30 Tagen und nach einem gescheiterten Import.
 *   3. Photon (PHOTON_URL, Standard https://photon.komoot.io; „off“ schaltet ab) – freier Geocoder
 *      von Komoot auf OSM-Daten, öffentlich nutzbar bei fairem Umfang. Wir fragen ihn nur, wenn
 *      Nominatim ausfällt, und nur für einen Ort pro Import.
 *
 * Sagt Nominatim ausdrücklich „gibt es nicht“, fragen wir niemanden weiter (Tippfehler sollen keine
 * zweite Anfrage auslösen). Jeder Versuch wird wie bei Overpass mit Hostname, Ergebnis und Dauer
 * festgehalten; die gespeicherte Region erscheint als Host „db“.
 *
 * Photon liefert Städte meist als Punkt (node). Dann sucht Overpass im Umkreis (Großstadt 10 km,
 * sonst 4 km). Beim nächsten Auffrischen mit erreichbarem Nominatim kommt wieder die Grenze.
 */
import { hostOf, type Attempt, type AttemptResult } from "./overpass.ts";

export interface GeocodeResult {
  name: string;
  osmType: "node" | "way" | "relation";
  osmId: number;
  lat: number;
  lon: number;
  /** Suchradius in Metern, falls nur ein Punkt bekannt ist. */
  radiusM: number;
}

export type GeocodeCode = "city_not_found" | "osm_busy" | "osm_unavailable";

export class GeocodeError extends Error {
  constructor(readonly code: GeocodeCode, readonly attempts: Attempt[]) {
    super(code);
  }
}

export const DEFAULT_NOMINATIM_URL = "https://nominatim.openstreetmap.org";
export const DEFAULT_PHOTON_URL = "https://photon.komoot.io";
/** Grob Deutschland (minLon,minLat,maxLon,maxLat) – Photon kennt keinen Länderfilter. */
export const GERMANY_BBOX = "5.86,47.27,15.05,55.06";
export const DEFAULT_RADIUS_M = 4000;
export const CITY_RADIUS_M = 10000;

const SETTLEMENTS = new Set(["city", "town", "village", "municipality", "hamlet"]);
const OSM_TYPES = { N: "node", W: "way", R: "relation" } as const;

function baseUrl(value: string | undefined, fallback: string): string | null {
  const raw = value?.trim() || fallback;
  if (raw.toLowerCase() === "off") return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return fallback;
    return url.toString().replace(/\/$/, "");
  } catch {
    return fallback;
  }
}

export function geocoderEndpoints(env: { get(name: string): string | undefined }): { nominatim: string | null; photon: string | null } {
  return {
    nominatim: baseUrl(env.get("NOMINATIM_URL"), DEFAULT_NOMINATIM_URL),
    photon: baseUrl(env.get("PHOTON_URL"), DEFAULT_PHOTON_URL),
  };
}

const cleanName = (name: string) => name.replace(/\s+/g, " ").trim().slice(0, 80);
const validCoordinates = (lat: number, lon: number) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

/** Nominatim-Antwort (jsonv2) → Ergebnis; `null` = nichts Brauchbares. */
export function parseNominatim(data: unknown): GeocodeResult | null {
  if (!Array.isArray(data)) return null;
  const hit = data[0] as { osm_type?: unknown; osm_id?: unknown; lat?: unknown; lon?: unknown; name?: unknown } | undefined;
  if (!hit) return null;
  const osmType = hit.osm_type;
  const osmId = Number(hit.osm_id);
  const lat = Number(hit.lat);
  const lon = Number(hit.lon);
  if (typeof hit.name !== "string" || !cleanName(hit.name)) return null;
  if (osmType !== "node" && osmType !== "way" && osmType !== "relation") return null;
  if (!Number.isSafeInteger(osmId) || osmId <= 0 || !validCoordinates(lat, lon)) return null;
  return { name: cleanName(hit.name), osmType, osmId, lat, lon, radiusM: DEFAULT_RADIUS_M };
}

/** Photon-Antwort (GeoJSON) → erste Siedlung in Deutschland; `null` = keine. */
export function parsePhoton(data: unknown): GeocodeResult | null {
  const features = (data as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return null;
  for (const feature of features) {
    const props = (feature as { properties?: Record<string, unknown> })?.properties ?? {};
    const coords = (feature as { geometry?: { coordinates?: unknown } })?.geometry?.coordinates;
    if (props.countrycode !== "DE" || props.osm_key !== "place" || !SETTLEMENTS.has(String(props.osm_value))) continue;
    const osmType = OSM_TYPES[String(props.osm_type) as keyof typeof OSM_TYPES];
    const osmId = Number(props.osm_id);
    const name = typeof props.name === "string" ? cleanName(props.name) : "";
    if (!osmType || !Number.isSafeInteger(osmId) || osmId <= 0 || !name || !Array.isArray(coords)) continue;
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!validCoordinates(lat, lon)) continue;
    return { name, osmType, osmId, lat, lon, radiusM: props.osm_value === "city" ? CITY_RADIUS_M : DEFAULT_RADIUS_M };
  }
  return null;
}

export interface GeocodeOptions {
  nominatim: string | null;
  photon: string | null;
  userAgent: string;
  /** Schon importierte Region (Datenbank); `null` = keine. Fehler zählen als „keine“. */
  knownRegion?: () => Promise<GeocodeResult | null>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

type Outcome = { kind: "found"; result: GeocodeResult } | { kind: "none" } | { kind: "failed"; result: AttemptResult };

async function ask(
  url: URL, parse: (data: unknown) => GeocodeResult | null, empty: (data: unknown) => boolean,
  options: GeocodeOptions, attempts: Attempt[],
): Promise<Outcome> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const started = now();
  const note = (result: AttemptResult) => attempts.push({ host: hostOf(url.toString()), result, ms: Math.max(0, Math.round(now() - started)) });
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { "User-Agent": options.userAgent, Accept: "application/json" },
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });
  } catch (error) {
    const result = error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "unavailable";
    note(result);
    return { kind: "failed", result };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    const result: AttemptResult = response.status === 429 || response.status === 503 ? "busy" : response.status === 504 ? "timeout" : "unavailable";
    note(result);
    return { kind: "failed", result };
  }
  const data = await response.json().catch(() => undefined);
  if (data === undefined) {
    note("unavailable");
    return { kind: "failed", result: "unavailable" };
  }
  const result = parse(data);
  // Eine gültige, aber leere Antwort ist ein erfolgreicher Versuch: Die Stadt gibt es dort nicht.
  if (result || empty(data)) {
    note("ok");
    return result ? { kind: "found", result } : { kind: "none" };
  }
  note("unavailable");
  return { kind: "failed", result: "unavailable" };
}

/** Stadt finden: Nominatim → gespeicherte Region → Photon. */
export async function geocodeCity(city: string, options: GeocodeOptions): Promise<{ result: GeocodeResult; attempts: Attempt[]; source: "nominatim" | "db" | "photon" }> {
  const attempts: Attempt[] = [];
  const failures: AttemptResult[] = [];

  if (options.nominatim) {
    const url = new URL(`${options.nominatim}/search`);
    url.searchParams.set("q", city);
    url.searchParams.set("countrycodes", "de");
    url.searchParams.set("featureType", "settlement");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("accept-language", "de");
    // Ein Treffer ohne verwertbare Felder gilt wie „nicht gefunden“ – so wie bisher.
    const outcome = await ask(url, parseNominatim, (data) => Array.isArray(data), options, attempts);
    if (outcome.kind === "found") return { result: outcome.result, attempts, source: "nominatim" };
    if (outcome.kind === "none") throw new GeocodeError("city_not_found", attempts);
    failures.push(outcome.result);
  }

  if (options.knownRegion) {
    const started = (options.now ?? Date.now)();
    const known = await options.knownRegion().catch(() => null);
    if (known) {
      attempts.push({ host: "db", result: "ok", ms: Math.max(0, Math.round((options.now ?? Date.now)() - started)) });
      return { result: known, attempts, source: "db" };
    }
  }

  if (options.photon) {
    const url = new URL(`${options.photon}/api`);
    url.searchParams.set("q", city);
    url.searchParams.set("limit", "5");
    url.searchParams.set("lang", "de");
    url.searchParams.set("bbox", GERMANY_BBOX);
    url.searchParams.set("osm_tag", "place");
    const outcome = await ask(url, parsePhoton, (data) => Array.isArray((data as { features?: unknown } | null)?.features), options, attempts);
    if (outcome.kind === "found") return { result: outcome.result, attempts, source: "photon" };
    if (outcome.kind === "none") throw new GeocodeError("city_not_found", attempts);
    failures.push(outcome.result);
  }

  const busy = failures.some((r) => r === "busy" || r === "timeout");
  throw new GeocodeError(busy ? "osm_busy" : "osm_unavailable", attempts);
}
