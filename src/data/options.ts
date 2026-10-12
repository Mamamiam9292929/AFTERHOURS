import type { ActivityCategory, Interest } from "@/lib/types";

export const INTERESTS: Interest[] = ["food", "sport", "cinema", "outdoor", "nightlife", "music", "gaming", "adventure", "culture", "relax"];

export const CATEGORIES: ActivityCategory[] = [
  "restaurant", "cafe", "bar", "cinema", "bowling", "minigolf", "swimming", "lasertag",
  "escape_room", "karting", "sport", "outdoor", "concert", "event", "trip", "other",
];

/** Welche Kategorien zu einem Interesse passen – für Vorschläge auf Home. */
export const INTEREST_CATEGORIES: Record<Interest, ActivityCategory[]> = {
  food: ["restaurant", "cafe"],
  sport: ["sport", "swimming", "bowling", "karting"],
  cinema: ["cinema", "event"],
  outdoor: ["outdoor", "trip", "minigolf"],
  nightlife: ["bar", "concert"],
  music: ["concert", "event"],
  gaming: ["lasertag", "escape_room", "other", "bowling"],
  adventure: ["escape_room", "lasertag", "karting", "trip"],
  culture: ["event", "cinema", "concert"],
  relax: ["cafe", "swimming", "other"],
};

export const CREW_EMOJIS = ["🌙", "🎳", "🍕", "🎬", "⚽", "🏋️", "🎮", "🏖️", "🎉", "🍻", "☕", "🎤", "🚲", "🧗", "🎲", "🏕️", "👨‍👩‍👧‍👦", "🎓", "💼", "✈️"];
