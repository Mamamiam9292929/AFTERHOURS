// deno test supabase/functions/places/osm_test.ts
import { deepStrictEqual as eq, strictEqual as is } from "node:assert/strict";
import { buildOverpassQuery, categorize, overpassAreaId, parseOpeningHours, selectPlaces, toPlace, type OsmElement } from "./osm.ts";

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
