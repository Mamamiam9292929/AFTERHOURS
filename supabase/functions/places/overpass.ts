/**
 * Overpass mit Ersatzservern (Roadmap O1).
 *
 * Die Server werden der Reihe nach gefragt. Antwortet einer nicht, ist überlastet (429/5xx), meldet
 * eine Zeitüberschreitung im Text oder liefert Unbrauchbares, kommt der nächste dran. Jeder Versuch
 * wird mit Server (nur Hostname), Ergebnis und Dauer festgehalten – die Edge Function schreibt das
 * in `place_sync_runs`, damit die Fehlerquote abfragbar ist.
 *
 * Reihenfolge: OVERPASS_URLS (Komma-getrennt), sonst OVERPASS_URL (ein Server, wie bisher), sonst
 * die Standardliste unten. Beide Standardserver stehen im OSM-Wiki unter „Public Overpass API
 * instances“ (Stand 10/2026): overpass-api.de (FOSSGIS, bis 10.000 Abfragen/Tag) und
 * overpass.private.coffee (frei, ohne Rate Limit, große Projekte bitte vorher melden).
 */

export const DEFAULT_OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

/** Höchstens so viele Server pro Import – mehr hilft nicht und kostet Laufzeit. */
export const MAX_ENDPOINTS = 4;

export type AttemptResult = "ok" | "busy" | "timeout" | "unavailable";

export interface Attempt {
  host: string;
  result: AttemptResult;
  ms: number;
}

export class OverpassError extends Error {
  constructor(readonly code: "osm_busy" | "osm_unavailable", readonly attempts: Attempt[]) {
    super(code);
  }
}

/** Liest die Serverliste aus der Umgebung; ungültige Adressen fallen weg, Doppelte auch. */
export function overpassEndpoints(env: { get(name: string): string | undefined }): string[] {
  const list = env.get("OVERPASS_URLS")?.trim() || env.get("OVERPASS_URL")?.trim() || "";
  const raw = list ? list.split(",") : DEFAULT_OVERPASS_URLS;
  const urls: string[] = [];
  for (const entry of raw) {
    const value = entry.trim();
    try {
      const url = new URL(value);
      if ((url.protocol === "https:" || url.protocol === "http:") && !urls.includes(url.toString())) urls.push(url.toString());
    } catch {
      // ungültig – überspringen
    }
  }
  return (urls.length ? urls : DEFAULT_OVERPASS_URLS).slice(0, MAX_ENDPOINTS);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase().slice(0, 120);
  } catch {
    return "unknown";
  }
}

export interface QueryOptions<T> {
  /** Abfrage mit dem Server-Timeout in Sekunden (passend zur Zeit, die der Versuch hat). */
  buildQuery: (timeoutSeconds: number) => string;
  /** Prüft und wandelt die Antwort; `null` = unbrauchbar. */
  parse: (data: unknown) => T | null;
  userAgent: string;
  /** Gesamtzeit für alle Versuche (Edge Functions laufen höchstens 150 s). */
  budgetMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const MIN_ATTEMPT_MS = 20_000;
const MAX_ATTEMPT_MS = 120_000;

/** Zeit für den nächsten Versuch: der Rest wird auf die verbleibenden Server verteilt. */
export function attemptTimeoutMs(remainingMs: number, serversLeft: number): number {
  const share = Math.floor(remainingMs / Math.max(1, serversLeft));
  return Math.min(MAX_ATTEMPT_MS, remainingMs, Math.max(MIN_ATTEMPT_MS, share));
}

export async function queryOverpass<T>(urls: string[], options: QueryOptions<T>): Promise<{ data: T; attempts: Attempt[] }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const deadline = now() + (options.budgetMs ?? 120_000);
  const attempts: Attempt[] = [];

  for (let i = 0; i < urls.length; i++) {
    const remaining = deadline - now();
    if (remaining < 5_000) break;
    const timeoutMs = attemptTimeoutMs(remaining, urls.length - i);
    const started = now();
    const host = hostOf(urls[i]);
    const note = (result: AttemptResult) => attempts.push({ host, result, ms: Math.max(0, Math.round(now() - started)) });

    let response: Response;
    try {
      response = await fetchImpl(urls[i], {
        method: "POST",
        headers: { "User-Agent": options.userAgent, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ data: options.buildQuery(Math.max(10, Math.floor(timeoutMs / 1000) - 5)) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      note(error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "unavailable");
      continue;
    }
    if (response.status === 429 || response.status === 503) {
      await response.body?.cancel().catch(() => undefined);
      note("busy");
      continue;
    }
    if (response.status === 504) {
      await response.body?.cancel().catch(() => undefined);
      note("timeout");
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      note("unavailable");
      continue;
    }
    const body = (await response.json().catch(() => null)) as { remark?: unknown } | null;
    // Overpass meldet Zeitüberschreitungen mit Status 200 und einem Hinweis statt Daten.
    if (body && typeof body.remark === "string" && /error|timed out|out of memory/i.test(body.remark)) {
      note(/timed out/i.test(body.remark) ? "timeout" : "busy");
      continue;
    }
    const data = body === null ? null : options.parse(body);
    if (data === null) {
      note("unavailable");
      continue;
    }
    note("ok");
    return { data, attempts };
  }

  const busy = attempts.some((a) => a.result === "busy" || a.result === "timeout");
  throw new OverpassError(busy ? "osm_busy" : "osm_unavailable", attempts);
}
