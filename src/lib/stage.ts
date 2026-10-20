import type { Activity, ActivityCategory } from "./types";

/**
 * Discover-Stapel (V2 Etappe 3a): Welche Orte liegen oben auf dem Stapel und in welcher Reihenfolge?
 * Zuerst Orte, die laut bekannten Öffnungszeiten jetzt offen haben, dann die näheren. Ohne beides bleibt
 * die Reihenfolge der Suche – nichts wird geraten. Ob ein Ort offen hat, entscheidet der Aufrufer
 * (`openStateAt` in `hours.ts`), damit diese Datei ohne Laufzeit-Importe testbar bleibt.
 */
export interface Ranked {
  activity: Activity;
  distanceKm: number | null;
}

/** So viele Orte liegen höchstens im Stapel; alle übrigen stehen ohnehin darunter in der Liste. */
export const DECK_SIZE = 6;

export function rankStage<T extends Ranked>(results: readonly T[], isOpen: (activity: Activity) => boolean, size: number = DECK_SIZE): T[] {
  return results
    .map((result, index) => ({ result, index, score: (isOpen(result.activity) ? 1000 : 0) - (result.distanceKm ?? 500) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(0, size))
    .map((entry) => entry.result);
}

/** Blättern im Stapel mit Umlauf: nach dem letzten Ort kommt wieder der erste (und umgekehrt). */
export function stepDeck(index: number, length: number, step: number): number {
  if (length <= 0) return 0;
  return (((index + step) % length) + length) % length;
}

/**
 * Farbwelt je Kategorie: zwei Lichtfarben für den Hintergrund der Kategorie-Grafik. Nur die Farben aus
 * dem Design (Violett, Pink, Lime, Amber) – als Licht, nie als Textfarbe.
 */
export type CategoryWorld = "food" | "night" | "play" | "outside";

const WORLDS: Record<ActivityCategory, CategoryWorld> = {
  restaurant: "food",
  cafe: "food",
  bar: "night",
  concert: "night",
  event: "night",
  cinema: "play",
  bowling: "play",
  minigolf: "play",
  lasertag: "play",
  escape_room: "play",
  karting: "play",
  sport: "outside",
  swimming: "outside",
  outdoor: "outside",
  trip: "outside",
  other: "night",
};

export function categoryWorld(category: ActivityCategory): CategoryWorld {
  return WORLDS[category] ?? "night";
}
