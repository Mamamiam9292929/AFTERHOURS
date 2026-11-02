// P10 Etappe 1b · Fotos zum Plan: Maße beim Verkleinern, verbleibende Fotos, erkennbare Bilder (src/lib/photo.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { fitWithin, looksLikeImage, photosLeft } from "../../src/lib/photo.ts";

test("lange Seite höchstens 1600 px, Seitenverhältnis bleibt", () => {
  assert.deepEqual(fitWithin(4032, 3024), { width: 1600, height: 1200 });
  assert.deepEqual(fitWithin(3024, 4032), { width: 1200, height: 1600 });
  assert.deepEqual(fitWithin(4000, 4000), { width: 1600, height: 1600 });
});

test("kleine Fotos werden nicht vergrößert", () => {
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(1600, 900), { width: 1600, height: 900 });
});

test("extreme Formate: nie unter 1 px, nie über 1600 px", () => {
  assert.deepEqual(fitWithin(20000, 5), { width: 1600, height: 1 });
  const pano = fitWithin(12000, 2000);
  assert.equal(pano.width, 1600);
  assert.equal(pano.height, 267);
});

test("kaputte Maße ergeben 0 (wird als ungültiges Foto abgewiesen)", () => {
  assert.deepEqual(fitWithin(0, 100), { width: 0, height: 0 });
  assert.deepEqual(fitWithin(Number.NaN, 100), { width: 0, height: 0 });
});

test("verbleibende Fotos: kleinere der beiden Grenzen (50 je Plan, 10 je Person)", () => {
  assert.equal(photosLeft(0, 0), 10);
  assert.equal(photosLeft(12, 3), 7);
  assert.equal(photosLeft(45, 2), 5);
  assert.equal(photosLeft(50, 0), 0);
  assert.equal(photosLeft(20, 10), 0);
  assert.equal(photosLeft(55, 12), 0);
});

test("Bilder erkennen – auch ohne Typ (manche Android-Dateiauswahlen)", () => {
  assert.ok(looksLikeImage({ type: "image/jpeg", name: "a.jpg" }));
  assert.ok(looksLikeImage({ type: "", name: "IMG_0001.HEIC" }));
  assert.ok(!looksLikeImage({ type: "video/mp4", name: "clip.mp4" }));
  assert.ok(!looksLikeImage({ type: "application/pdf", name: "plan.pdf" }));
});
