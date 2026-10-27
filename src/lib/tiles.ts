/**
 * P6 · Karte in Discover: Rechnen mit Kartenkacheln (Web-Mercator, 256-px-Kacheln wie bei OpenStreetMap).
 * Bewusst ohne Kartenbibliothek: Die Punkte der Orte lassen sich so auch ohne Kacheln zeichnen – dann
 * geht keine einzige Anfrage an Dritte. Die Kacheln kommen erst nach ausdrücklicher Einwilligung dazu.
 * Rein rechnerisch, ohne DOM – getestet in tests/unit/tiles.test.mjs.
 */

export const TILE_SIZE = 256;
export const MIN_ZOOM = 5;
export const MAX_ZOOM = 18;
/** Ein einzelner Ort (oder Orte am selben Fleck) wird nicht weiter herangeholt als bis hierhin. */
export const FIT_MAX_ZOOM = 16;

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface MapView {
  center: GeoPoint;
  zoom: number;
}

export interface Pixel {
  x: number;
  y: number;
}

/** Größte Breite, die Web-Mercator darstellt. */
const MAX_LAT = 85.05112878;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export const clampZoom = (zoom: number) => clamp(Math.round(zoom), MIN_ZOOM, MAX_ZOOM);
const worldSize = (zoom: number) => TILE_SIZE * 2 ** zoom;

/** Geokoordinate → Pixel in der Welt bei dieser Zoomstufe (0,0 = Nordwesten). */
export function project(point: GeoPoint, zoom: number): Pixel {
  const size = worldSize(zoom);
  const lat = (clamp(point.latitude, -MAX_LAT, MAX_LAT) * Math.PI) / 180;
  return {
    x: ((point.longitude + 180) / 360) * size,
    y: ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * size,
  };
}

/** Pixel in der Welt → Geokoordinate. */
export function unproject(pixel: Pixel, zoom: number): GeoPoint {
  const size = worldSize(zoom);
  const longitude = (pixel.x / size) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * pixel.y) / size;
  return { latitude: (180 / Math.PI) * Math.atan(Math.sinh(n)), longitude: ((((longitude + 180) % 360) + 360) % 360) - 180 };
}

export const isGeoPoint = (p: { latitude: number | null; longitude: number | null }): p is GeoPoint =>
  p.latitude != null && p.longitude != null && Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180;

/**
 * Ausschnitt, in den alle Punkte passen (mit Rand). Ohne Punkte: `fallback` (z. B. Stadtmitte) bei Zoom 13.
 * Die Zoomstufe ist ganzzahlig, damit die Kacheln scharf bleiben.
 */
export function fitView(points: GeoPoint[], width: number, height: number, padding = 32, fallback: GeoPoint | null = null): MapView | null {
  if (points.length === 0) return fallback ? { center: fallback, zoom: 13 } : null;
  const w = Math.max(1, width - 2 * padding);
  const h = Math.max(1, height - 2 * padding);
  let zoom = FIT_MAX_ZOOM;
  for (; zoom > MIN_ZOOM; zoom--) {
    const pixels = points.map((p) => project(p, zoom));
    const spanX = Math.max(...pixels.map((p) => p.x)) - Math.min(...pixels.map((p) => p.x));
    const spanY = Math.max(...pixels.map((p) => p.y)) - Math.min(...pixels.map((p) => p.y));
    if (spanX <= w && spanY <= h) break;
  }
  const pixels = points.map((p) => project(p, zoom));
  const mid = {
    x: (Math.max(...pixels.map((p) => p.x)) + Math.min(...pixels.map((p) => p.x))) / 2,
    y: (Math.max(...pixels.map((p) => p.y)) + Math.min(...pixels.map((p) => p.y))) / 2,
  };
  return { center: unproject(mid, zoom), zoom };
}

/** Position eines Punktes im sichtbaren Ausschnitt (Pixel ab oben links). */
export function toScreen(point: GeoPoint, view: MapView, width: number, height: number): Pixel {
  const p = project(point, view.zoom);
  const c = project(view.center, view.zoom);
  return { x: p.x - c.x + width / 2, y: p.y - c.y + height / 2 };
}

/** Ausschnitt um `dx`/`dy` Pixel verschieben (z. B. beim Ziehen: Inhalt folgt dem Finger, also negativ). */
export function panBy(view: MapView, dx: number, dy: number): MapView {
  const c = project(view.center, view.zoom);
  const size = worldSize(view.zoom);
  return { zoom: view.zoom, center: unproject({ x: c.x + dx, y: clamp(c.y + dy, 0, size) }, view.zoom) };
}

/** Eine Stufe näher oder weiter weg, Mitte bleibt. */
export function zoomBy(view: MapView, step: number): MapView {
  return { center: view.center, zoom: clampZoom(view.zoom + step) };
}

export interface Tile {
  key: string;
  z: number;
  x: number;
  y: number;
  left: number;
  top: number;
}

/**
 * Kacheln, die den Ausschnitt bedecken. In West-Ost-Richtung wird die Welt umgebrochen, nördlich und südlich
 * der Welt gibt es keine Kacheln.
 */
export function visibleTiles(view: MapView, width: number, height: number): Tile[] {
  const z = view.zoom;
  const count = 2 ** z;
  const c = project(view.center, z);
  const originX = c.x - width / 2;
  const originY = c.y - height / 2;
  const tiles: Tile[] = [];
  for (let ty = Math.floor(originY / TILE_SIZE); ty * TILE_SIZE < originY + height; ty++) {
    if (ty < 0 || ty >= count) continue;
    for (let tx = Math.floor(originX / TILE_SIZE); tx * TILE_SIZE < originX + width; tx++) {
      const x = ((tx % count) + count) % count;
      tiles.push({ key: `${z}/${tx}/${ty}`, z, x, y: ty, left: tx * TILE_SIZE - originX, top: ty * TILE_SIZE - originY });
    }
  }
  return tiles;
}
