import type { LatLng } from "@/lib/geo";

/**
 * Mittelpunkte deutscher Großstädte. Dient dazu, aus der im Profil angegebenen Stadt eine grobe
 * Entfernung zu berechnen – ganz ohne Gerätestandort. Für andere Orte bleibt die Entfernung unbekannt.
 */
export const CITIES: Record<string, LatLng> = {
  Aachen: { latitude: 50.7753, longitude: 6.0839 },
  Augsburg: { latitude: 48.3705, longitude: 10.8978 },
  Berlin: { latitude: 52.52, longitude: 13.405 },
  Bielefeld: { latitude: 52.0302, longitude: 8.5325 },
  Bochum: { latitude: 51.4818, longitude: 7.2162 },
  Bonn: { latitude: 50.7374, longitude: 7.0982 },
  Braunschweig: { latitude: 52.2689, longitude: 10.5268 },
  Bremen: { latitude: 53.0793, longitude: 8.8017 },
  Chemnitz: { latitude: 50.8278, longitude: 12.9214 },
  Dortmund: { latitude: 51.5136, longitude: 7.4653 },
  Dresden: { latitude: 51.0504, longitude: 13.7373 },
  Duisburg: { latitude: 51.4344, longitude: 6.7623 },
  Düsseldorf: { latitude: 51.2277, longitude: 6.7735 },
  Erfurt: { latitude: 50.9848, longitude: 11.0299 },
  Essen: { latitude: 51.4556, longitude: 7.0116 },
  "Frankfurt am Main": { latitude: 50.1109, longitude: 8.6821 },
  "Freiburg im Breisgau": { latitude: 47.999, longitude: 7.8421 },
  Gelsenkirchen: { latitude: 51.5177, longitude: 7.0857 },
  Halle: { latitude: 51.4969, longitude: 11.9688 },
  Hamburg: { latitude: 53.5511, longitude: 9.9937 },
  Hannover: { latitude: 52.3759, longitude: 9.732 },
  Karlsruhe: { latitude: 49.0069, longitude: 8.4037 },
  Kassel: { latitude: 51.3127, longitude: 9.4797 },
  Kiel: { latitude: 54.3233, longitude: 10.1228 },
  Köln: { latitude: 50.9375, longitude: 6.9603 },
  Krefeld: { latitude: 51.3388, longitude: 6.5853 },
  Leipzig: { latitude: 51.3397, longitude: 12.3731 },
  Lübeck: { latitude: 53.8655, longitude: 10.6866 },
  Magdeburg: { latitude: 52.1205, longitude: 11.6276 },
  Mainz: { latitude: 49.9929, longitude: 8.2473 },
  Mannheim: { latitude: 49.4875, longitude: 8.466 },
  Mönchengladbach: { latitude: 51.1805, longitude: 6.4428 },
  München: { latitude: 48.1372, longitude: 11.5756 },
  Münster: { latitude: 51.9607, longitude: 7.6261 },
  Nürnberg: { latitude: 49.4521, longitude: 11.0767 },
  Potsdam: { latitude: 52.3906, longitude: 13.0645 },
  Rostock: { latitude: 54.0924, longitude: 12.0991 },
  Saarbrücken: { latitude: 49.2402, longitude: 6.9969 },
  Stuttgart: { latitude: 48.7758, longitude: 9.1829 },
  Wiesbaden: { latitude: 50.0782, longitude: 8.2398 },
  Wuppertal: { latitude: 51.2562, longitude: 7.1508 },
};

export const CITY_NAMES = Object.keys(CITIES);

export function cityCenter(city: string | null | undefined): LatLng | null {
  if (!city) return null;
  const wanted = city.trim().toLocaleLowerCase("de");
  const match = CITY_NAMES.find((name) => name.toLocaleLowerCase("de") === wanted);
  return match ? (CITIES[match] ?? null) : null;
}
