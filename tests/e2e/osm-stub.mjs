/**
 * AFTERHOURS – Stellvertreter für Nominatim und Overpass (OpenStreetMap) und Open-Meteo in der Browser-Journey.
 *
 *   node tests/e2e/osm-stub.mjs            # lauscht auf 0.0.0.0:8089 (OSM_STUB_PORT)
 *
 * Die Edge Function "places" spricht ihn über NOMINATIM_URL=http://<host>:8089 und
 * OVERPASS_URL=http://<host>:8089/api/interpreter an. So hängt die CI nicht an den öffentlichen
 * OSM-Servern (Nutzungsregeln, Last, Laufzeit), und die Journey kann genaue Zahlen prüfen.
 *
 * Datenbestand – passend zu den Prüfungen in journey.mjs:
 *   - Leipzig: 2.600 Orte aus acht Arten im Wechsel ("restaurant 0", "cafe 1", "pub 2", "cinema 3",
 *     "bowling_alley 4", "escape_game 5", "miniature_golf 6", "nightclub 7", "restaurant 8" …),
 *     also je 325 pro Art, IDs node/100000 + Nummer. Dazu ein Ort, dessen Name HTML enthält
 *     (darf nie als HTML dargestellt werden) – zusammen 2.601.
 *     Pubs haben übersetzbare Öffnungszeiten ("Mo-Su 12:00-23:00"), Kinos nicht übersetzbare
 *     ("Mo-Fr 18:00+"), die im Original erscheinen müssen.
 *   - "frankfurt" wird zum offiziellen Namen "Frankfurt am Main" aufgelöst.
 *   - Weitere bekannte Städte (Berlin, Hamburg, München, Köln, Frankfurt) liefern keine Orte, damit
 *     dort die Demo-Orte sichtbar bleiben, auf die sich die übrigen Schritte stützen.
 *   - Alles andere (z. B. "Atlantis") gibt es nicht.
 * Ersatzserver (Roadmap O1): Mit OSM_STUB_DOWN=1 spielt der Stellvertreter einen ausgefallenen
 * Overpass-Server (504 auf /api/interpreter). Die CI startet ihn so auf Port 8090 und trägt ihn in
 * OVERPASS_URLS vor dem funktionierenden ein – jeder Import muss also über den Ersatz laufen.
 * Stadtsuche mit Ersatz (Roadmap O2): Ausgefallen antwortet er auch auf /search (Nominatim) mit 503.
 * Die CI trägt ihn als NOMINATIM_URL ein und den funktionierenden als PHOTON_URL – jede neue Stadt
 * wird also über Photon (/api, GeoJSON) gefunden. Photon liefert hier dieselben Relationen wie
 * Nominatim, damit die Overpass-Abfrage dieselbe bleibt.
 * Wetter (Roadmap P5): Unter /v1/forecast spielt er Open-Meteo (OPEN_METEO_URL der Edge Function
 * "weather"), /weather-calls listet die Abfragen.
 * Ohne Abhängigkeiten, nur Node.js.
 */
import http from "node:http";

const PORT = Number(process.env.OSM_STUB_PORT ?? 8089);
const HOST = process.env.OSM_STUB_HOST ?? "0.0.0.0";
const DOWN = process.env.OSM_STUB_DOWN === "1";

const CITIES = [
  { keys: ["leipzig"], name: "Leipzig", osm_type: "relation", osm_id: 62649, lat: 51.3406321, lon: 12.3747329 },
  { keys: ["frankfurt", "frankfurt am main"], name: "Frankfurt am Main", osm_type: "relation", osm_id: 62400, lat: 50.1106444, lon: 8.6820917 },
  { keys: ["berlin"], name: "Berlin", osm_type: "relation", osm_id: 62422, lat: 52.5173885, lon: 13.3951309 },
  { keys: ["hamburg"], name: "Hamburg", osm_type: "relation", osm_id: 62782, lat: 53.550341, lon: 10.000654 },
  { keys: ["münchen", "muenchen", "munich"], name: "München", osm_type: "relation", osm_id: 62428, lat: 48.1371079, lon: 11.5753822 },
  { keys: ["köln", "koeln", "cologne"], name: "Köln", osm_type: "relation", osm_id: 62578, lat: 50.938361, lon: 6.959974 },
];
const LEIPZIG = CITIES[0];
const areaId = (city) => 3_600_000_000 + city.osm_id;

const KINDS = [
  { value: "restaurant", tags: { amenity: "restaurant", cuisine: "italian;pizza", outdoor_seating: "yes" } },
  { value: "cafe", tags: { amenity: "cafe", opening_hours: "Mo-Fr 08:00-18:00; Sa,Su 10:00-18:00" } },
  { value: "pub", tags: { amenity: "pub", opening_hours: "Mo-Su 12:00-23:00" } },
  { value: "cinema", tags: { amenity: "cinema", opening_hours: "Mo-Fr 18:00+" } },
  { value: "bowling_alley", tags: { leisure: "bowling_alley" } },
  { value: "escape_game", tags: { leisure: "escape_game" } },
  { value: "miniature_golf", tags: { leisure: "miniature_golf" } },
  { value: "nightclub", tags: { amenity: "nightclub", opening_hours: "Fr,Sa 23:00-05:00" } },
];

function leipzigElements() {
  const elements = [];
  for (let i = 0; i < 2600; i++) {
    const kind = KINDS[i % KINDS.length];
    const tags = { ...kind.tags, name: `${kind.value} ${i}` };
    // Etwa jeder dritte Ort mit Adresse, Website und Telefon – wie in echten OSM-Daten nicht überall.
    if (i % 3 === 0) {
      Object.assign(tags, {
        "addr:street": "Teststraße", "addr:housenumber": String(i), "addr:postcode": "04109",
        website: `https://example.org/ort/${i}`, phone: "+49 341 000000",
      });
    }
    // Gitter von etwa 6 × 6 km um die Stadtmitte.
    const lat = LEIPZIG.lat - 0.027 + (Math.floor(i / 52) % 50) * 0.0011;
    const lon = LEIPZIG.lon - 0.043 + (i % 52) * 0.00165;
    elements.push({ type: "node", id: 100_000 + i, lat: Number(lat.toFixed(7)), lon: Number(lon.toFixed(7)), tags });
  }
  elements.push({
    type: "way", id: 900_001, center: { lat: LEIPZIG.lat, lon: LEIPZIG.lon },
    tags: { amenity: "restaurant", name: "<img src=x onerror=alert(1)>" },
  });
  return elements;
}

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(text) });
  res.end(text);
}

const weatherCalls = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://stub");
  let body = "";
  for await (const chunk of req) body += chunk;
  console.log(`[osm-stub] ${req.method} ${url.pathname}${url.search}`);

  if (url.pathname === "/health") return send(res, 200, { ok: true });

  if (url.pathname === "/search") {
    if (DOWN) return send(res, 503, { error: "service_unavailable" });
    const q = (url.searchParams.get("q") ?? "").trim().toLocaleLowerCase("de");
    const city = CITIES.find((c) => c.keys.includes(q));
    if (!city) return send(res, 200, []);
    return send(res, 200, [{
      place_id: city.osm_id, osm_type: city.osm_type, osm_id: city.osm_id, lat: String(city.lat), lon: String(city.lon),
      name: city.name, display_name: `${city.name}, Deutschland`, category: "boundary", type: "administrative",
    }]);
  }

  if (url.pathname === "/api") {
    if (DOWN) return send(res, 503, { error: "service_unavailable" });
    const q = (url.searchParams.get("q") ?? "").trim().toLocaleLowerCase("de");
    const city = CITIES.find((c) => c.keys.includes(q));
    const features = city ? [{
      type: "Feature", geometry: { type: "Point", coordinates: [city.lon, city.lat] },
      properties: {
        osm_type: city.osm_type[0].toUpperCase(), osm_id: city.osm_id, osm_key: "place", osm_value: "city",
        countrycode: "DE", name: city.name, type: "city",
      },
    }] : [];
    return send(res, 200, { type: "FeatureCollection", features });
  }

  if (url.pathname === "/api/interpreter") {
    if (DOWN) return send(res, 504, { error: "gateway_timeout" });
    const query = new URLSearchParams(body).get("data") ?? "";
    const match = query.match(/area\(id:(\d+)\)/);
    const elements = match && Number(match[1]) === areaId(LEIPZIG) ? leipzigElements() : [];
    return send(res, 200, { version: 0.6, generator: "AFTERHOURS osm-stub", elements });
  }

  // P5: Stellvertreter für Open-Meteo. Jeder Tag gleich: 14,2 °C, 70 % Regenrisiko, leichter Regen
  // (WMO 61), Wind 12 km/h – so prüft die Journey genaue Texte. /weather-calls zählt die Abfragen
  // (die Crew soll sich eine Abfrage teilen).
  if (url.pathname === "/v1/forecast") {
    weatherCalls.push(url.search);
    const day = url.searchParams.get("start_date") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || url.searchParams.get("timezone") !== "Europe/Berlin") return send(res, 400, { error: true, reason: "bad request" });
    const hours = Array.from({ length: 24 }, (_, h) => h);
    return send(res, 200, {
      latitude: Number(url.searchParams.get("latitude")), longitude: Number(url.searchParams.get("longitude")), timezone: "Europe/Berlin",
      hourly: {
        time: hours.map((h) => `${day}T${String(h).padStart(2, "0")}:00`),
        temperature_2m: hours.map(() => 14.2),
        precipitation_probability: hours.map(() => 70),
        weather_code: hours.map(() => 61),
        wind_speed_10m: hours.map(() => 12),
      },
    });
  }
  if (url.pathname === "/weather-calls") return send(res, 200, { calls: weatherCalls });

  send(res, 404, { error: "not_found" });
});

server.listen(PORT, HOST, () => console.log(`[osm-stub] lauscht auf http://${HOST}:${PORT}`));
