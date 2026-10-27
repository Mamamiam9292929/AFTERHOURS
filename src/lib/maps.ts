/**
 * Austauschbare Kartenanbindung. Standard ist OpenStreetMap, weil dafür kein API-Schlüssel nötig
 * ist. Die Karte wird erst nach einem Klick geladen – vorher geht keine Anfrage an Dritte.
 * Für einen anderen Anbieter (Mapbox, Google Maps, MapTiler …) `mapProvider` ersetzen; dessen
 * Schlüssel muss ein für Browser gedachter, auf die Domain beschränkter Schlüssel sein.
 */
export interface MapProvider {
  readonly id: string;
  readonly attribution: string;
  /** iframe-Adresse einer eingebetteten Karte. */
  embedUrl(latitude: number, longitude: number): string;
  /** Link, der den Ort in der Karten-App bzw. im Browser öffnet. */
  linkUrl(latitude: number, longitude: number): string;
  /** Link zur Routenplanung dorthin. */
  directionsUrl(latitude: number, longitude: number): string;
  /** P6: Adresse einer 256-px-Kachel (Web-Mercator) für die Karte in Discover. */
  tileUrl(z: number, x: number, y: number): string;
  /** Seite mit Lizenz und Namensnennung – muss an jeder Karte mit Kacheln verlinkt sein. */
  readonly copyrightUrl: string;
}

const openStreetMap: MapProvider = {
  id: "openstreetmap",
  attribution: "© OpenStreetMap-Mitwirkende",
  embedUrl(latitude, longitude) {
    const d = 0.006;
    const bbox = [longitude - d, latitude - d * 0.6, longitude + d, latitude + d * 0.6].map((n) => n.toFixed(5)).join("%2C");
    return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${latitude.toFixed(5)}%2C${longitude.toFixed(5)}`;
  },
  linkUrl(latitude, longitude) {
    return `https://www.openstreetmap.org/?mlat=${latitude.toFixed(5)}&mlon=${longitude.toFixed(5)}#map=17/${latitude.toFixed(5)}/${longitude.toFixed(5)}`;
  },
  directionsUrl(latitude, longitude) {
    return `https://www.openstreetmap.org/directions?to=${latitude.toFixed(5)}%2C${longitude.toFixed(5)}`;
  },
  // Kachelserver der OSM Foundation: Nutzungsregeln (Namensnennung, Referer, keine Massenabrufe) sind mit
  // einer Karte, die nur nach Einwilligung und nur den sichtbaren Ausschnitt lädt, eingehalten. Bei viel
  // Verkehr auf einen eigenen oder kommerziellen Kachelanbieter wechseln (siehe ROADMAP, P6).
  tileUrl(z, x, y) {
    return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  },
  copyrightUrl: "https://www.openstreetmap.org/copyright",
};

export const mapProvider: MapProvider = openStreetMap;

// P6: Einwilligung „Stadtplan laden“ in Discover – nur auf diesem Gerät, nie an den Server.
const TILES_KEY = "afterhours.map.tiles";

export function mapTilesAllowed(): boolean {
  try {
    return window.localStorage.getItem(TILES_KEY) === "1";
  } catch {
    return false;
  }
}

export function setMapTilesAllowed(on: boolean) {
  try {
    if (on) window.localStorage.setItem(TILES_KEY, "1");
    else window.localStorage.removeItem(TILES_KEY);
  } catch {
    // Speicher gesperrt (privater Modus o. Ä.) – dann fragt die App beim nächsten Mal wieder.
  }
}
