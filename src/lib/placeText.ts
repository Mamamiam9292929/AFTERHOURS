/**
 * P11 Etappe 2f · Beschreibung eines Ortes in der Sprache der Oberfläche.
 *
 * Der Import aus OpenStreetMap speichert neben dem deutschen Satz (`description`) die Merkmale (`features`):
 * Küche und Sport als OSM-Schlüssel, vegan, Außenplätze, Rollstuhl und die eigene Beschreibung aus OSM
 * (`about_de` aus `description:de`/`description`, `about_en` nur aus `description:en`). Hier entsteht daraus der
 * Satz – auf Deutsch genau wie `describe` in supabase/functions/places/osm.ts.
 *
 * Rückfall: Orte ohne Merkmale zeigen `description` – außer OSM-Orte auf Englisch, deren gespeicherter Satz
 * deutsch ist (noch nicht neu importiert); dort steht keine Beschreibung statt einer deutschen.
 * Orte von Hand oder als Demo behalten ihren Text, wie er eingetragen wurde.
 *
 * Ohne Importe (Texte kommen als `labels` aus dem Wörterbuch), damit Unit-Tests die Datei direkt laden können.
 */

type Locale = "de" | "en";

export interface PlaceFeatures {
  cuisine?: string[];
  sport?: string[];
  vegan?: "only" | "yes";
  outdoor_seating?: boolean;
  wheelchair?: "yes" | "limited";
  about_de?: string;
  about_en?: string;
}

export interface PlaceFeatureLabels {
  cuisine: (list: string) => string;
  cuisines: Record<string, string>;
  sports: Record<string, string>;
  veganOnly: string;
  veganYes: string;
  outdoorSeating: string;
  wheelchairYes: string;
  wheelchairLimited: string;
}

interface PlaceLike {
  provider_id: string;
  description: string | null;
  features?: PlaceFeatures | null;
}

const words = (keys: unknown, map: Record<string, string>): string[] =>
  Array.isArray(keys) ? [...new Set(keys.map((k) => (typeof k === "string" && Object.hasOwn(map, k) ? map[k] : null)).filter((w): w is string => Boolean(w)))] : [];

/** Satz aus den Merkmalen; null, wenn nichts davon bekannt ist. */
export function describeFeatures(features: PlaceFeatures, locale: Locale, labels: PlaceFeatureLabels): string | null {
  const parts: string[] = [];
  const about = locale === "en" ? features.about_en : features.about_de;
  if (typeof about === "string" && about.trim()) parts.push(about.trim().replace(/[.!]?$/, "."));
  const cuisine = words(features.cuisine, labels.cuisines);
  if (cuisine.length > 0) parts.push(labels.cuisine(cuisine.slice(0, 4).join(", ")));
  const sports = words(features.sport, labels.sports);
  if (sports.length > 0) parts.push(`${sports.join(", ")}.`);
  if (features.vegan === "only") parts.push(labels.veganOnly);
  else if (features.vegan === "yes") parts.push(labels.veganYes);
  if (features.outdoor_seating === true) parts.push(labels.outdoorSeating);
  if (features.wheelchair === "yes") parts.push(labels.wheelchairYes);
  else if (features.wheelchair === "limited") parts.push(labels.wheelchairLimited);
  return parts.length > 0 ? parts.join(" ") : null;
}

/** Beschreibung, die die Seite eines Ortes zeigt (oder null). */
export function placeDescription(place: PlaceLike, locale: Locale, labels: PlaceFeatureLabels): string | null {
  const features = place.features;
  if (features && typeof features === "object" && !Array.isArray(features)) return describeFeatures(features, locale, labels);
  if (locale === "en" && place.provider_id === "osm") return null;
  return place.description;
}
