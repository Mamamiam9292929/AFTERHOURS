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

/** P22 Etappe 2: der letzte gemeinsame Abend der Crew an einem Ort der Liste. */
export interface WishVisit {
  planId: string;
  startsAt: string;
}

/** Was aus einem Plan gebraucht wird (passt zu `Plan`). */
export interface WishVisitPlan {
  id: string;
  crew_id: string;
  activity_id: string | null;
  status: string;
  starts_at: string;
}

/**
 * „Waren wir schon“: je Ort der letzte abgeschlossene Plan (Status `completed`) dieser Crew an genau diesem
 * Ort. Abgesagte, anstehende und Pläne anderer Crews zählen nicht – die Merkliste gehört der Crew.
 */
export function wishVisits(plans: readonly WishVisitPlan[], crewId: string): Map<string, WishVisit> {
  const visits = new Map<string, WishVisit>();
  for (const plan of plans) {
    if (plan.crew_id !== crewId || !plan.activity_id || plan.status !== "completed") continue;
    const at = new Date(plan.starts_at).getTime();
    if (Number.isNaN(at)) continue;
    const known = visits.get(plan.activity_id);
    if (!known || new Date(known.startsAt).getTime() < at) visits.set(plan.activity_id, { planId: plan.id, startsAt: plan.starts_at });
  }
  return visits;
}

/**
 * „Von eurer Liste“ beim Anlegen einer Abstimmung: Orte der Merkliste, die noch nicht unter den Vorschlägen
 * stehen, neueste zuerst, höchstens `max`. Wie bei „Abstimmung daraus“ keine Demo-Orte, solange echte Orte
 * auf der Liste stehen. Orte, an denen die Crew schon war, rücken ans Ende – Neues zuerst.
 */
export function wishSuggestions(
  wishes: readonly CrewWish[],
  chosen: ReadonlySet<string>,
  visits: ReadonlyMap<string, WishVisit> = new Map(),
  max = 6,
): CrewWish[] {
  const real = wishes.filter((w) => !w.is_demo);
  const pool = (real.length > 0 ? real : wishes).filter((w) => !chosen.has(w.activity_id));
  const seen = new Set<string>();
  const unique = pool.filter((w) => {
    if (seen.has(w.activity_id)) return false;
    seen.add(w.activity_id);
    return true;
  });
  const fresh = unique.filter((w) => !visits.has(w.activity_id));
  const visited = unique.filter((w) => visits.has(w.activity_id));
  return [...fresh, ...visited].slice(0, Math.max(0, max));
}
