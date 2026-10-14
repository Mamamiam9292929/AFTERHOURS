import { useEffect, useSyncExternalStore } from "react";

/*
 * W4 · Installierbare App: Service Worker, Installations-Angebot des Browsers, Zähler am App-Icon,
 * Online-Status. Alles ohne Bibliothek und ohne Daten an Dritte.
 */

/** Das (nicht standardisierte) Ereignis, mit dem Chromium-Browser die Installation anbieten. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
let installed = false;
let updateReady = false;
let lastUpdateCheck = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** Früh aufrufen (vor dem ersten Rendern), damit das einmalige `beforeinstallprompt` nicht verloren geht. */
export function setupPwa(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    deferred = null;
    emit();
  });
  window.addEventListener("online", emit);
  window.addEventListener("offline", emit);
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    window.addEventListener("load", () => void registerServiceWorker(), { once: true });
  }
  if (import.meta.env.PROD) {
    // Installierte Apps bleiben tagelang offen. Kommt die App zurück in den Vordergrund (und alle 30
    // Minuten), schaut sie nach, ob es eine neue Version gibt.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void checkForUpdate();
    });
    window.setInterval(() => void checkForUpdate(), UPDATE_INTERVAL_MS);
  }
}

const UPDATE_INTERVAL_MS = 30 * 60_000;
const UPDATE_MIN_GAP_MS = 60_000;
const ENTRY = /<script[^>]+type="module"[^>]+src="(\/assets\/[^"]+\.js)"|<script[^>]+src="(\/assets\/[^"]+\.js)"[^>]+type="module"/;

/** Pfad des Start-Skripts, mit dem diese Seite geladen wurde (Dateiname enthält den Build-Hash). */
function currentEntry(): string | null {
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]');
  return script ? new URL(script.src, location.href).pathname : null;
}

/**
 * Neue Version? Die aktuelle index.html (am Service Worker vorbei, ohne Browser-Cache) nennt ein anderes
 * Start-Skript als die laufende Seite. Ohne Netz, im Hintergrund oder kurz nach der letzten Prüfung: nichts.
 */
export async function checkForUpdate(): Promise<void> {
  if (updateReady || !navigator.onLine || document.visibilityState !== "visible") return;
  if (Date.now() - lastUpdateCheck < UPDATE_MIN_GAP_MS) return;
  lastUpdateCheck = Date.now();
  const running = currentEntry();
  if (!running) return;
  try {
    const response = await fetch("/", { cache: "no-store", headers: { accept: "text/html" } });
    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("text/html")) return;
    const match = ENTRY.exec(await response.text());
    const latest = match?.[1] ?? match?.[2];
    if (latest && latest !== running) {
      updateReady = true;
      emit();
      void navigator.serviceWorker?.getRegistration().then((registration) => registration?.update()).catch(() => undefined);
    }
  } catch {
    /* Netz weg oder Server nicht erreichbar – beim nächsten Mal wieder. */
  }
}

/** Gibt es eine neuere Version der App als die, die gerade läuft? */
export function useUpdateReady(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => updateReady,
    () => false,
  );
}

async function registerServiceWorker(): Promise<void> {
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    const registration = await navigator.serviceWorker.ready;
    // Was vor der Übernahme schon geladen war (Startdateien, erste Seite), gleich für offline merken.
    const urls = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((url) => url.startsWith(`${location.origin}/assets/`) || url.startsWith(`${location.origin}/fonts/`));
    registration.active?.postMessage({ type: "cache-assets", urls });
  } catch {
    /* Ohne Service Worker läuft die App wie bisher – nur ohne Offline-Hülle. */
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Läuft die App schon als installierte App (Homescreen)? */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** iPhone/iPad in Safari: kein Installations-Ereignis, nur „Teilen → Zum Home-Bildschirm“. */
export function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

export type InstallState = "prompt" | "ios" | "unavailable";

/** Ob und wie sich die App gerade installieren lässt. */
export function useInstall(): { state: InstallState; install: () => Promise<boolean> } {
  const state = useSyncExternalStore(subscribe, (): InstallState => {
    if (installed || isStandalone()) return "unavailable";
    if (deferred) return "prompt";
    return isIosSafari() ? "ios" : "unavailable";
  });
  async function install(): Promise<boolean> {
    const event = deferred;
    if (!event) return false;
    deferred = null;
    await event.prompt();
    const choice = await event.userChoice.catch(() => ({ outcome: "dismissed" as const }));
    if (choice.outcome === "accepted") installed = true;
    emit();
    return choice.outcome === "accepted";
  }
  return { state, install };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

/** Zähler am App-Icon (nur installierte App, nur Browser mit Badging-API). */
export function useAppBadge(count: number): void {
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (!nav.setAppBadge || !nav.clearAppBadge) return;
    void (count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge()).catch(() => undefined);
    // Beim Abmelden verschwindet der Rahmen – dann auch der Zähler.
    return () => void nav.clearAppBadge?.().catch(() => undefined);
  }, [count]);
}
