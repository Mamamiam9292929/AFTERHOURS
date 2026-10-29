// deno test supabase/functions/places/osm_test.ts
// Ohne externe Abhängigkeiten, damit der Test überall gleich läuft (auch neben package.json).
function eq(actual: unknown, expected: unknown, message = ""): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message} erwartet ${JSON.stringify(expected)}, erhalten ${JSON.stringify(actual)}`);
}
function is(actual: unknown, expected: unknown, message = ""): void {
  if (!Object.is(actual, expected)) throw new Error(`${message} erwartet ${String(expected)}, erhalten ${String(actual)}`);
}
import { buildOverpassQuery, categorize, commonsFileOf, describe, featuresOf, overpassAreaId, parseOpeningHours, selectPlaces, toPlace, wikidataIdOf, type OsmElement } from "./osm.ts";

Deno.test("Öffnungszeiten: einfache Regeln", () => {
  eq(parseOpeningHours("Mo-Fr 10:00-20:00; Sa 10:00-16:00"), {
    mon: [["10:00", "20:00"]], tue: [["10:00", "20:00"]], wed: [["10:00", "20:00"]], thu: [["10:00", "20:00"]], fri: [["10:00", "20:00"]],
    sat: [["10:00", "16:00"]],
  });
  eq(parseOpeningHours("Mo-Su 12:00-22:00"), Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, [["12:00", "22:00"]]])));
  eq(parseOpeningHours("10:00-18:00")?.sun, [["10:00", "18:00"]]);
});

Deno.test("Öffnungszeiten: über Mitternacht, mehrere Fenster, 24/7", () => {
  eq(parseOpeningHours("Fr,Sa 22:00-05:00")?.fri, [["22:00", "05:00"]]);
  eq(parseOpeningHours("Th-Sa 20:00-26:00")?.sat, [["20:00", "02:00"]]);
  eq(parseOpeningHours("Mo-Fr 11:30-14:30,17:30-22:00")?.wed, [["11:30", "14:30"], ["17:30", "22:00"]]);
  eq(parseOpeningHours("24/7")?.tue, [["00:00", "24:00"]]);
  eq(parseOpeningHours("Mo-Fr 00:00-24:00")?.mon, [["00:00", "24:00"]]);
});

Deno.test("Öffnungszeiten: spätere Regeln ersetzen, Komma-Regeln ergänzen, off schließt", () => {
  const h = parseOpeningHours("Mo-Su 10:00-22:00; Mo off; We 12:00-14:00");
  is(h?.mon, undefined);
  eq(h?.wed, [["12:00", "14:00"]]);
  eq(h?.tue, [["10:00", "22:00"]]);
  const c = parseOpeningHours("Mo-Fr 09:00-18:00, Sa 10:00-14:00");
  eq(c?.fri, [["09:00", "18:00"]]);
  eq(c?.sat, [["10:00", "14:00"]]);
  eq(parseOpeningHours("Sa-Mo 10:00-12:00") && Object.keys(parseOpeningHours("Sa-Mo 10:00-12:00") ?? {}), ["mon", "sat", "sun"]);
});

Deno.test("Öffnungszeiten: Feiertage werden ignoriert", () => {
  eq(parseOpeningHours("Mo-Fr 09:00-18:00; PH off")?.mon, [["09:00", "18:00"]]);
  const h = parseOpeningHours("Mo-Sa 10:00-20:00; Su,PH off");
  is(h?.sun, undefined);
  eq(h?.sat, [["10:00", "20:00"]]);
  eq(parseOpeningHours("Mo-Fr 08:00-16:00; PH 10:00-12:00")?.thu, [["08:00", "16:00"]]);
});

Deno.test("Öffnungszeiten: Unsicheres bleibt unübersetzt", () => {
  for (const raw of [
    "Mo-Fr 18:00+", "sunrise-sunset", "Apr-Oct: Mo-Su 10:00-18:00", "Mo-Fr 10:00-18:00 || \"nach Vereinbarung\"",
    "Mo-Fr 10-18", "Mo-Fr", "off", "Mo-Fr 10:00-10:00", "Mo-Fr 25:00-26:00", "SH off", "Mo[1] 10:00-12:00", "", "Montag 10:00-12:00",
  ]) {
    is(parseOpeningHours(raw), null, raw);
  }
});

Deno.test("Kategorien", () => {
  is(categorize({ amenity: "pub" }), "bar");
  is(categorize({ amenity: "biergarten" }), "bar");
  is(categorize({ leisure: "sports_centre", sport: "climbing" }), "sport");
  is(categorize({ leisure: "sports_centre", sport: "swimming;fitness" }), "swimming");
  is(categorize({ leisure: "sports_centre", sport: "laser_tag" }), "lasertag");
  is(categorize({ leisure: "track", sport: "karting" }), "karting");
  is(categorize({ leisure: "sports_centre", sport: "10pin" }), "bowling");
  is(categorize({ leisure: "escape_game" }), "escape_room");
  is(categorize({ tourism: "museum" }), "other");
  is(categorize({ leisure: "sports_centre", sport: "fitness" }), null);
  is(categorize({ shop: "bakery" }), null);
});

const restaurant: OsmElement = {
  type: "node", id: 101, lat: 51.3397123, lon: 12.3731456,
  tags: {
    amenity: "restaurant", name: "  Zum  Arabischen Coffe Baum ", cuisine: "german;regional;unknown_food", outdoor_seating: "yes",
    "addr:street": "Kleine Fleischergasse", "addr:housenumber": "4", "addr:postcode": "04109",
    opening_hours: "Mo-Su 11:00-23:00", website: "https://example.org/", phone: "+49 341 123456",
  },
};

Deno.test("Ort: Felder aus OSM, nichts erfunden", () => {
  const p = toPlace(restaurant, "Leipzig");
  is(p?.name, "Zum Arabischen Coffe Baum");
  is(p?.external_id, "node/101");
  is(p?.source_url, "https://www.openstreetmap.org/node/101");
  is(p?.address, "Kleine Fleischergasse 4, 04109 Leipzig");
  is(p?.description, "Küche: Deutsch, Regional. Außenplätze.");
  eq(p?.features, { cuisine: ["german", "regional"], outdoor_seating: true }, "Merkmale statt Satz, unbekannte Küche fällt weg");
  is(p?.website_url, "https://example.org/");
  is(p?.phone, "+49 341 123456");
  is(p?.setting, null);
  is(p?.latitude, 51.339712);
  is(p?.quality, 10);
  eq(p?.opening_hours?.sun, [["11:00", "23:00"]]);
});

Deno.test("Ort: unsichere oder fehlende Angaben", () => {
  const p = toPlace({ type: "way", id: 7, center: { lat: 51.3, lon: 12.3 }, tags: { amenity: "cinema", name: "Kino X", website: "http://kino.example", opening_hours: "Mo-Fr 18:00+" } }, "Leipzig");
  is(p?.website_url, null, "nur https-Links");
  is(p?.opening_hours, null);
  is(p?.opening_hours_raw, "Mo-Fr 18:00+");
  is(p?.setting, "indoor");
  is(p?.address, null);
  is(toPlace({ type: "node", id: 8, lat: 1, lon: 1, tags: { amenity: "bar", name: "Privat", access: "private" } }, "X"), null);
  is(toPlace({ type: "node", id: 9, lat: 1, lon: 1, tags: { amenity: "bar" } }, "X"), null, "ohne Namen");
  is(toPlace({ type: "way", id: 10, tags: { amenity: "bar", name: "Ohne Koordinaten" } }, "X"), null);
  is(toPlace({ type: "node", id: 11, lat: 1, lon: 1, tags: { amenity: "bar", name: "Zu", opening_hours: "closed" } }, "X"), null);
  is(toPlace({ type: "node", id: 12, lat: 1, lon: 1, tags: { amenity: "bar", name: "Tel", phone: "bitte anrufen" } }, "X")?.phone, null);
});

Deno.test("Dubletten: gleicher Ort als Punkt und Gebäude", () => {
  const building: OsmElement = { type: "way", id: 555, center: { lat: 51.33972, lon: 12.37316 }, tags: { amenity: "restaurant", name: "Zum Arabischen Coffe Baum" } };
  const elsewhere: OsmElement = { type: "node", id: 556, lat: 51.35, lon: 12.40, tags: { amenity: "restaurant", name: "Zum Arabischen Coffe Baum" } };
  const places = selectPlaces([building, restaurant, elsewhere], "Leipzig");
  eq(places.map((p) => p.external_id), ["node/101", "node/556"]);
});

Deno.test("Overpass-Abfrage", () => {
  is(overpassAreaId("relation", 62649), 3600062649);
  const q = buildOverpassQuery({ kind: "area", osmType: "relation", osmId: 62649 });
  is(q.includes("area(id:3600062649)->.a;"), true);
  is(q.includes("(area.a);"), true);
  is(q.trim().endsWith("out center;"), true);
  const around = buildOverpassQuery({ kind: "around", lat: 50.1, lon: 8.6, radiusM: 4000 });
  is(around.includes("(around:4000,50.100000,8.600000);"), true);
  is(around.includes("area("), false);
});

Deno.test("Fotos (P7): Commons-Dateien aus wikimedia_commons und image", () => {
  is(commonsFileOf("File:Moritzbastei_Leipzig.jpg"), "File:Moritzbastei Leipzig.jpg");
  is(commonsFileOf("Datei:Völkerschlachtdenkmal.JPG"), "File:Völkerschlachtdenkmal.JPG");
  is(commonsFileOf("https://commons.wikimedia.org/wiki/File:Moritzbastei_Leipzig_2.jpg"), "File:Moritzbastei Leipzig 2.jpg");
  is(commonsFileOf("https://upload.wikimedia.org/wikipedia/commons/a/ab/Foo%20bar.png"), "File:Foo bar.png");
  is(commonsFileOf("https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Foo.jpg/640px-Foo.jpg"), "File:Foo.jpg");
  is(commonsFileOf("File:Foo.jpg;File:Bar.jpg"), "File:Foo.jpg");
  // Kategorien, fremde Seiten, Vektorgrafiken, Pfade und HTML werden nicht übernommen.
  for (const bad of ["Category:Bars in Leipzig", "https://example.org/x.jpg", "File:Logo.svg", "File:a/b.jpg", "File:<script>.jpg", "", undefined]) {
    is(commonsFileOf(bad), null, String(bad));
  }
});

Deno.test("Fotos (P7): Wikidata-Kennung und Übernahme in den Ort", () => {
  is(wikidataIdOf("Q42"), "Q42");
  is(wikidataIdOf("q42;Q7"), "Q42");
  is(wikidataIdOf("Q0"), null);
  is(wikidataIdOf("P18"), null);
  const place = toPlace({ type: "node", id: 7, lat: 51.3, lon: 12.4, tags: { amenity: "cinema", name: "Kino", image: "https://commons.wikimedia.org/wiki/File:Kino.jpg", wikidata: "Q5" } }, "Leipzig");
  is(place?.commons_file, "File:Kino.jpg");
  is(place?.wikidata_id, "Q5");
  // wikimedia_commons hat Vorrang vor image.
  const both = toPlace({ type: "node", id: 8, lat: 51.3, lon: 12.4, tags: { amenity: "pub", name: "Pub", wikimedia_commons: "File:A.jpg", image: "File:B.jpg" } }, "Leipzig");
  is(both?.commons_file, "File:A.jpg");
  const none = toPlace({ type: "node", id: 9, lat: 51.3, lon: 12.4, tags: { amenity: "pub", name: "Pub", image: "https://example.org/pub.jpg" } }, "Leipzig");
  is(none?.commons_file, null);
  is(none?.wikidata_id, null);
});

Deno.test("P11 Etappe 2f: Merkmale für die Beschreibung in der Sprache der App", () => {
  const tags = {
    cuisine: "italian; Pizza;italian;unknown_food", sport: "climbing;soccer", "diet:vegan": "only", outdoor_seating: "yes",
    wheelchair: "limited", description: "Gemütliche Pizzeria am Markt", "description:en": "Cosy pizzeria on the market square",
  };
  eq(featuresOf(tags), {
    cuisine: ["italian", "pizza"], sport: ["climbing"], vegan: "only", outdoor_seating: true, wheelchair: "limited",
    about_de: "Gemütliche Pizzeria am Markt", about_en: "Cosy pizzeria on the market square",
  }, "bekannte Schlüssel, ohne Dubletten, Kleinbuchstaben");
  is(describe(tags), "Gemütliche Pizzeria am Markt. Küche: Italienisch, Pizza. Klettern/Bouldern. Rein vegan. Außenplätze. Eingeschränkt rollstuhlgerecht.", "deutscher Satz bleibt wie bisher");
  eq(featuresOf({ description: "Nur deutsch" }), { about_de: "Nur deutsch" }, "Beschreibung ohne Sprache gilt nicht als englisch");
  eq(featuresOf({ "description:de": "Auf Deutsch", description: "Default" }), { about_de: "Auf Deutsch" }, "description:de geht vor");
  eq(featuresOf({ "description:en": "ok" }), null, "zu kurze Beschreibung fällt weg");
  eq(featuresOf({ "description:en": "x".repeat(301) }), null, "zu lange Beschreibung fällt weg");
  eq(featuresOf({ "diet:vegan": "no", wheelchair: "no", outdoor_seating: "no" }), null, "Verneinungen sind keine Merkmale");
  eq(featuresOf({ cuisine: Array.from({ length: 12 }, (_, i) => ["italian", "pizza", "german", "thai", "indian", "greek", "burger", "sushi", "ramen", "tapas", "crepe", "waffle"][i]).join(";") })?.cuisine?.length, 8, "höchstens 8 Küchen");
  eq(featuresOf({ wheelchair: "yes", "diet:vegan": "yes" }), { vegan: "yes", wheelchair: "yes" });
});
