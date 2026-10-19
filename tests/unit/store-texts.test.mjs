// W7 Etappe 1 · Store-Unterlagen: Texte halten die Längen von App Store und Google Play ein, behaupten nichts,
// was es nicht gibt, und die Grafiken haben die verlangten Maße und Farbtiefen.
// Läuft ohne Netz: node --test tests/unit/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const file = (p) => new URL(`../../store/${p}`, import.meta.url);
const texts = JSON.parse(readFileSync(file("texte.de.json"), "utf8"));
const description = readFileSync(file("beschreibung.txt"), "utf8").trim();
const len = (s) => [...s].length;

// Grenzen laut App Store Connect bzw. Play Console (Stand Oktober 2026).
const limits = [
  ["App Store · Name", texts.app_store.name, 30],
  ["App Store · Untertitel", texts.app_store.untertitel, 30],
  ["App Store · Werbetext", texts.app_store.werbetext, 170],
  ["App Store · Stichwörter", texts.app_store.stichwoerter, 100],
  ["App Store · Beschreibung", description, 4000],
  ["Google Play · Titel", texts.google_play.titel, 30],
  ["Google Play · Kurzbeschreibung", texts.google_play.kurzbeschreibung, 80],
  ["Google Play · Beschreibung", description, 4000],
];

test("Store-Texte: alle Felder gefüllt und innerhalb der Längen", () => {
  for (const [label, value, max] of limits) {
    assert.equal(typeof value, "string", `${label} fehlt`);
    assert.ok(value.trim().length > 0, `${label} ist leer`);
    assert.ok(len(value) <= max, `${label}: ${len(value)} von höchstens ${max} Zeichen`);
  }
  assert.equal(texts.app_store.beschreibung, "beschreibung.txt");
  assert.equal(texts.google_play.beschreibung, "beschreibung.txt");
});

test("Store-Texte: Stichwörter ohne Dubletten, ohne Leerzeichen nach dem Komma, ohne den App-Namen", () => {
  const words = texts.app_store.stichwoerter.split(",");
  assert.equal(new Set(words.map((w) => w.toLowerCase())).size, words.length);
  for (const word of words) {
    assert.equal(word, word.trim(), `„${word}“ hat Leerzeichen`);
    assert.ok(word.length > 0);
    assert.notEqual(word.toLowerCase(), "afterhours", "der Name zählt bei Apple ohnehin");
  }
});

test("Store-Texte: keine Zahlen-, Preis- oder Bewertungsbehauptungen, keine Platzhalter", () => {
  const all = [...limits.map(([, value]) => value), texts.app_store.untertitel].join("\n");
  assert.doesNotMatch(all, /\d[\d.]*\s*(\+\s*)?(Nutzer|Nutzerinnen|Crews|Downloads|Bewertungen|Sterne)|★|kostenlos|gratis|Nr\.\s*1|beste[nr]? App/i);
  assert.doesNotMatch(all, /TODO|TBD|lorem|XXX|<domain>/i);
  // Nur Funktionen, die es gibt: nichts zu Push, Google-/Apple-Anmeldung, Live-Standort oder automatischer Buchung.
  assert.doesNotMatch(all, /Push|Google-Anmeldung|Apple-Anmeldung|Live-Standort|bucht für dich|automatisch gebucht/i);
  assert.match(description, /ab 16 Jahren/, "Altersgrenze wie bei der Registrierung");
  assert.match(description, /OpenStreetMap-Mitwirkende/, "Namensnennung für die Ortsdaten");
});

test("Store-Texte: offene Punkte für Benito sind benannt", () => {
  assert.ok(Array.isArray(texts.offen) && texts.offen.length > 0);
  assert.ok(texts.offen.some((item) => /App-ID|Bundle-ID/.test(item)));
});

const png = (name) => {
  const buf = readFileSync(file(`grafik/${name}`));
  assert.equal(buf.subarray(1, 4).toString("latin1"), "PNG", `${name} ist kein PNG`);
  // IHDR: Breite, Höhe, Bittiefe, Farbtyp (2 = RGB, 6 = RGBA)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), depth: buf[24], colorType: buf[25], bytes: buf.length };
};

test("Store-Grafiken: Maße und Farbtiefe, wie die Stores sie verlangen", () => {
  const apple = png("app-store-icon-1024.png");
  assert.deepEqual([apple.width, apple.height, apple.depth, apple.colorType], [1024, 1024, 8, 2], "Apple: 1024 × 1024 ohne Transparenz");
  const play = png("play-icon-512.png");
  assert.deepEqual([play.width, play.height, play.depth, play.colorType], [512, 512, 8, 6], "Google: 512 × 512, 32-Bit-PNG");
  assert.ok(play.bytes <= 1024 * 1024, "Google: Icon höchstens 1 MB");
  const feature = png("play-feature-1024x500.png");
  assert.deepEqual([feature.width, feature.height, feature.depth, feature.colorType], [1024, 500, 8, 2], "Google: Vorstellungsgrafik 1024 × 500 ohne Transparenz");
});
