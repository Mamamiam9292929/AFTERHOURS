/**
 * P14 Etappe 2 · Wer bringt was? – reine Logik ohne Abhängigkeiten (Unit-Test in tests/unit/bring.test.mjs).
 * Zusammenfassung für die „Heute Abend“-Leiste auf Home und Vorlagen je Anlass für die Mitbring-Liste.
 */

export interface BringItem {
  id: string;
  label: string;
  claimed_by: string | null;
  created_at: string;
}

export interface BringSummary {
  /** was du mitbringst, in der Reihenfolge der Liste */
  mine: string[];
  /** was noch niemand mitbringt, älteste zuerst */
  open: { id: string; label: string }[];
  total: number;
}

/** Was bringst du mit, was ist noch offen? `null`, wenn nichts auf der Liste steht. */
export function bringSummary(items: readonly BringItem[], userId: string): BringSummary | null {
  if (items.length === 0) return null;
  const sorted = [...items].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return {
    mine: sorted.filter((i) => i.claimed_by === userId).map((i) => i.label),
    open: sorted.filter((i) => i.claimed_by == null).map((i) => ({ id: i.id, label: i.label })),
    total: items.length,
  };
}

/** Anlässe mit Vorlagen; die Sachen selbst stehen sprachabhängig in den Texten (`t.plans.items.templates`). */
export const BRING_TEMPLATES = ["grill", "games", "picnic", "movie"] as const;
export type BringTemplate = (typeof BRING_TEMPLATES)[number];

const KEYWORDS: Record<BringTemplate, RegExp> = {
  grill: /grill|bbq|barbecue|cookout/i,
  games: /spiel|game|brettspiel|poker|kniffel|uno\b|wizard|werwolf|quiz/i,
  picnic: /picknick|picnic|park|see\b|lake|strand|beach|wiese/i,
  movie: /filmabend|film night|movie night|filme|serie|netflix|series/i,
};

/** Passende Vorlage zum Plantitel („Grillen am See“ → grill), sonst `null`. Erste Übereinstimmung in Reihenfolge der Anlässe. */
export function guessTemplate(title: string): BringTemplate | null {
  return BRING_TEMPLATES.find((id) => KEYWORDS[id].test(title)) ?? null;
}

/** Vergleich wie auf dem Server: ohne Groß/Klein, Leerraum zusammengezogen. */
export function sameLabel(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLocaleLowerCase("de");
  return norm(a) === norm(b);
}

/** Sachen der Vorlage, die noch nicht auf der Liste stehen – höchstens so viele, wie noch Platz ist. */
export function templateSuggestions(templateItems: readonly string[], existing: readonly string[], room: number): string[] {
  if (room <= 0) return [];
  return templateItems.filter((label) => !existing.some((e) => sameLabel(e, label))).slice(0, room);
}
