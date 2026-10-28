import { t } from "@/i18n";
import { isIosSafari, isStandalone } from "@/lib/pwa";
import { supabase } from "@/lib/supabase";

/*
 * P4 · Web-Push im Browser: Gerät anmelden und abmelden, Versand anstoßen.
 *
 * - Der öffentliche VAPID-Schlüssel kommt von der Edge Function `push` ({"action": "config"}); ist dort
 *   nichts eingerichtet, bleibt Push aus und die App stößt nichts an.
 * - Ein Gerät = ein Abo beim Push-Dienst des Browsers. Gespeichert werden Adresse und die öffentlichen
 *   Schlüssel (`save_push_subscription`) – der Inhalt jedes Pushs ist damit Ende-zu-Ende verschlüsselt.
 * - Nach eigenen Aktionen (jede erfolgreiche Mutation, siehe src/lib/query.ts) bittet die App die
 *   Function, die Warteschlange zu leeren – so kommen Pushs ohne Cron-Job sofort an.
 */

export type PushSupport = "supported" | "unsupported" | "ios-install";

/** Kann dieser Browser Push – und wenn nicht, warum? */
export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  // iPhone/iPad: Push nur in der installierten App (ab iOS 16.4).
  if (isIosSafari() && !isStandalone()) return "ios-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  return "supported";
}

export interface PushConfig {
  configured: boolean;
  publicKey: string | null;
}

let configPromise: Promise<PushConfig> | null = null;

function fetchPushConfig(): Promise<PushConfig> {
  return supabase.functions
    .invoke<{ configured?: boolean; public_key?: string }>("push", { body: { action: "config" } })
    .then(({ data, error }) => {
      if (error || !data) throw error ?? new Error("push_config");
      const publicKey = typeof data.public_key === "string" && /^[A-Za-z0-9_-]{86,88}$/.test(data.public_key) ? data.public_key : null;
      return { configured: Boolean(data.configured && publicKey), publicKey };
    })
    .catch((): PushConfig => {
      configPromise = null;
      return { configured: false, publicKey: null };
    });
}

/** Ist Push auf dem Server eingerichtet? Einmal je Sitzung gefragt; ohne Netz gilt „nein“ und es wird später neu gefragt. */
export function loadPushConfig(): Promise<PushConfig> {
  const pending = configPromise ?? (configPromise = fetchPushConfig());
  return pending;
}

function base64UrlToBytes(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return "";
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array) => {
  if (!a || a.byteLength !== b.length) return false;
  const view = new Uint8Array(a);
  return view.every((byte, i) => byte === b[i]);
};

/** Registrierter Service Worker – oder null (Entwicklungsmodus, Service Worker blockiert, zu langsam). */
async function registration(timeoutMs = 8000): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  const ready = navigator.serviceWorker.ready.then((reg) => reg as ServiceWorkerRegistration | null);
  const timeout = new Promise<null>((resolve) => window.setTimeout(() => resolve(null), timeoutMs));
  return Promise.race([ready, timeout]);
}

/** Das Abo dieses Geräts beim Push-Dienst (oder null). */
export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== "supported") return null;
  const reg = (await navigator.serviceWorker.getRegistration().catch(() => undefined)) ?? null;
  return (await reg?.pushManager.getSubscription().catch(() => null)) ?? null;
}

/** „Chrome auf Android“ – grob aus dem User-Agent, nur damit man seine Geräte auseinanderhält. */
export function deviceLabel(ua: string = typeof navigator === "undefined" ? "" : navigator.userAgent): string {
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /SamsungBrowser/.test(ua)
      ? "Samsung Internet"
      : /Firefox\/|FxiOS/.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS/.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : t.settings.push.deviceBrowser;
  const platform = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /Linux/.test(ua)
              ? "Linux"
              : t.settings.push.devicePlatform;
  return t.settings.push.device(browser, platform);
}

/**
 * Push auf diesem Gerät einschalten: Erlaubnis fragen (nur nach einem Tipp der Person), beim Push-Dienst
 * abonnieren, Abo speichern. Fehler kommen als `{ code }` mit Text in `errors.codes`.
 */
export async function enablePush(): Promise<string> {
  if (pushSupport() !== "supported") throw { code: "push_unsupported" };
  const config = await loadPushConfig();
  if (!config.configured || !config.publicKey) throw { code: "push_not_configured" };
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw { code: "push_denied" };
  const reg = await registration();
  if (!reg) throw { code: "push_unavailable" };
  const key = base64UrlToBytes(config.publicKey);
  let subscription = await reg.pushManager.getSubscription();
  // Abo mit einem alten Server-Schlüssel ist wertlos – neu abonnieren.
  if (subscription && !sameKey(subscription.options?.applicationServerKey, key)) {
    await subscription.unsubscribe().catch(() => false);
    subscription = null;
  }
  try {
    subscription ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  } catch {
    throw { code: "push_unavailable" };
  }
  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: subscription.endpoint,
    p_p256dh: bytesToBase64Url(subscription.getKey("p256dh")),
    p_auth: bytesToBase64Url(subscription.getKey("auth")),
    p_label: deviceLabel(),
  });
  if (error) throw error;
  return subscription.endpoint;
}

/** Push auf diesem Gerät ausschalten: Abo beim Server löschen und beim Push-Dienst kündigen. */
export async function disablePush(): Promise<void> {
  const subscription = await currentPushSubscription();
  if (!subscription) return;
  const { error } = await supabase.rpc("delete_push_subscription", { p_endpoint: subscription.endpoint });
  if (error) throw error;
  await subscription.unsubscribe().catch(() => false);
}

/**
 * Beim Abmelden: Dieses Gerät soll keine Pushs der bisherigen Person mehr bekommen. Höchstens drei
 * Sekunden – das Abmelden selbst darf daran nicht hängen.
 */
export async function forgetPushOnSignOut(): Promise<void> {
  const work = (async () => {
    const subscription = await currentPushSubscription();
    if (!subscription) return;
    await supabase.rpc("delete_push_subscription", { p_endpoint: subscription.endpoint });
    await subscription.unsubscribe().catch(() => false);
  })().catch(() => undefined);
  await Promise.race([work, new Promise((resolve) => window.setTimeout(resolve, 3000))]);
}

let kickTimer: number | null = null;

/**
 * Versand anstoßen – kurz gesammelt (1,5 s), damit eine Aktion mit mehreren Schreibvorgängen nur einen
 * Aufruf auslöst. Fehler sind egal: Was liegen bleibt, nimmt der nächste Anstoß mit.
 */
export function kickPush(): void {
  if (typeof window === "undefined") return;
  if (kickTimer !== null) window.clearTimeout(kickTimer);
  kickTimer = window.setTimeout(() => {
    kickTimer = null;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return;
      const config = await loadPushConfig();
      if (!config.configured) return;
      await supabase.functions.invoke("push", { body: { action: "send" } });
    })().catch(() => undefined);
  }, 1500);
}
