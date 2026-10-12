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
};

export const mapProvider: MapProvider = openStreetMap;
