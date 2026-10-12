/**
 * OpenStreetMap → AFTERHOURS: Abfrage bauen, Objekte einordnen, Öffnungszeiten übersetzen.
 * Reiner Code ohne Netzwerkzugriff – getestet in osm.test.ts.
 *
 * Grundsatz: Es wird nur übernommen, was in OSM steht. Fehlt eine Angabe (Preis, Dauer, Gruppengröße,
 * Bewertung), bleibt sie leer und die App zeigt "unbekannt". Lassen sich Öffnungszeiten nicht sicher
 * übersetzen, wird nur der Originaltext gespeichert und als solcher angezeigt.
 */

export type Category =
  | "restaurant" | "cafe" | "bar" | "cinema" | "bowling" | "minigolf" | "swimming" | "lasertag"
  | "escape_room" | "karting" | "sport" | "outdoor" | "concert" | "event" | "trip" | "other";
export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type OpeningHours = Partial<Record<Weekday, [string, string][]>>;

export interface OsmElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface Place {
  external_id: string;
  name: string;
  category: Category;
  description: string | null;
  address: string | null;
  latitude: number;
  longitude: number;
  opening_hours: OpeningHours | null;
  opening_hours_raw: string | null;
  website_url: string | null;
  phone: string | null;
  setting: "indoor" | "outdoor" | null;
  source_url: string;
  quality: number;
}

// ---------------------------------------------------------------------------------------------
// Overpass-Abfrage
// ---------------------------------------------------------------------------------------------
export type SearchArea = { kind: "area"; osmType: "relation" | "way"; osmId: number } | { kind: "around"; lat: number; lon: number; radiusM: number };

/** Overpass-Area-IDs: Relation + 3 600 000 000, Way + 2 400 000 000. */
export function overpassAreaId(osmType: "relation" | "way", osmId: number): number {
  return (osmType === "relation" ? 3_600_000_000 : 2_400_000_000) + osmId;
}

export function buildOverpassQuery(area: SearchArea, timeoutSeconds = 90): string {
  const scope = area.kind === "area" ? "(area.a)" : `(around:${Math.round(area.radiusM)},${area.lat.toFixed(6)},${area.lon.toFixed(6)})`;
  const head = area.kind === "area" ? `area(id:${overpassAreaId(area.osmType, area.osmId)})->.a;\n` : "";
  return [
    `[out:json][timeout:${timeoutSeconds}];`,
    `${head}(`,
    `  nwr["amenity"~"^(restaurant|cafe|bar|pub|biergarten|nightclub|cinema|theatre|music_venue|public_bath)$"]["name"]${scope};`,
    `  nwr["leisure"~"^(bowling_alley|miniature_golf|escape_game|water_park|trampoline_park|amusement_arcade|ice_rink)$"]["name"]${scope};`,
    `  nwr["leisure"="sports_centre"]["sport"~"swimming|climbing|karting|laser_tag|10pin|bowling|trampoline"]["name"]${scope};`,
    `  nwr["sport"~"^(karting|laser_tag)$"]["name"]${scope};`,
    `  nwr["tourism"~"^(zoo|theme_park|museum|aquarium)$"]["name"]${scope};`,
    ");",
    "out center;",
  ].join("\n");
}

// ---------------------------------------------------------------------------------------------
// Einordnung
// ---------------------------------------------------------------------------------------------
const list = (value: string | undefined) => (value ?? "").split(";").map((v) => v.trim().toLowerCase()).filter(Boolean);

export function categorize(tags: Record<string, string>): Category | null {
  const amenity = tags.amenity;
  const leisure = tags.leisure;
  const tourism = tags.tourism;
  const sport = list(tags.sport);

  if (leisure === "escape_game") return "escape_room";
  if (sport.includes("laser_tag")) return "lasertag";
  if (sport.includes("karting")) return "karting";
  if (leisure === "bowling_alley" || (leisure === "sports_centre" && (sport.includes("10pin") || sport.includes("bowling")))) return "bowling";
  if (leisure === "miniature_golf") return "minigolf";
  if (amenity === "cinema") return "cinema";
  if (leisure === "water_park" || amenity === "public_bath" || (leisure === "sports_centre" && sport.includes("swimming"))) return "swimming";
  if (leisure === "trampoline_park" || leisure === "ice_rink" || (leisure === "sports_centre" && (sport.includes("climbing") || sport.includes("trampoline")))) return "sport";
  if (amenity === "theatre") return "event";
  if (amenity === "music_venue") return "concert";
  if (amenity === "bar" || amenity === "pub" || amenity === "biergarten" || amenity === "nightclub") return "bar";
  if (amenity === "cafe") return "cafe";
  if (amenity === "restaurant") return "restaurant";
  if (tourism === "zoo" || tourism === "theme_park") return "outdoor";
  if (tourism === "museum" || tourism === "aquarium" || leisure === "amusement_arcade") return "other";
  return null;
}

/** Drinnen/draußen nur, wenn es sich aus der Art des Ortes oder ausdrücklichen Angaben ergibt. */
export function settingOf(tags: Record<string, string>, category: Category): "indoor" | "outdoor" | null {
  if (tags.indoor === "yes" || tags.covered === "yes") return "indoor";
  if (tags.indoor === "no") return "outdoor";
  if (category === "cinema") return tags["cinema:type"] === "open_air" || tags.open_air === "yes" ? "outdoor" : "indoor";
  if (["bowling", "escape_room", "lasertag", "event"].includes(category)) return "indoor";
  if (tags.tourism === "museum" || tags.tourism === "aquarium" || tags.leisure === "amusement_arcade") return "indoor";
  if (tags.amenity === "biergarten" || tags.tourism === "zoo" || tags.tourism === "theme_park") return "outdoor";
  return null;
}

const CUISINE: Record<string, string> = {
  italian: "Italienisch", pizza: "Pizza", german: "Deutsch", regional: "Regional", bavarian: "Bayerisch",
  asian: "Asiatisch", chinese: "Chinesisch", japanese: "Japanisch", sushi: "Sushi", vietnamese: "Vietnamesisch",
  thai: "Thailändisch", indian: "Indisch", turkish: "Türkisch", kebab: "Döner/Kebab", greek: "Griechisch",
  burger: "Burger", mexican: "Mexikanisch", spanish: "Spanisch", tapas: "Tapas", french: "Französisch",
  american: "Amerikanisch", steak_house: "Steakhaus", korean: "Koreanisch", lebanese: "Libanesisch",
  arab: "Arabisch", syrian: "Syrisch", persian: "Persisch", ethiopian: "Äthiopisch", african: "Afrikanisch",
  seafood: "Fisch & Meeresfrüchte", fish: "Fisch", coffee_shop: "Kaffee", cake: "Kuchen", ice_cream: "Eis",
  breakfast: "Frühstück", bagel: "Bagels", noodle: "Nudeln", ramen: "Ramen", balkan: "Balkan", polish: "Polnisch",
  russian: "Russisch", portuguese: "Portugiesisch", georgian: "Georgisch", austrian: "Österreichisch",
  mediterranean: "Mediterran", international: "International", vegan: "Vegan", vegetarian: "Vegetarisch",
  falafel: "Falafel", sandwich: "Sandwiches", crepe: "Crêpes", waffle: "Waffeln", brunch: "Brunch",
};

const SPORT: Record<string, string> = { climbing: "Klettern/Bouldern", trampoline: "Trampolin", swimming: "Schwimmen", ice_skating: "Eislaufen" };

export function describe(tags: Record<string, string>): string | null {
  const parts: string[] = [];
  const own = tags["description:de"] ?? tags.description;
  if (own && own.trim().length >= 3 && own.length <= 300) parts.push(own.trim().replace(/[.!]?$/, "."));
  const cuisine = [...new Set(list(tags.cuisine).map((c) => CUISINE[c]).filter(Boolean))];
  if (cuisine.length > 0) parts.push(`Küche: ${cuisine.slice(0, 4).join(", ")}.`);
  const sports = [...new Set(list(tags.sport).map((s) => SPORT[s]).filter(Boolean))];
  if (sports.length > 0) parts.push(`${sports.join(", ")}.`);
  if (tags["diet:vegan"] === "only") parts.push("Rein vegan.");
  else if (tags["diet:vegan"] === "yes") parts.push("Vegane Gerichte.");
  if (tags.outdoor_seating === "yes") parts.push("Außenplätze.");
  if (tags.wheelchair === "yes") parts.push("Rollstuhlgerecht.");
  else if (tags.wheelchair === "limited") parts.push("Eingeschränkt rollstuhlgerecht.");
  return parts.length > 0 ? parts.join(" ") : null;
}

function addressOf(tags: Record<string, string>, regionName: string): string | null {
  const street = tags["addr:street"] ?? tags["addr:place"];
  if (!street) return null;
  const line1 = [street, tags["addr:housenumber"]].filter(Boolean).join(" ");
  const city = tags["addr:city"] ?? regionName;
  const line2 = [tags["addr:postcode"], city].filter(Boolean).join(" ");
  return `${line1}, ${line2}`.slice(0, 200);
}

function websiteOf(tags: Record<string, string>): string | null {
  const raw = (tags.website ?? tags["contact:website"] ?? tags.url ?? "").split(";")[0]?.trim() ?? "";
  if (!/^https:\/\/[^\s]+$/i.test(raw) || raw.length > 500) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function phoneOf(tags: Record<string, string>): string | null {
  const raw = (tags.phone ?? tags["contact:phone"] ?? "").split(";")[0]?.trim() ?? "";
  return /^[+0-9 ()/-]{5,40}$/.test(raw) ? raw : null;
}

// ---------------------------------------------------------------------------------------------
// Öffnungszeiten (Teilmenge der OSM-Syntax; alles andere bleibt Originaltext)
// ---------------------------------------------------------------------------------------------
const DAY_TOKENS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;
const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY = "(?:Mo|Tu|We|Th|Fr|Sa|Su)";
const DAY_SPEC = new RegExp(`^(${DAY}(?:\\s*-\\s*${DAY})?(?:\\s*,\\s*${DAY}(?:\\s*-\\s*${DAY})?)*)(?:\\s+|$)`);
const UNSUPPORTED = /[\[\]"+?]|\b(?:PH|SH|sunrise|sunset|dawn|dusk|week|easter|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b|\|\|/;

const pad = (n: number) => String(n).padStart(2, "0");

function expandDays(spec: string): number[] {
  const days = new Set<number>();
  for (const part of spec.split(",")) {
    const [from, to] = part.split("-").map((d) => DAY_TOKENS.indexOf(d.trim() as (typeof DAY_TOKENS)[number]));
    if (from === undefined || from < 0) return [];
    if (to === undefined) {
      days.add(from);
      continue;
    }
    if (to < 0) return [];
    for (let d = from; ; d = (d + 1) % 7) {
      days.add(d);
      if (d === to) break;
    }
  }
  return [...days];
}

function parseIntervals(text: string): [string, string][] | null {
  const intervals: [string, string][] = [];
  for (const part of text.split(/\s*,\s*/)) {
    const m = part.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const [sh, sm, eh, em] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    if (sh > 23 || sm > 59 || em > 59 || eh > 48) return null;
    let end = eh * 60 + em;
    const start = sh * 60 + sm;
    if (end > 24 * 60) end -= 24 * 60;
    if (end === start) return null;
    const endText = end === 24 * 60 ? "24:00" : `${pad(Math.floor(end / 60))}:${pad(end % 60)}`;
    intervals.push([`${pad(sh)}:${pad(sm)}`, endText]);
  }
  return intervals;
}

function parseRule(rule: string): { days: number[]; intervals: [string, string][] | "off" } | null {
  const match = rule.match(DAY_SPEC);
  const days = match ? expandDays(match[1] ?? "") : [0, 1, 2, 3, 4, 5, 6];
  if (days.length === 0) return null;
  const rest = (match ? rule.slice(match[0].length) : rule).trim();
  if (/^(off|closed)$/i.test(rest)) return { days, intervals: "off" };
  if (rest === "") return null;
  const intervals = parseIntervals(rest);
  return intervals ? { days, intervals } : null;
}

export function parseOpeningHours(raw: string | undefined | null): OpeningHours | null {
  const text = (raw ?? "").trim();
  if (text === "" || text.length > 255) return null;
  if (text === "24/7") return Object.fromEntries(WEEKDAYS.map((d) => [d, [["00:00", "24:00"]]])) as OpeningHours;
  // Feiertage bildet die App nicht ab: Feiertagsregeln entfallen, "Su,PH" wird zu "Su".
  const normalized = text.replace(/\s*,\s*PH\b/g, "").replace(/\bPH\s*,\s*/g, "");
  const rules = normalized.split(";").map((r) => r.trim()).filter((r) => r !== "" && !/^PH\b/.test(r));
  if (rules.some((r) => UNSUPPORTED.test(r))) return null;

  const result = new Map<number, [string, string][]>();
  for (const rule of rules) {
    // "Mo-Fr 10:00-18:00, Sa 10:00-14:00" – ein Komma vor einer Tagesangabe ergänzt statt zu ersetzen.
    const parts = rule.split(new RegExp(`(?<=\\d),\\s*(?=${DAY}\\b)`));
    for (const [index, part] of parts.entries()) {
      const parsed = parseRule(part.trim());
      if (!parsed) return null;
      for (const day of parsed.days) {
        if (parsed.intervals === "off") result.set(day, []);
        else result.set(day, index === 0 ? [...parsed.intervals] : [...(result.get(day) ?? []), ...parsed.intervals]);
      }
    }
  }
  const hours: OpeningHours = {};
  for (const [day, intervals] of [...result.entries()].sort((a, b) => a[0] - b[0])) {
    if (intervals.length > 0) hours[WEEKDAYS[day] as Weekday] = intervals.sort((a, b) => a[0].localeCompare(b[0]));
  }
  return Object.keys(hours).length > 0 ? hours : null;
}

// ---------------------------------------------------------------------------------------------
// Element → Ort
// ---------------------------------------------------------------------------------------------
export function toPlace(element: OsmElement, regionName: string): Place | null {
  const tags = element.tags ?? {};
  const name = (tags.name ?? "").replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 120) return null;
  if (tags.access === "private" || tags.access === "no") return null;
  const rawHours = tags.opening_hours?.trim() || null;
  if (rawHours && /^(closed|off)$/i.test(rawHours)) return null;
  const category = categorize(tags);
  if (!category) return null;
  const latitude = element.lat ?? element.center?.lat;
  const longitude = element.lon ?? element.center?.lon;
  if (latitude == null || longitude == null) return null;

  const openingHours = parseOpeningHours(rawHours);
  const description = describe(tags);
  const address = addressOf(tags, regionName);
  const website = websiteOf(tags);
  const phone = phoneOf(tags);
  const quality = (openingHours ? 4 : rawHours ? 1 : 0) + (website ? 2 : 0) + (address ? 2 : 0) + (phone ? 1 : 0) + (description ? 1 : 0);

  return {
    external_id: `${element.type}/${element.id}`,
    name,
    category,
    description,
    address,
    latitude: Math.round(latitude * 1e6) / 1e6,
    longitude: Math.round(longitude * 1e6) / 1e6,
    opening_hours: openingHours,
    opening_hours_raw: rawHours ? rawHours.slice(0, 255) : null,
    website_url: website,
    phone,
    setting: settingOf(tags, category),
    source_url: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    quality,
  };
}

const metersBetween = (a: Place, b: Place) => {
  const dLat = (a.latitude - b.latitude) * 111_320;
  const dLon = (a.longitude - b.longitude) * 111_320 * Math.cos((a.latitude * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
};

/**
 * Wandelt alle Elemente um und entfernt Dubletten (derselbe Ort als Punkt und als Gebäude erfasst:
 * gleicher Name, gleiche Kategorie, weniger als 75 m entfernt – der vollständigere Eintrag bleibt).
 */
export function selectPlaces(elements: OsmElement[], regionName: string, max = 15_000): Place[] {
  const places = elements.map((e) => toPlace(e, regionName)).filter((p): p is Place => p !== null);
  places.sort((a, b) => b.quality - a.quality || a.external_id.localeCompare(b.external_id));
  const kept: Place[] = [];
  const byKey = new Map<string, Place[]>();
  for (const place of places) {
    const key = `${place.category}|${place.name.toLocaleLowerCase("de")}`;
    const same = byKey.get(key) ?? [];
    if (same.some((other) => metersBetween(other, place) < 75)) continue;
    same.push(place);
    byKey.set(key, same);
    kept.push(place);
    if (kept.length >= max) break;
  }
  return kept;
}
