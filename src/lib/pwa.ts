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
