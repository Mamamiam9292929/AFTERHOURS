/**
 * P10 Etappe 3 – Ablauf des Aufräumens ohne Deno.serve (testbar ohne Netz).
 *
 * Je Runde: claim_plan_photo_trash (bis zu BATCH Pfade, nur service_role) → Dateien über die Storage-API
 * löschen (DELETE /storage/v1/object/plan-photos mit {"prefixes": [...]}) → finish_plan_photo_trash.
 * Die Datenbank streicht einen Eintrag erst, wenn die Datei wirklich weg ist; scheitert die Storage-API,
 * bleibt er liegen und kommt später noch einmal dran.
 */

export const BUCKET = "plan-photos";
export const BATCH = 100;
export const ROUNDS = 5;

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export class CleanupError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

export interface CleanupResult {
  removed: number;
  failed: number;
}

/** Nur Pfade in der Form `<crew>/<plan>/<foto>.webp|jpg` – alles andere fasst die Function nicht an. */
const PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg)$/;
export const validPath = (value: unknown): value is string => typeof value === "string" && PATH.test(value);

export async function rpc(fetcher: Fetch, baseUrl: string, headers: Record<string, string>, name: string, args: unknown): Promise<unknown> {
  const response = await fetcher(`${baseUrl}/rest/v1/rpc/${name}`, { method: "POST", headers, body: JSON.stringify(args) });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (body as { message?: string } | null)?.message ?? "";
    if (message === "rate_limited") throw new CleanupError("rate_limited", 429);
    if (response.status === 401 || response.status === 403) throw new CleanupError("forbidden", 403);
    console.error(`photo-cleanup: rpc ${name} failed`, response.status, message);
    throw new CleanupError("database_error", 502);
  }
  return body;
}

/** Löscht die Dateien; true, wenn die Storage-API die Anfrage angenommen hat (fehlende Dateien zählen als gelöscht). */
export async function removeFiles(fetcher: Fetch, baseUrl: string, headers: Record<string, string>, paths: string[]): Promise<boolean> {
  try {
    const response = await fetcher(`${baseUrl}/storage/v1/object/${BUCKET}`, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ prefixes: paths }),
    });
    await response.body?.cancel();
    if (!response.ok) console.error("photo-cleanup: storage delete failed", response.status);
    return response.ok;
  } catch (error) {
    console.error("photo-cleanup: storage unreachable", error instanceof Error ? error.message : error);
    return false;
  }
}

export async function runCleanup(fetcher: Fetch, baseUrl: string, serviceHeaders: Record<string, string>): Promise<CleanupResult> {
  const result: CleanupResult = { removed: 0, failed: 0 };
  for (let round = 0; round < ROUNDS; round++) {
    const claimed = await rpc(fetcher, baseUrl, serviceHeaders, "claim_plan_photo_trash", { p_limit: BATCH });
    const paths = Array.isArray(claimed) ? claimed.filter(validPath) : [];
    if (paths.length === 0) break;
    if (!(await removeFiles(fetcher, baseUrl, serviceHeaders, paths))) {
      // Storage gerade nicht erreichbar: Einträge bleiben vorgemerkt und kommen später wieder.
      result.failed += paths.length;
      break;
    }
    const done = await rpc(fetcher, baseUrl, serviceHeaders, "finish_plan_photo_trash", { p_paths: paths });
    const count = typeof done === "number" ? done : 0;
    result.removed += count;
    result.failed += paths.length - count;
    if ((Array.isArray(claimed) ? claimed.length : 0) < BATCH) break;
  }
  return result;
}
