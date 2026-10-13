/*
 * AFTERHOURS Service Worker (W4) – Offline-Grundgerüst, bewusst klein und ohne Bibliothek.
 *
 * - Nur Anfragen an die eigene Adresse; Supabase (andere Domain) läuft nie durch den Cache.
 * - Seitenaufrufe: erst Netz, ohne Netz die zuletzt geladene App-Hülle (index.html).
 * - /assets/* (Dateinamen mit Hash, unveränderlich), /fonts/*, /icons/*: erst Cache, sonst Netz.
 * - Es werden keine Nutzerdaten gespeichert – nur die App selbst.
 */
const SHELL_CACHE = "afterhours-shell-v1";
const ASSET_CACHE = "afterhours-assets-v1";
const SHELL_KEY = "/index.html";
const MAX_ASSETS = 150;
const STATIC = /^\/(assets|fonts|icons)\//;

async function cacheShell() {
  const response = await fetch("/", { cache: "reload" });
  if (!response.ok || !(response.headers.get("content-type") ?? "").includes("text/html")) return;
  const html = await response.clone().text();
  const shell = await caches.open(SHELL_CACHE);
  await shell.put(SHELL_KEY, response);
  // Alles, was die Hülle beim Start lädt (Skripte, Modul-Preloads, CSS), gleich mitnehmen.
  const urls = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  await cacheAssets(urls);
}

async function cacheAssets(urls) {
  const cache = await caches.open(ASSET_CACHE);
  for (const url of new Set(urls)) {
    try {
      const path = new URL(url, self.location.origin);
      if (path.origin !== self.location.origin || !STATIC.test(path.pathname)) continue;
      if (await cache.match(path.pathname)) continue;
      const response = await fetch(path.pathname);
      if (response.ok) await cache.put(path.pathname, response);
    } catch {
      /* einzelne Datei nicht erreichbar – wird beim nächsten Laden nachgeholt */
    }
  }
  await trim(cache);
}

/** Alte Builds räumen sich selbst auf: höchstens MAX_ASSETS Dateien, die ältesten fliegen zuerst. */
async function trim(cache) {
  const keys = await cache.keys();
  for (const request of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(request);
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheShell().catch(() => undefined).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("afterhours-") && key !== SHELL_CACHE && key !== ASSET_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Die Seite meldet, welche Dateien sie schon geladen hat, bevor der Service Worker übernommen hat.
self.addEventListener("message", (event) => {
  if (event.data?.type === "cache-assets" && Array.isArray(event.data.urls)) {
    event.waitUntil(cacheAssets(event.data.urls.filter((url) => typeof url === "string").slice(0, 200)));
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && (response.headers.get("content-type") ?? "").includes("text/html")) {
            const copy = response.clone();
            event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.put(SHELL_KEY, copy)));
          }
          return response;
        })
        .catch(async () => (await caches.match(SHELL_KEY, { cacheName: SHELL_CACHE })) ?? Response.error()),
    );
    return;
  }

  if (STATIC.test(url.pathname)) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(url.pathname);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          event.waitUntil(cache.put(url.pathname, copy).then(() => trim(cache)));
        }
        return response;
      }),
    );
  }
});
