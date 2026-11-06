/**
 * P29 Etappe 2 · Lieblingsabend: ein abgeschlossener Abend, bei dem mindestens zwei „Nochmal!“ gesagt haben und
 * „Nochmal!“ mehr als die Hälfte der Urteile ist. Dieselbe Regel steht in der Datenbank
 * (`crew_favorite_evenings`, Migration 20261106080000); hier entscheidet sie über den Hinweis bei „Nochmal?“.
 *
 * Bewusst ohne Importe: Die Datei läuft unverändert im Unit-Test (`node --test`, Typen werden entfernt).
 */
export interface VerdictCounts {
  again: number;
  ok: number;
  meh: number;
}

const count = (value: number) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

export function isFavoriteEvening(counts: VerdictCounts): boolean {
  const again = count(counts.again);
  const total = again + count(counts.ok) + count(counts.meh);
  return again >= 2 && again * 2 > total;
}
