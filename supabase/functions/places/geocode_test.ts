// deno test supabase/functions/places/geocode_test.ts
// Roadmap O2: Stadtsuche mit Ersatz – ohne Netz, mit nachgebautem fetch.
import {
  CITY_RADIUS_M, DEFAULT_NOMINATIM_URL, DEFAULT_PHOTON_URL, DEFAULT_RADIUS_M, GeocodeError, geocodeCity, geocoderEndpoints,
  type GeocodeResult, parseNominatim, parsePhoton,
} from "./geocode.ts";

function eq(actual: unknown, expected: unknown, message = ""): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message} erwartet ${JSON.stringify(expected)}, erhalten ${JSON.stringify(actual)}`);
}

const env = (values: Record<string, string>) => ({ get: (name: string) => values[name] });
const NOMINATIM = "https://nominatim.example";
const PHOTON = "https://photon.example";

type Reply = Response | "network" | "timeout";
/** fetch mit fester Antwort je Host; schreibt mit, welche Adressen gefragt wurden. */
function fakeFetch(replies: Record<string, Reply>, calls: string[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url.toString());
    const reply = replies[url.origin];
    if (reply === "network" || reply === undefined) throw new TypeError("connection refused");
    if (reply === "timeout") throw new DOMException("signal timed out", "TimeoutError");
    // Neue Antwort statt clone(): Abbrechen eines geteilten Datenstroms wartet je nach Laufzeit ewig.
    return new Response(await reply.clone().text(), { status: reply.status });
  }) as typeof fetch;
}
const jsonReply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const leipzigNominatim = [{ osm_type: "relation", osm_id: 62649, lat: "51.3406321", lon: "12.3747329", name: "Leipzig" }];
const photonFeature = (props: Record<string, unknown>, coords = [13.3951309, 52.5173885]) => ({
  type: "Feature", geometry: { type: "Point", coordinates: coords },
  properties: { osm_type: "N", osm_id: 240109189, osm_key: "place", osm_value: "city", countrycode: "DE", name: "Berlin", ...props },
});
const options = (fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) => ({
  nominatim: NOMINATIM, photon: PHOTON, userAgent: "AFTERHOURS/test", fetchImpl, ...extra,
});

Deno.test("Adressen: Standard, eigene Server, „off“ schaltet ab, Ungültiges fällt auf den Standard zurück", () => {
  eq(geocoderEndpoints(env({})), { nominatim: DEFAULT_NOMINATIM_URL, photon: DEFAULT_PHOTON_URL }, "Standard");
  eq(geocoderEndpoints(env({ NOMINATIM_URL: "http://stub:8090/", PHOTON_URL: "http://stub:8089" })),
    { nominatim: "http://stub:8090", photon: "http://stub:8089" }, "eigene Server ohne Schrägstrich am Ende");
  eq(geocoderEndpoints(env({ PHOTON_URL: "OFF" })).photon, null, "Photon abgeschaltet");
  eq(geocoderEndpoints(env({ PHOTON_URL: "ftp://x", NOMINATIM_URL: "kaputt" })), { nominatim: DEFAULT_NOMINATIM_URL, photon: DEFAULT_PHOTON_URL }, "ungültig");
});

Deno.test("Nominatim-Antwort: Treffer, unbrauchbare Felder", () => {
  eq(parseNominatim(leipzigNominatim), { name: "Leipzig", osmType: "relation", osmId: 62649, lat: 51.3406321, lon: 12.3747329, radiusM: DEFAULT_RADIUS_M });
  eq(parseNominatim([]), null, "leer");
  eq(parseNominatim([{ ...leipzigNominatim[0], osm_type: "area" }]), null, "unbekannte Art");
  eq(parseNominatim([{ ...leipzigNominatim[0], lat: "nördlich" }]), null, "Koordinaten");
  eq(parseNominatim({ error: "x" }), null, "kein Array");
});

Deno.test("Photon-Antwort: nur Siedlungen in Deutschland, Großstadt mit größerem Umkreis", () => {
  eq(parsePhoton({ features: [photonFeature({})] }),
    { name: "Berlin", osmType: "node", osmId: 240109189, lat: 52.5173885, lon: 13.3951309, radiusM: CITY_RADIUS_M }, "Großstadt");
  eq(parsePhoton({ features: [
    photonFeature({ countrycode: "AT", name: "Wien" }),
    photonFeature({ osm_key: "amenity", osm_value: "pub", name: "Berlin Bar" }),
    photonFeature({ osm_type: "R", osm_id: 62649, osm_value: "town", name: "Markkleeberg" }, [12.37, 51.28]),
  ] })?.name, "Markkleeberg", "Ausland und Kneipen werden übersprungen");
  eq(parsePhoton({ features: [photonFeature({ osm_value: "town" })] })?.radiusM, DEFAULT_RADIUS_M, "Kleinstadt: 4 km");
  eq(parsePhoton({ features: [] }), null, "leer");
  eq(parsePhoton({ features: [photonFeature({ osm_id: -1 })] }), null, "ungültige Kennung");
  eq(parsePhoton(null), null, "nichts");
});

Deno.test("Nominatim antwortet: kein Ersatz gefragt", async () => {
  const calls: string[] = [];
  let askedDb = false;
  const found = await geocodeCity("Leipzig", options(fakeFetch({ [NOMINATIM]: jsonReply(leipzigNominatim), [PHOTON]: "network" }, calls), {
    knownRegion: () => { askedDb = true; return Promise.resolve(null); },
  }));
  eq(found.source, "nominatim");
  eq(found.result.osmId, 62649);
  eq(found.attempts.map((a) => `${a.host}:${a.result}`), ["nominatim.example:ok"]);
  eq(calls.length, 1, "nur Nominatim gefragt");
  eq(askedDb, false, "Datenbank nicht gefragt");
  const url = new URL(calls[0]);
  eq([url.pathname, url.searchParams.get("countrycodes"), url.searchParams.get("featureType"), url.searchParams.get("q")], ["/search", "de", "settlement", "Leipzig"]);
});

Deno.test("Nominatim kennt die Stadt nicht: niemand sonst wird gefragt", async () => {
  const calls: string[] = [];
  try {
    await geocodeCity("Atlantis", options(fakeFetch({ [NOMINATIM]: jsonReply([]), [PHOTON]: jsonReply({ features: [photonFeature({})] }) }, calls)));
    throw new Error("hätte scheitern müssen");
  } catch (error) {
    if (!(error instanceof GeocodeError)) throw error;
    eq(error.code, "city_not_found");
    eq(calls.length, 1, "kein Ersatz bei einer klaren Antwort");
  }
});

Deno.test("Nominatim ausgefallen: Stadt aus der Datenbank, Photon wird nicht gefragt", async () => {
  const calls: string[] = [];
  const known: GeocodeResult = { name: "Leipzig", osmType: "relation", osmId: 62649, lat: 51.34, lon: 12.37, radiusM: DEFAULT_RADIUS_M };
  const found = await geocodeCity("leipzig", options(fakeFetch({ [NOMINATIM]: jsonReply({}, 503), [PHOTON]: "network" }, calls), {
    knownRegion: () => Promise.resolve(known),
  }));
  eq(found.source, "db");
  eq(found.result, known);
  eq(found.attempts.map((a) => `${a.host}:${a.result}`), ["nominatim.example:busy", "db:ok"]);
  eq(calls.length, 1);
});

Deno.test("Nominatim ausgefallen, Stadt neu: Photon findet sie (Akzeptanz O2)", async () => {
  for (const down of ["network", "timeout", jsonReply({}, 429), jsonReply({}, 500), new Response("<html>", { status: 200 })] as Reply[]) {
    const calls: string[] = [];
    const found = await geocodeCity("Berlin", options(fakeFetch({ [NOMINATIM]: down, [PHOTON]: jsonReply({ features: [photonFeature({})] }) }, calls), {
      knownRegion: () => Promise.reject(new Error("Datenbank weg")),
    }));
    eq(found.source, "photon");
    eq([found.result.name, found.result.osmType, found.result.radiusM], ["Berlin", "node", CITY_RADIUS_M]);
    eq(found.attempts.length, 2);
    eq(found.attempts[1].host, "photon.example");
    const url = new URL(calls[1]);
    eq([url.pathname, url.searchParams.get("q"), url.searchParams.get("osm_tag"), url.searchParams.get("lang")], ["/api", "Berlin", "place", "de"]);
    eq(url.searchParams.get("bbox")?.split(",").length, 4, "auf Deutschland begrenzt");
  }
});

Deno.test("Nominatim ausgefallen, Photon kennt die Stadt nicht: nicht gefunden", async () => {
  try {
    await geocodeCity("Atlantis", options(fakeFetch({ [NOMINATIM]: "network", [PHOTON]: jsonReply({ features: [photonFeature({ countrycode: "FR" })] }) }, [])));
    throw new Error("hätte scheitern müssen");
  } catch (error) {
    if (!(error instanceof GeocodeError)) throw error;
    eq(error.code, "city_not_found");
    eq(error.attempts.map((a) => a.result), ["unavailable", "ok"]);
  }
});

Deno.test("Beide ausgefallen: überlastet bzw. nicht erreichbar", async () => {
  const fail = async (nominatim: Reply, photon: Reply) => {
    try {
      await geocodeCity("Leipzig", options(fakeFetch({ [NOMINATIM]: nominatim, [PHOTON]: photon }, [])));
    } catch (error) {
      if (error instanceof GeocodeError) return `${error.code}|${error.attempts.map((a) => a.result).join(",")}`;
      throw error;
    }
    return "gefunden";
  };
  eq(await fail(jsonReply({}, 429), "network"), "osm_busy|busy,unavailable");
  eq(await fail("network", jsonReply({}, 502)), "osm_unavailable|unavailable,unavailable");
  eq(await fail("network", jsonReply({ type: "FeatureCollection" })), "osm_unavailable|unavailable,unavailable", "Photon ohne features ist unbrauchbar");
});

Deno.test("Photon abgeschaltet: nur Nominatim", async () => {
  const calls: string[] = [];
  try {
    await geocodeCity("Leipzig", options(fakeFetch({ [NOMINATIM]: "timeout" }, calls), { photon: null }));
    throw new Error("hätte scheitern müssen");
  } catch (error) {
    if (!(error instanceof GeocodeError)) throw error;
    eq(error.code, "osm_busy");
    eq(calls.length, 1);
  }
});
