// deno test supabase/functions/places/overpass_test.ts
// Roadmap O1: Ersatzserver für Overpass – ohne Netz, mit nachgebautem fetch.
import { attemptTimeoutMs, DEFAULT_OVERPASS_URLS, OverpassError, overpassEndpoints, queryOverpass } from "./overpass.ts";

function eq(actual: unknown, expected: unknown, message = ""): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message} erwartet ${JSON.stringify(expected)}, erhalten ${JSON.stringify(actual)}`);
}

const env = (values: Record<string, string>) => ({ get: (name: string) => values[name] });
const MAIN = "https://overpass-api.de/api/interpreter";
const MIRROR = "https://overpass.private.coffee/api/interpreter";

type Reply = Response | "network" | "timeout";
/** fetch, der je Server eine feste Antwort gibt und mitschreibt, wer gefragt wurde. */
function fakeFetch(replies: Record<string, Reply>, calls: { url: string; body: string }[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: String(init?.body ?? "") });
    const reply = replies[url];
    if (reply === "network" || reply === undefined) throw new TypeError("connection refused");
    if (reply === "timeout") throw new DOMException("signal timed out", "TimeoutError");
    return reply.clone();
  }) as typeof fetch;
}
const ok = (elements: unknown[]) => new Response(JSON.stringify({ elements }), { status: 200 });
const options = (fetchImpl: typeof fetch) => ({
  buildQuery: (t: number) => `[out:json][timeout:${t}];`,
  parse: (data: unknown) => {
    const elements = (data as { elements?: unknown }).elements;
    return Array.isArray(elements) ? elements : null;
  },
  userAgent: "AFTERHOURS/test",
  fetchImpl,
});

Deno.test("Serverliste: Standard, OVERPASS_URLS, älteres OVERPASS_URL, ungültige Einträge", () => {
  eq(overpassEndpoints(env({})), DEFAULT_OVERPASS_URLS, "ohne Angaben");
  eq(overpassEndpoints(env({ OVERPASS_URL: "http://stub:8089/api/interpreter" })), ["http://stub:8089/api/interpreter"], "OVERPASS_URL");
  eq(
    overpassEndpoints(env({ OVERPASS_URLS: ` ${MIRROR} ,kaputt, ftp://x/y, ${MIRROR},${MAIN}`, OVERPASS_URL: "http://alt/api" })),
    [MIRROR, MAIN],
    "OVERPASS_URLS hat Vorrang, ungültige und doppelte fallen weg",
  );
  eq(overpassEndpoints(env({ OVERPASS_URLS: "nur müll" })), DEFAULT_OVERPASS_URLS, "nichts Gültiges → Standard");
  eq(overpassEndpoints(env({ OVERPASS_URLS: "http://a/1,http://b/1,http://c/1,http://d/1,http://e/1" })).length, 4, "höchstens 4 Server");
});

Deno.test("Zeit je Versuch wird auf die übrigen Server verteilt", () => {
  eq(attemptTimeoutMs(120_000, 1), 120_000);
  eq(attemptTimeoutMs(120_000, 2), 60_000);
  eq(attemptTimeoutMs(120_000, 4), 30_000);
  eq(attemptTimeoutMs(30_000, 4), 20_000, "mindestens 20 s");
  eq(attemptTimeoutMs(12_000, 2), 12_000, "nie mehr als die Restzeit");
});

Deno.test("Hauptserver fällt aus (429, 504, Netz, Zeitüberschreitung im Text): Ersatz liefert", async () => {
  for (const [label, failure, result] of [
    ["429", new Response("busy", { status: 429 }), "busy"],
    ["504", new Response("gateway", { status: 504 }), "timeout"],
    ["Netz", "network", "unavailable"],
    ["Timeout", "timeout", "timeout"],
    ["remark", new Response(JSON.stringify({ elements: [], remark: "runtime error: Query timed out in \"query\" at line 3 after 90 seconds." }), { status: 200 }), "timeout"],
    ["kein JSON", new Response("<html>", { status: 200 }), "unavailable"],
  ] as [string, Reply, string][]) {
    const calls: { url: string; body: string }[] = [];
    const { data, attempts } = await queryOverpass([MAIN, MIRROR], options(fakeFetch({ [MAIN]: failure, [MIRROR]: ok([{ id: 1 }]) }, calls)));
    eq(data, [{ id: 1 }], `${label}: Daten vom Ersatz`);
    eq(calls.map((c) => c.url), [MAIN, MIRROR], `${label}: Reihenfolge`);
    eq(attempts.map((a) => [a.host, a.result]), [["overpass-api.de", result], ["overpass.private.coffee", "ok"]], `${label}: Versuche`);
  }
});

Deno.test("Hauptserver antwortet: Ersatz wird nicht gefragt, Abfrage-Timeout passt zum Versuch", async () => {
  const calls: { url: string; body: string }[] = [];
  const { attempts } = await queryOverpass([MAIN, MIRROR], options(fakeFetch({ [MAIN]: ok([]), [MIRROR]: "network" }, calls)));
  eq(calls.length, 1);
  eq(attempts.map((a) => a.result), ["ok"]);
  eq(new URLSearchParams(calls[0].body).get("data"), "[out:json][timeout:55];", "60 s je Server → 55 s für Overpass");
});

Deno.test("alle Server fallen aus: osm_busy bei Überlast, sonst osm_unavailable – Versuche bleiben erhalten", async () => {
  const busy = await queryOverpass([MAIN, MIRROR], options(fakeFetch({ [MAIN]: new Response("", { status: 429 }), [MIRROR]: "network" }, []))).catch((e) => e);
  eq(busy instanceof OverpassError && busy.code, "osm_busy");
  eq((busy as OverpassError).attempts.map((a) => a.result), ["busy", "unavailable"]);

  const down = await queryOverpass([MAIN, MIRROR], options(fakeFetch({ [MAIN]: new Response("", { status: 500 }), [MIRROR]: "network" }, []))).catch((e) => e);
  eq(down instanceof OverpassError && down.code, "osm_unavailable");
});

Deno.test("Gesamtzeit ist begrenzt: nach Ablauf wird kein weiterer Server gefragt", async () => {
  let clock = 0;
  const calls: { url: string; body: string }[] = [];
  const slow = fakeFetch({ [MAIN]: "timeout", [MIRROR]: ok([]) }, calls);
  const result = await queryOverpass([MAIN, MIRROR], {
    ...options(async (input, init) => {
      clock += 118_000; // der erste Versuch verbraucht fast die ganze Zeit
      return await slow(input, init);
    }),
    now: () => clock,
  }).catch((e) => e);
  eq(result instanceof OverpassError && result.code, "osm_busy");
  eq(calls.length, 1, "kein zweiter Versuch ohne Restzeit");
});
