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

// P6 Etappe 2: Zoomen um einen Punkt, Bündeln, Tipp auf ein Bündel.
import { CLUSTER_RADIUS, clusterAction, clusterPoints, zoomAround } from "../../src/lib/tiles.ts";

test("Zoomen um einen Punkt: der Ort unter den Fingern bleibt stehen", () => {
  const view = { center: LEIPZIG, zoom: 13 };
  const at = { x: 300, y: 120 };
  // Der Geopunkt, der gerade unter `at` liegt:
  const c = project(view.center, 13);
  const anchor = unproject({ x: c.x + at.x - 200, y: c.y + at.y - 200 }, 13);
  for (const step of [1, -1, 2]) {
    const next = zoomAround(view, step, at, 400, 400);
    assert.equal(next.zoom, 13 + step);
    const stays = toScreen(anchor, next, 400, 400);
    assert.ok(Math.abs(stays.x - at.x) < 1e-6 && Math.abs(stays.y - at.y) < 1e-6, `Anker bleibt bei Stufe ${step}`);
  }
  // In der Mitte gezoomt = wie zoomBy
  const mid = zoomAround(view, 1, { x: 200, y: 200 }, 400, 400);
  assert.ok(near(mid.center.latitude, LEIPZIG.latitude) && near(mid.center.longitude, LEIPZIG.longitude));
  // An der Grenze passiert nichts
  const top = { center: LEIPZIG, zoom: MAX_ZOOM };
  assert.equal(zoomAround(top, 1, at, 400, 400), top);
});

test("Bündeln: nahe Punkte werden eins, ferne bleiben einzeln, Reihenfolge bleibt", () => {
  const pts = [
    { id: "a", p: LEIPZIG },
    { id: "b", p: { latitude: LEIPZIG.latitude + 0.0002, longitude: LEIPZIG.longitude + 0.0002 } },
    { id: "c", p: { latitude: LEIPZIG.latitude + 0.05, longitude: LEIPZIG.longitude } },
    { id: "d", p: { latitude: LEIPZIG.latitude - 0.0003, longitude: LEIPZIG.longitude } },
  ];
  const at13 = clusterPoints(pts, (x) => x.p, 13);
  assert.deepEqual(at13.map((cl) => cl.members.map((m) => m.id)), [["a", "b", "d"], ["c"]]);
  // Ein einzelner Punkt behält genau seine Koordinate, ein Bündel liegt in der Mitte seiner Orte.
  assert.equal(at13[1].point, pts[2].p);
  const mid = toScreen(at13[0].point, { center: LEIPZIG, zoom: 13 }, 400, 400);
  const pa = toScreen(pts[0].p, { center: LEIPZIG, zoom: 13 }, 400, 400);
  assert.ok(Math.abs(mid.x - pa.x) < CLUSTER_RADIUS && Math.abs(mid.y - pa.y) < CLUSTER_RADIUS);
  // Ganz nah gehen sie auseinander.
  assert.equal(clusterPoints(pts, (x) => x.p, 18).length, 4);
  // Unabhängig vom Ausschnitt: gleiche Zoomstufe, gleiche Bündel.
  assert.deepEqual(clusterPoints(pts, (x) => x.p, 13), at13);
  assert.deepEqual(clusterPoints([], (x) => x, 13), []);
});

test("Bündeln: Gitter wie im OSM-Stellvertreter – weniger Bündel als Orte, keiner geht verloren", () => {
  const grid = [];
  for (let i = 0; i < 400; i++) grid.push({ latitude: LEIPZIG.latitude - 0.027 + Math.floor(i / 52) * 0.0011, longitude: LEIPZIG.longitude - 0.043 + (i % 52) * 0.00165 });
  for (const zoom of [12, 13, 14]) {
    const clusters = clusterPoints(grid, (p) => p, zoom);
    assert.equal(clusters.reduce((s, cl) => s + cl.members.length, 0), 400);
    assert.ok(clusters.length < 400);
    // Keine zwei Bündel-Mitten liegen aufeinander.
    const px = clusters.map((cl) => project(cl.point, zoom));
    for (let i = 0; i < px.length; i++) for (let j = i + 1; j < px.length; j++) assert.ok(Math.hypot(px[i].x - px[j].x, px[i].y - px[j].y) > 4);
  }
  assert.equal(clusterPoints(grid, (p) => p, 17).length, 400);
});

test("Tipp auf ein Bündel: heran, bis alle zu sehen sind – oder als Liste, wenn sie nie auseinandergehen", () => {
  const view = { center: LEIPZIG, zoom: 12 };
  const spread = [LEIPZIG, { latitude: LEIPZIG.latitude + 0.003, longitude: LEIPZIG.longitude + 0.004 }];
  const zoom = clusterAction(spread, view, 400, 400);
  assert.equal(zoom.kind, "zoom");
  assert.ok(zoom.view.zoom > 12);
  for (const p of spread) {
    const s = toScreen(p, zoom.view, 400, 400);
    assert.ok(s.x >= 0 && s.x <= 400 && s.y >= 0 && s.y <= 400, "beide Orte im neuen Ausschnitt");
  }
  // Schon beim Einpassen-Maximum: eine Stufe weiter, mitten aufs Bündel.
  const close = [LEIPZIG, { latitude: LEIPZIG.latitude + 0.0002, longitude: LEIPZIG.longitude }];
  const step = clusterAction(close, { center: LEIPZIG, zoom: FIT_MAX_ZOOM }, 400, 400);
  assert.equal(step.kind, "zoom");
  assert.equal(step.view.zoom, FIT_MAX_ZOOM + 1);
  // Gleiche Adresse: geht nie auseinander → Liste. Ganz nah: auch Liste.
  assert.deepEqual(clusterAction([LEIPZIG, { ...LEIPZIG }], view, 400, 400), { kind: "list" });
  assert.deepEqual(clusterAction(close, { center: LEIPZIG, zoom: MAX_ZOOM }, 400, 400), { kind: "list" });
});

import { MARKER_GAP, markerSize } from "../../src/lib/tiles.ts";

test("P6 Etappe 3: Marker überlappen sich nie – große Bündel brauchen mehr Platz", () => {
  // Dichte Innenstadt: 1.500 Orte, pseudozufällig (fester Startwert), dazu ein Haufen am selben Fleck.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pts = [];
  for (let i = 0; i < 1500; i++) pts.push({ id: i, p: { latitude: LEIPZIG.latitude + (rnd() - 0.5) * 0.08, longitude: LEIPZIG.longitude + (rnd() - 0.5) * 0.12 } });
  for (let i = 0; i < 30; i++) pts.push({ id: 1500 + i, p: { latitude: LEIPZIG.latitude, longitude: LEIPZIG.longitude } });
  for (const zoom of [10, 11, 12, 13, 14, 15, 16]) {
    const clusters = clusterPoints(pts, (x) => x.p, zoom);
    assert.equal(clusters.reduce((s, cl) => s + cl.members.length, 0), pts.length, `Zoom ${zoom}: kein Ort geht verloren`);
    assert.equal(new Set(clusters.flatMap((cl) => cl.members.map((m) => m.id))).size, pts.length, `Zoom ${zoom}: kein Ort doppelt`);
    const px = clusters.map((cl) => ({ ...project(cl.point, zoom), size: markerSize(cl.members.length) }));
    for (let i = 0; i < px.length; i++)
      for (let j = i + 1; j < px.length; j++) {
        const gap = Math.hypot(px[i].x - px[j].x, px[i].y - px[j].y) - (px[i].size + px[j].size) / 2;
        assert.ok(gap >= MARKER_GAP - 1e-6, `Zoom ${zoom}: Marker ${i} und ${j} überlappen (${gap.toFixed(1)} px)`);
      }
    // Mitglieder bleiben in der Reihenfolge der Eingabe (der erste ist der beste Ort).
    for (const cl of clusters) assert.deepEqual(cl.members.map((m) => m.id), [...cl.members.map((m) => m.id)].sort((a, b) => a - b));
  }
  // Gleiche Eingabe, gleiche Bündel.
  assert.deepEqual(clusterPoints(pts, (x) => x.p, 13), clusterPoints(pts, (x) => x.p, 13));
});

test("Markergröße: Punkt, dann wachsende Pille", () => {
  assert.deepEqual([1, 2, 9, 10, 49, 50, 999].map(markerSize), [14, 32, 32, 38, 38, 44, 44]);
});
