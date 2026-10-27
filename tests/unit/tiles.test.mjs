// P6 · Karte in Discover: Kachel-Rechnung (src/lib/tiles.ts, Typen entfernt Node selbst).
import assert from "node:assert/strict";
import { test } from "node:test";
import { FIT_MAX_ZOOM, fitView, isGeoPoint, MAX_ZOOM, MIN_ZOOM, panBy, project, TILE_SIZE, toScreen, unproject, visibleTiles, zoomBy } from "../../src/lib/tiles.ts";

const LEIPZIG = { latitude: 51.3406321, longitude: 12.3747329 };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test("Projektion: bekannte Kachel und Hin- und Rückweg", () => {
  // Leipzig liegt bei Zoom 13 in Kachel 4377/2730 (Formel des OSM-Wikis „Slippy map tilenames“).
  const p = project(LEIPZIG, 13);
  assert.equal(Math.floor(p.x / TILE_SIZE), 4377);
  assert.equal(Math.floor(p.y / TILE_SIZE), 2730);
  const back = unproject(p, 13);
  assert.ok(near(back.latitude, LEIPZIG.latitude) && near(back.longitude, LEIPZIG.longitude));
  // Nullpunkt in der Mitte der Welt
  const zero = project({ latitude: 0, longitude: 0 }, 0);
  assert.ok(near(zero.x, 128) && near(zero.y, 128));
});

test("nur echte Koordinaten zählen", () => {
  assert.equal(isGeoPoint({ latitude: 51.3, longitude: 12.4 }), true);
  assert.equal(isGeoPoint({ latitude: null, longitude: 12.4 }), false);
  assert.equal(isGeoPoint({ latitude: 51.3, longitude: null }), false);
  assert.equal(isGeoPoint({ latitude: 95, longitude: 12 }), false);
  assert.equal(isGeoPoint({ latitude: Number.NaN, longitude: 12 }), false);
});

test("Ausschnitt passt um alle Punkte, mit Rand, so nah wie möglich", () => {
  // Wie im OSM-Stellvertreter der Journey: rund 6 × 6 km um Leipzig.
  const points = [
    { latitude: LEIPZIG.latitude - 0.027, longitude: LEIPZIG.longitude - 0.043 },
    { latitude: LEIPZIG.latitude + 0.027, longitude: LEIPZIG.longitude + 0.043 },
    LEIPZIG,
  ];
  const width = 390 - 32;
  const height = 420;
  const view = fitView(points, width, height, 32);
  for (const p of points) {
    const s = toScreen(p, view, width, height);
    assert.ok(s.x >= 32 - 1e-6 && s.x <= width - 32 + 1e-6 && s.y >= 32 - 1e-6 && s.y <= height - 32 + 1e-6, `Punkt im Bild (${s.x}, ${s.y})`);
  }
  // Eine Stufe näher passt nicht mehr.
  const closer = zoomBy(view, 1);
  const outside = points.some((p) => {
    const s = toScreen(p, closer, width, height);
    return s.x < 32 || s.x > width - 32 || s.y < 32 || s.y > height - 32;
  });
  assert.ok(outside, `Zoom ${view.zoom} ist der engste Ausschnitt`);
  assert.ok(Number.isInteger(view.zoom));
});

test("ein einzelner Ort wird nicht übertrieben herangeholt, ohne Orte gilt die Stadtmitte", () => {
  assert.equal(fitView([LEIPZIG], 400, 400).zoom, FIT_MAX_ZOOM);
  assert.deepEqual(fitView([], 400, 400, 32, LEIPZIG), { center: LEIPZIG, zoom: 13 });
  assert.equal(fitView([], 400, 400), null);
});

test("weit verstreute Orte: nie weiter weg als die kleinste Zoomstufe", () => {
  const view = fitView([{ latitude: 54.3, longitude: 6.0 }, { latitude: 47.3, longitude: 15.0 }], 50, 50, 10);
  assert.equal(view.zoom, MIN_ZOOM);
});

test("Ziehen verschiebt den Ausschnitt pixelgenau, Zoom bleibt in den Grenzen", () => {
  const view = { center: LEIPZIG, zoom: 14 };
  const moved = panBy(view, 100, -50);
  const a = project(view.center, 14);
  const b = project(moved.center, 14);
  assert.ok(near(b.x - a.x, 100, 1e-3) && near(b.y - a.y, -50, 1e-3));
  assert.equal(zoomBy({ center: LEIPZIG, zoom: MAX_ZOOM }, 1).zoom, MAX_ZOOM);
  assert.equal(zoomBy({ center: LEIPZIG, zoom: MIN_ZOOM }, -1).zoom, MIN_ZOOM);
});

test("Kacheln bedecken den Ausschnitt lückenlos und ohne doppelte", () => {
  const width = 390;
  const height = 420;
  const view = { center: LEIPZIG, zoom: 14 };
  const tiles = visibleTiles(view, width, height);
  assert.equal(new Set(tiles.map((t) => t.key)).size, tiles.length);
  for (const [x, y] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1], [width / 2, height / 2]]) {
    assert.ok(tiles.some((t) => x >= t.left && x < t.left + TILE_SIZE && y >= t.top && y < t.top + TILE_SIZE), `Pixel ${x}/${y} ist bedeckt`);
  }
  assert.ok(tiles.length <= 9, `wenige Kacheln (${tiles.length})`);
  // Die Mitte des Ausschnitts liegt in der Kachel, in der auch Leipzig liegt.
  const p = project(LEIPZIG, 14);
  const center = tiles.find((t) => width / 2 >= t.left && width / 2 < t.left + TILE_SIZE && height / 2 >= t.top && height / 2 < t.top + TILE_SIZE);
  assert.deepEqual([center.x, center.y], [Math.floor(p.x / TILE_SIZE), Math.floor(p.y / TILE_SIZE)]);
});

test("Kacheln: Welt bricht in West-Ost-Richtung um, keine Kacheln jenseits der Pole", () => {
  const tiles = visibleTiles({ center: { latitude: 84, longitude: 179.9 }, zoom: 5 }, 800, 600);
  assert.ok(tiles.every((t) => t.y >= 0 && t.y < 32 && t.x >= 0 && t.x < 32));
  assert.ok(tiles.some((t) => t.x === 0) && tiles.some((t) => t.x === 31), "Kacheln von beiden Seiten der Datumsgrenze");
});
