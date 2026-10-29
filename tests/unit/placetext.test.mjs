// P11 Etappe 2f · Beschreibung von Orten in der Sprache der Oberfläche (src/lib/placeText.ts).
// Die Wörterbücher importieren ohne Dateiendung und über „@/“ – ein kleiner Resolver-Hook ergänzt beides.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const src = pathToFileURL(new URL("../../src/", import.meta.url).pathname).href;
const hook = `
const SRC = ${JSON.stringify(src)};
export async function resolve(specifier, context, next) {
  let spec = specifier.startsWith("@/") ? SRC + specifier.slice(2) : specifier;
  const relative = spec.startsWith(".") || spec.startsWith("file:");
  if (relative && !/\\.[cm]?[jt]sx?$/.test(spec)) {
    try { return await next(spec + ".ts", context); } catch { /* weiter ohne Endung */ }
  }
  return next(spec, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hook)}`, import.meta.url);

const { placeDescription, describeFeatures } = await import("../../src/lib/placeText.ts");
const { de } = await import("../../src/i18n/de/index.ts");
const { loadEnglish } = await import("../../src/i18n/en/index.ts");
const en = await loadEnglish();
const DE = de.discover.features;
const EN = en.discover.features;

const osm = (features, description = null) => ({ provider_id: "osm", description, features });

test("Deutsch: Satz genau wie der Import (describe in osm.ts)", () => {
  const f = { cuisine: ["german", "regional"], outdoor_seating: true };
  assert.equal(placeDescription(osm(f), "de", DE), "Küche: Deutsch, Regional. Außenplätze.");
  const all = { about_de: "Gemütliche Pizzeria am Markt", cuisine: ["italian", "pizza"], sport: ["climbing"], vegan: "only", outdoor_seating: true, wheelchair: "limited" };
  assert.equal(describeFeatures(all, "de", DE), "Gemütliche Pizzeria am Markt. Küche: Italienisch, Pizza. Klettern/Bouldern. Rein vegan. Außenplätze. Eingeschränkt rollstuhlgerecht.");
});

test("Englisch: Satz aus den Merkmalen, eigene Beschreibung nur aus description:en", () => {
  const f = { cuisine: ["italian", "pizza"], outdoor_seating: true, about_de: "Gemütlich" };
  assert.equal(placeDescription(osm(f, "Gemütlich. Küche: Italienisch, Pizza. Außenplätze."), "en", EN), "Cuisine: Italian, Pizza. Outdoor seating.");
  assert.equal(describeFeatures({ about_en: "Cosy pizzeria!", vegan: "yes", wheelchair: "yes" }, "en", EN), "Cosy pizzeria. Vegan dishes. Wheelchair accessible.", "Satzzeichen am Ende wie beim deutschen Satz");
  assert.equal(describeFeatures({ about_de: "Nur deutsch" }, "en", EN), null, "keine deutsche Beschreibung auf Englisch");
  assert.equal(describeFeatures({ sport: ["climbing", "swimming"], vegan: "only" }, "en", EN), "Climbing/bouldering, Swimming. Fully vegan.");
});

test("höchstens vier Küchen, unbekannte und doppelte Schlüssel fallen weg", () => {
  const f = { cuisine: ["italian", "unknown_food", "pizza", "italian", "thai", "greek", "indian", "__proto__", "constructor"] };
  assert.equal(describeFeatures(f, "en", EN), "Cuisine: Italian, Pizza, Thai, Greek.");
  assert.equal(describeFeatures({ cuisine: "italian", outdoor_seating: "yes", vegan: "no" }, "de", DE), null, "falsche Formen werden ignoriert");
});

test("Rückfall ohne Merkmale", () => {
  assert.equal(placeDescription(osm(null, "Küche: Italienisch."), "de", DE), "Küche: Italienisch.", "Deutsch: gespeicherter Satz");
  assert.equal(placeDescription(osm(null, "Küche: Italienisch."), "en", EN), null, "Englisch: kein deutscher OSM-Satz");
  assert.equal(placeDescription({ provider_id: "osm", description: "Küche: Italienisch." }, "en", EN), null, "Spalte fehlt (alte Antwort)");
  const own = { provider_id: "demo", description: "Bowling mit Bar", features: null };
  assert.equal(placeDescription(own, "en", EN), "Bowling mit Bar", "Orte von Hand behalten ihren Text");
  assert.equal(placeDescription(own, "de", DE), "Bowling mit Bar");
});

test("jede Küche und Sportart des Imports hat eine Übersetzung in beiden Sprachen", () => {
  const osmSource = readFileSync(new URL("../../supabase/functions/places/osm.ts", import.meta.url), "utf8");
  const block = (name) => {
    const match = new RegExp(`const ${name}: Record<string, string> = \\{([\\s\\S]*?)\\};`).exec(osmSource);
    assert.ok(match, `${name} in osm.ts gefunden`);
    return Object.fromEntries([...match[1].matchAll(/(\w+): "([^"]*)"/g)].map((m) => [m[1], m[2]]));
  };
  const cuisine = block("CUISINE");
  const sport = block("SPORT");
  assert.deepEqual(DE.cuisines, cuisine, "deutsche Küchen gleich wie im Import");
  assert.deepEqual(DE.sports, sport, "deutsche Sportarten gleich wie im Import");
  assert.deepEqual(Object.keys(EN.cuisines).sort(), Object.keys(cuisine).sort());
  assert.deepEqual(Object.keys(EN.sports).sort(), Object.keys(sport).sort());
  for (const [key, label] of Object.entries(EN.cuisines)) assert.ok(label && !/[äöß]/.test(label), `englisch: ${key}`);
});
