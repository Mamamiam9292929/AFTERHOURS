/**
 * P41 · „Wie komm ich hin?“ – Route zum Ort in der Karten-App, die man ohnehin benutzt.
 *
 * Bisher führte „In Karten öffnen“ auf der Planseite nur zur Routenplanung auf openstreetmap.org (im
 * Browser, nicht in der Karten-App) und fehlte ganz, wenn der Plan nur eine Adresse hatte, für Gäste auf
 * dem Teilen-Link und auf Home kurz vor dem Abend. Hier entstehen die Links für Apple Karten, Google Maps,
 * OpenStreetMap und – nur auf Android – die Karten-App des Geräts (`geo:` öffnet die Auswahl des Systems).
 *
 * Ehrlich und sparsam: Ohne Koordinaten und ohne Adresse gibt es keinen Link. Mit Koordinaten zählt nur
 * der Punkt (auf 5 Nachkommastellen, rund 1 m); ohne nur der Text aus Ort und Adresse. Erst der Tipp auf
 * einen Link schickt den Ort an den Anbieter – vorher geht keine Anfrage hinaus.
 */

export type MapApp = "device" | "apple" | "google" | "osm";
export type Platform = "ios" | "android" | "other";

export interface DirectionsTarget {
  latitude?: number | null;
  longitude?: number | null;
  /** Name des Orts (z. B. „Kino Babylon“) – hilft bei der Textsuche ohne Koordinaten. */
  name?: string | null;
  address?: string | null;
}

export interface DirectionsLink {
  app: MapApp;
  url: string;
}

/** Längster Suchtext, der an einen Anbieter geht (Adressen sind kürzer; schützt vor überlangen Links). */
export const MAX_QUERY_LENGTH = 200;

const ORDER: Record<Platform, MapApp[]> = {
  ios: ["apple", "google", "osm"],
  android: ["device", "google", "osm"],
  other: ["google", "osm", "apple"],
};

function validPoint(t: DirectionsTarget): { lat: string; lon: string } | null {
  const { latitude: lat, longitude: lon } = t;
  if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat: lat.toFixed(5), lon: lon.toFixed(5) };
}

function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/** Suchtext aus Ort und Adresse – ohne Dopplung, wenn die Adresse den Namen schon enthält. */
export function directionsQuery(t: DirectionsTarget): string {
  const name = clean(t.name);
  const address = clean(t.address);
  const parts = name && address.toLowerCase().includes(name.toLowerCase()) ? [address] : [name, address];
  return parts.filter(Boolean).join(", ").slice(0, MAX_QUERY_LENGTH).trim();
}

/** Gibt es überhaupt ein Ziel? (Punkt oder Text) */
export function hasDestination(t: DirectionsTarget): boolean {
  return validPoint(t) !== null || directionsQuery(t) !== "";
}

/** Plattform grob aus dem Browser – nur für die Reihenfolge und den Android-Link, nie für Daten. */
export function detectPlatform(userAgent: string, maxTouchPoints = 0): Platform {
  if (/android/i.test(userAgent)) return "android";
  if (/iphone|ipad|ipod/i.test(userAgent)) return "ios";
  // iPadOS meldet sich als Mac – aber mit Touch.
  if (/macintosh/i.test(userAgent) && maxTouchPoints > 1) return "ios";
  return "other";
}

export function directionsUrl(app: MapApp, t: DirectionsTarget): string | null {
  const point = validPoint(t);
  const query = directionsQuery(t);
  if (!point && !query) return null;
  const dest = point ? `${point.lat},${point.lon}` : query;
  const enc = encodeURIComponent(dest);
  switch (app) {
    case "apple":
      return `https://maps.apple.com/?daddr=${enc}`;
    case "google":
      return `https://www.google.com/maps/dir/?api=1&destination=${enc}`;
    case "osm":
      return `https://www.openstreetmap.org/directions?to=${enc}`;
    case "device": {
      // geo-URI (RFC 5870, Android-Erweiterung `q`): öffnet die Auswahl der installierten Karten-Apps.
      if (point) {
        const label = clean(t.name) ? `(${encodeURIComponent(clean(t.name).slice(0, 80))})` : "";
        return `geo:${point.lat},${point.lon}?q=${point.lat},${point.lon}${label}`;
      }
      return `geo:0,0?q=${enc}`;
    }
  }
}

/** Alle passenden Links, die für die Plattform wahrscheinlichste App zuerst. Leer ohne Ziel. */
export function directionsLinks(t: DirectionsTarget, platform: Platform): DirectionsLink[] {
  if (!hasDestination(t)) return [];
  return ORDER[platform].map((app) => ({ app, url: directionsUrl(app, t)! }));
}
