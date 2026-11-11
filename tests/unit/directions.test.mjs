// P41 · „Wie komm ich hin?“ – Links zur Route in der Karten-App (src/lib/directions.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { detectPlatform, directionsLinks, directionsQuery, directionsUrl, hasDestination, MAX_QUERY_LENGTH } from "../../src/lib/directions.ts";

const kino = { latitude: 52.526081234, longitude: 13.41163, name: "Kino Babylon", address: "Rosa-Luxemburg-Str. 30, Berlin" };

test("mit Koordinaten zählt nur der Punkt, auf 5 Stellen", () => {
  assert.equal(directionsUrl("google", kino), "https://www.google.com/maps/dir/?api=1&destination=52.52608%2C13.41163");
  assert.equal(directionsUrl("apple", kino), "https://maps.apple.com/?daddr=52.52608%2C13.41163");
  assert.equal(directionsUrl("osm", kino), "https://www.openstreetmap.org/directions?to=52.52608%2C13.41163");
  assert.equal(directionsUrl("device", kino), "geo:52.52608,13.41163?q=52.52608,13.41163(Kino%20Babylon)");
  assert.equal(directionsUrl("device", { latitude: 1, longitude: 2 }), "geo:1.00000,2.00000?q=1.00000,2.00000");
});

test("ohne Koordinaten: Text aus Ort und Adresse, sauber kodiert", () => {
  const t = { name: "  Bowling  Mitte ", address: "Alexanderplatz 1 & 2, Berlin" };
  assert.equal(directionsQuery(t), "Bowling Mitte, Alexanderplatz 1 & 2, Berlin");
  assert.equal(directionsUrl("google", t), "https://www.google.com/maps/dir/?api=1&destination=Bowling%20Mitte%2C%20Alexanderplatz%201%20%26%202%2C%20Berlin");
  assert.equal(directionsUrl("device", t), "geo:0,0?q=Bowling%20Mitte%2C%20Alexanderplatz%201%20%26%202%2C%20Berlin");
  // Name schon in der Adresse → nicht doppelt
  assert.equal(directionsQuery({ name: "Babylon", address: "Kino Babylon, Rosa-Luxemburg-Str. 30" }), "Kino Babylon, Rosa-Luxemburg-Str. 30");
  assert.equal(directionsQuery({ address: "x".repeat(500) }).length, MAX_QUERY_LENGTH);
});

test("ungültige Koordinaten fallen auf den Text zurück, ohne alles kein Link", () => {
  assert.equal(directionsUrl("osm", { latitude: 91, longitude: 0, address: "Hauptstr. 1" }), "https://www.openstreetmap.org/directions?to=Hauptstr.%201");
  assert.equal(directionsUrl("osm", { latitude: Number.NaN, longitude: 3 }), null);
  assert.equal(hasDestination({ latitude: null, longitude: null, name: " ", address: "" }), false);
  assert.deepEqual(directionsLinks({}, "ios"), []);
  assert.equal(hasDestination({ address: "Hauptstr. 1" }), true);
});

test("Reihenfolge je Plattform, Karten-App des Geräts nur auf Android", () => {
  assert.deepEqual(directionsLinks(kino, "ios").map((l) => l.app), ["apple", "google", "osm"]);
  assert.deepEqual(directionsLinks(kino, "android").map((l) => l.app), ["device", "google", "osm"]);
  assert.deepEqual(directionsLinks(kino, "other").map((l) => l.app), ["google", "osm", "apple"]);
  for (const p of ["ios", "other"]) assert.ok(directionsLinks(kino, p).every((l) => l.url.startsWith("https://")));
});

test("Plattform aus dem Browser", () => {
  assert.equal(detectPlatform("Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/120 Mobile"), "android");
  assert.equal(detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"), "ios");
  assert.equal(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari", 5), "ios");
  assert.equal(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari", 0), "other");
  assert.equal(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "other");
});
