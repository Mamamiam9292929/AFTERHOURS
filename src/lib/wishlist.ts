/**
 * P22 · „Wollen wir mal hin“ – Merkliste der Crew. Reine Logik (ohne React), damit sie per Unit-Test
 * geprüft werden kann: welche Orte aus der Liste in eine neue Abstimmung kommen.
 */
import type { ActivityCategory } from "./types";

/** Eine Zeile aus `crew_wishes` (neueste zuerst). */
export interface CrewWish {
  activity_id: string;
  /** Wer gemerkt hat – `null`, wenn die Person nicht mehr in der Crew ist. */
  added_by: string | null;
  created_at: string;
  name: string;
  category: ActivityCategory;
  city: string | null;
  is_demo: boolean;
  price_min_cents: number | null;
  price_max_cents: number | null;
  can_remove: boolean;
}

/** Vorgemerkte Option wie im Sammelkorb für Abstimmungen (`DraftItem`). */
export interface WishPollItem {
  activityId: string;
  title: string;
  priceCents: number | null;
}

/** Typischer Preis pro Person wie in Discover: Mitte der Spanne auf ganze Euro, sonst der eine Wert. */
export function wishPriceCents(wish: Pick<CrewWish, "price_min_cents" | "price_max_cents">): number | null {
  if (wish.price_min_cents == null && wish.price_max_cents == null) return null;
  if (wish.price_min_cents != null && wish.price_max_cents != null) return Math.round((wish.price_min_cents + wish.price_max_cents) / 200) * 100;
  return wish.price_min_cents ?? wish.price_max_cents;
}

/**
 * Orte für „Abstimmung daraus“: in der Reihenfolge der Liste (neueste zuerst), jeder Ort einmal, höchstens
 * `max` (eine Abstimmung hat höchstens zehn Vorschläge). Demo-Orte nur, wenn die Liste nichts anderes hat –
 * echte und Demo-Orte sollen nicht unbemerkt gemischt werden.
 */
export function wishPollItems(wishes: readonly CrewWish[], max = 10): WishPollItem[] {
  const real = wishes.filter((w) => !w.is_demo);
  const pool = real.length > 0 ? real : wishes;
  const seen = new Set<string>();
  const items: WishPollItem[] = [];
  for (const wish of pool) {
    if (items.length >= max) break;
    if (seen.has(wish.activity_id)) continue;
    seen.add(wish.activity_id);
    items.push({ activityId: wish.activity_id, title: wish.name, priceCents: wishPriceCents(wish) });
  }
  return items;
}
