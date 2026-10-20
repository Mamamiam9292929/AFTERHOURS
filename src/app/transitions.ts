import type { createBrowserRouter } from "react-router-dom";

type AppRouter = ReturnType<typeof createBrowserRouter>;
type Navigate = AppRouter["navigate"];

/**
 * Weiche Seitenwechsel (D7): Jede Navigation zu einer anderen Seite läuft als View Transition – die
 * Animation selbst steht in `index.css`. Wechselt nur die Suche/der Filter (gleicher Pfad), passiert
 * nichts, damit Tippen in Suchfeldern nicht flackert. Zurück/Vor des Browsers bleibt ohne Übergang.
 * Browser ohne `document.startViewTransition` wechseln wie bisher.
 */
export function smoothNavigation(router: AppRouter): void {
  if (typeof document === "undefined" || typeof document.startViewTransition !== "function") return;
  // Startet eine neue Navigation, bevor der Übergang der vorigen läuft, bricht der Browser den alten ab
  // („Transition was skipped“). Der Router wartet auf diesen Übergang, ohne den Abbruch abzufangen – das
  // landete als unbehandelter Fehler in der Konsole. Der Seitenwechsel selbst klappt trotzdem; nur
  // genau diesen Fall still schlucken, alles andere bleibt sichtbar. Ebenso den Abbruch, wenn die neue Seite
  // auf einem langsamen Gerät länger als ~4 s zum Aufbauen braucht („DOM update timed out“, TimeoutError):
  // Der Browser zeigt die neue Seite dann ohne Übergang – kein Fehler für die Nutzer.
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as { name?: unknown; message?: unknown } | null;
    const message = typeof reason?.message === "string" ? reason.message : "";
    if (reason?.name === "AbortError" && /transition was skipped/i.test(message)) event.preventDefault();
    if (reason?.name === "TimeoutError" && /transition was aborted because of timeout/i.test(message)) event.preventDefault();
  });
  const navigate = router.navigate.bind(router) as (...args: unknown[]) => Promise<void>;
  const wrapped = (to: unknown, opts?: Record<string, unknown>) => {
    if (typeof to === "number" || to == null) return navigate(to, opts);
    const next = typeof to === "string" ? new URL(to, window.location.href).pathname : (to as { pathname?: string }).pathname;
    const samePage = next === undefined || next === router.state.location.pathname;
    if (samePage || opts?.viewTransition === false) return navigate(to, opts);
    // <Link> reicht `viewTransition: undefined` ausdrücklich durch – deshalb ?? statt Spread-Reihenfolge.
    return navigate(to, { ...opts, viewTransition: opts?.viewTransition ?? true });
  };
  router.navigate = wrapped as Navigate;
}

/**
 * Lädt die Seiten der Haupt-Navigation im Leerlauf vor. Sonst zeigt der erste Wechsel zu einer Seite
 * kurz den Lade-Spinner – mitten im Übergang.
 */
export function preloadWhenIdle(loaders: (() => Promise<unknown>)[]): void {
  const run = () => loaders.forEach((load) => void load().catch(() => undefined));
  if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 1500);
}
