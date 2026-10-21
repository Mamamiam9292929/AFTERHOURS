/**
 * S4 Etappe 2 · „Jetzt offen“ für eine Runde, die steht. Reine Logik ohne React und ohne Zeitzonen-
 * Rechnung (per `node --test` geprüft): Den Öffnungsstand je Ort liefert `openStateAt` (src/lib/hours.ts),
 * hier wird nur ausgewählt und sortiert.
 *
 * Ehrlichkeit: Ein Ort gilt nur als offen, wenn seine Öffnungszeiten aus OpenStreetMap das sagen.
 * Reicht das nicht, kommen Orte mit unbekannten Öffnungszeiten dazu – ausdrücklich als „unbekannt“.
 * Geschlossene Orte und solche, die gleich schließen, erscheinen nie.
 */

export type OpenNowState =
  | { state: "unknown" }
  | { state: "open"; closesAt: string }
  | { state: "closed"; opensAt: string | null; opensDay: string | null };

export interface OpenNowCandidate<A> {
  activity: A;
  state: OpenNowState;
}

export interface OpenNowPlace<A> {
  activity: A;
  closesAt: string;
  /** Minuten bis zur Schließung (über Mitternacht weitergezählt). */
  minutesLeft: number;
}

export interface OpenNowPick<A> {
  open: OpenNowPlace<A>[];
  unknown: A[];
}

/** Wer jetzt losgeht, braucht noch etwas Zeit vor Ort. */
export const MIN_OPEN_MINUTES = 60;

/** Kategorien, in die man spontan am selben Abend geht – in dieser Reihenfolge, wenn nichts anderes passt. */
export const EVENING_CATEGORIES = ["bar", "restaurant", "cinema", "bowling", "concert", "event", "cafe", "minigolf", "lasertag", "escape_room", "karting", "swimming", "sport"] as const;

/**
 * Stichwort der Frage → passende Kategorien („Bier im Park“ → Bars zuerst). Bewusst klein und
 * vorhersehbar; ein Wort trifft, wenn es mit dem Schlüssel beginnt („Kinoabend“ → Kino).
 */
const NOTE_CATEGORIES: [string, string[]][] = [
  ["kino", ["cinema"]],
  ["film", ["cinema"]],
  ["movie", ["cinema"]],
  ["bier", ["bar"]],
  ["bar", ["bar"]],
  ["kneipe", ["bar"]],
  ["drink", ["bar"]],
  ["trinken", ["bar"]],
  ["cocktail", ["bar"]],
  ["wein", ["bar", "restaurant"]],
  ["karaoke", ["bar"]],
  ["feiern", ["bar", "concert"]],
  ["tanzen", ["bar", "concert"]],
  ["club", ["bar", "concert"]],
  ["essen", ["restaurant"]],
  ["pizza", ["restaurant"]],
  ["burger", ["restaurant"]],
  ["döner", ["restaurant"]],
  ["doener", ["restaurant"]],
  ["sushi", ["restaurant"]],
  ["pasta", ["restaurant"]],
  ["ramen", ["restaurant"]],
  ["dinner", ["restaurant"]],
  ["abendessen", ["restaurant"]],
  ["kaffee", ["cafe"]],
  ["café", ["cafe"]],
  ["cafe", ["cafe"]],
  ["kuchen", ["cafe"]],
  ["eis", ["cafe"]],
  ["bowling", ["bowling"]],
  ["kegeln", ["bowling"]],
  ["minigolf", ["minigolf"]],
  ["lasertag", ["lasertag"]],
  ["escape", ["escape_room"]],
  ["kart", ["karting"]],
  ["konzert", ["concert"]],
  ["live", ["concert"]],
  ["schwimmen", ["swimming"]],
  ["sauna", ["swimming"]],
  ["sport", ["sport"]],
  ["klettern", ["sport"]],
  ["bouldern", ["sport"]],
];

/** Kategorien, die zum Stichwort passen (Reihenfolge wie im Stichwort). Leer, wenn nichts passt. */
export function noteCategories(note: string | null | undefined): string[] {
  if (!note) return [];
  const words = note.toLocaleLowerCase("de-DE").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const found: string[] = [];
  for (const word of words) {
    for (const [key, categories] of NOTE_CATEGORIES) {
      if (!word.startsWith(key)) continue;
      for (const category of categories) if (!found.includes(category)) found.push(category);
    }
  }
  return found;
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Minuten von jetzt (Minuten seit Mitternacht, Berliner Zeit) bis „HH:MM“ – liegt die Zeit davor, ist es nach Mitternacht. */
export function minutesUntil(closesAt: string, nowMinutes: number): number {
  const end = toMinutes(closesAt);
  return end > nowMinutes ? end - nowMinutes : end + 24 * 60 - nowMinutes;
}

/**
 * Wählt bis zu `limit` Orte für jetzt: zuerst offene (mindestens `minOpenMinutes` noch offen), passend
 * zum Stichwort, dann Abend-Kategorien; je Kategorie erst einer, damit es eine echte Wahl ist. Fehlen
 * offene, füllen Orte mit unbekannten Öffnungszeiten auf. Die Reihenfolge des Servers (vollständigste
 * Einträge zuerst) bleibt innerhalb einer Stufe erhalten.
 */
export function pickOpenNow<A extends { id: string; category: string }>(
  candidates: readonly OpenNowCandidate<A>[],
  nowMinutes: number,
  { note = null, limit = 3, minOpenMinutes = MIN_OPEN_MINUTES }: { note?: string | null; limit?: number; minOpenMinutes?: number } = {},
): OpenNowPick<A> {
  const wanted = noteCategories(note);
  const evening = EVENING_CATEGORIES as readonly string[];
  const rank = (category: string) => {
    const w = wanted.indexOf(category);
    if (w >= 0) return w;
    const e = evening.indexOf(category);
    return e >= 0 ? wanted.length + e : Infinity;
  };
  const byRank = <T extends { activity: A }>(list: T[]) =>
    list
      .map((item, index) => ({ item, index, rank: rank(item.activity.category) }))
      .filter((x) => Number.isFinite(x.rank))
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .map((x) => x.item);
  /** Erst je Kategorie einer, dann der Rest – in Rangfolge. */
  const varied = <T extends { activity: A }>(list: T[]) => {
    const seen = new Set<string>();
    const first: T[] = [];
    const rest: T[] = [];
    for (const item of list) {
      if (seen.has(item.activity.category)) rest.push(item);
      else {
        seen.add(item.activity.category);
        first.push(item);
      }
    }
    return [...first, ...rest];
  };

  const open: OpenNowPlace<A>[] = [];
  const unknown: { activity: A }[] = [];
  for (const { activity, state } of candidates) {
    if (state.state === "open") {
      const minutesLeft = minutesUntil(state.closesAt, nowMinutes);
      if (minutesLeft >= minOpenMinutes) open.push({ activity, closesAt: state.closesAt, minutesLeft });
    } else if (state.state === "unknown") {
      unknown.push({ activity });
    }
  }
  const pickedOpen = varied(byRank(open)).slice(0, limit);
  const pickedUnknown = varied(byRank(unknown))
    .slice(0, Math.max(0, limit - pickedOpen.length))
    .map((x) => x.activity);
  return { open: pickedOpen, unknown: pickedUnknown };
}
