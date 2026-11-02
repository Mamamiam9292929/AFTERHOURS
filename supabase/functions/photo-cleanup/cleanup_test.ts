// deno test supabase/functions/photo-cleanup/cleanup_test.ts
// P10 Etappe 3: Aufräumen der Plan-Fotos – ohne Netz, mit nachgebauter Datenbank und Storage-API.
import { BATCH, CleanupError, type Fetch, runCleanup, validPath } from "./cleanup.ts";

function eq(actual: unknown, expected: unknown, message = ""): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message} erwartet ${JSON.stringify(expected)}, erhalten ${JSON.stringify(actual)}`);
}

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const path = (n: number) => `${uuid(1)}/${uuid(2)}/${uuid(n)}.webp`;
const BASE = "http://db.test";
const HEADERS = { apikey: "service", Authorization: "Bearer service", "Content-Type": "application/json" };

interface Fake {
  fetch: Fetch;
  calls: { url: string; method: string; body: unknown }[];
  files: Set<string>;
}

/** Warteschlange wie in der Migration: claim gibt bis zu p_limit Pfade, finish streicht nur Pfade ohne Datei. */
function fake(queue: string[], options: { storageStatus?: number; storageThrows?: boolean; extra?: unknown[] } = {}): Fake {
  const files = new Set(queue);
  const pending = [...queue];
  const calls: Fake["calls"] = [];
  const fetcher: Fetch = (url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method: init?.method ?? "GET", body });
    if (url === `${BASE}/rest/v1/rpc/claim_plan_photo_trash`) {
      const taken = pending.splice(0, body.p_limit);
      return Promise.resolve(Response.json([...taken, ...(options.extra ?? [])]));
    }
    if (url === `${BASE}/rest/v1/rpc/finish_plan_photo_trash`) {
      return Promise.resolve(Response.json((body.p_paths as string[]).filter((p) => !files.has(p)).length));
    }
    if (url === `${BASE}/storage/v1/object/plan-photos` && init?.method === "DELETE") {
      if (options.storageThrows) return Promise.reject(new Error("offline"));
      const status = options.storageStatus ?? 200;
      if (status === 200) for (const p of body.prefixes as string[]) files.delete(p);
      return Promise.resolve(new Response("[]", { status }));
    }
    return Promise.resolve(new Response("nicht gefunden", { status: 404 }));
  };
  return { fetch: fetcher, calls, files };
}

Deno.test("leere Warteschlange: nur eine Abfrage, nichts gelöscht", async () => {
  const f = fake([]);
  eq(await runCleanup(f.fetch, BASE, HEADERS), { removed: 0, failed: 0 });
  eq(f.calls.length, 1);
});

Deno.test("Dateien werden über die Storage-API gelöscht und danach erledigt", async () => {
  const f = fake([path(10), path(11)]);
  eq(await runCleanup(f.fetch, BASE, HEADERS), { removed: 2, failed: 0 });
  eq(f.files.size, 0, "Dateien weg");
  const del = f.calls.find((c) => c.method === "DELETE");
  eq(del?.body, { prefixes: [path(10), path(11)] }, "ein Aufruf mit allen Pfaden");
  eq(f.calls.map((c) => c.url.split("/").pop()), ["claim_plan_photo_trash", "plan-photos", "finish_plan_photo_trash"], "Reihenfolge");
});

Deno.test("volle Runden: weiter bis die Warteschlange leer ist, höchstens fünf Runden", async () => {
  const many = Array.from({ length: BATCH * 6 }, (_, i) => path(100 + i));
  const f = fake(many);
  eq(await runCleanup(f.fetch, BASE, HEADERS), { removed: BATCH * 5, failed: 0 });
  eq(f.files.size, BATCH, "Rest kommt beim nächsten Lauf");
});

Deno.test("Storage-API lehnt ab: nichts als erledigt gemeldet, Abbruch", async () => {
  const f = fake([path(10)], { storageStatus: 500 });
  eq(await runCleanup(f.fetch, BASE, HEADERS), { removed: 0, failed: 1 });
  eq(f.calls.some((c) => c.url.endsWith("finish_plan_photo_trash")), false, "kein finish");
});

Deno.test("Storage nicht erreichbar: kein Absturz", async () => {
  const f = fake([path(10)], { storageThrows: true });
  eq(await runCleanup(f.fetch, BASE, HEADERS), { removed: 0, failed: 1 });
});

Deno.test("fremde Pfade aus der Datenbank fasst die Function nicht an", async () => {
  const f = fake([path(10)], { extra: ["../avatars/x.png", `${uuid(1)}/x.webp`, 42, null] });
  eq(await runCleanup(f.fetch, BASE, HEADERS), { removed: 1, failed: 0 });
  eq(f.calls.find((c) => c.method === "DELETE")?.body, { prefixes: [path(10)] });
});

Deno.test("Pfadprüfung", () => {
  eq(validPath(path(1)), true);
  eq(validPath(path(1).replace(".webp", ".jpg")), true);
  eq(validPath(path(1).replace(".webp", ".png")), false);
  eq(validPath(`x/${path(1)}`), false);
  eq(validPath(path(1).toUpperCase()), false);
});

Deno.test("Fehler der Datenbank werden zu CleanupError", async () => {
  const failing: Fetch = () => Promise.resolve(Response.json({ message: "rate_limited" }, { status: 400 }));
  try {
    await runCleanup(failing, BASE, HEADERS);
    throw new Error("kein Fehler");
  } catch (error) {
    eq(error instanceof CleanupError && error.code, "rate_limited");
  }
  const denied: Fetch = () => Promise.resolve(Response.json({ message: "permission denied" }, { status: 403 }));
  try {
    await runCleanup(denied, BASE, HEADERS);
    throw new Error("kein Fehler");
  } catch (error) {
    eq(error instanceof CleanupError && error.code, "forbidden");
  }
});
