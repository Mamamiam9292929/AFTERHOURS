/**
 * P40 Etappe 2 · „Und das Kino?“ – weiteren Ort in einer laufenden Orts-Abstimmung vorschlagen. Gleiche Regeln wie
 * `add_poll_place` in der Datenbank, damit die Seite den Fehler zeigt, bevor sie fragt. Ohne Laufzeit-Importe,
 * damit der Unit-Test sie direkt laden kann.
 */

export const MAX_POLL_PLACES = 10;

type PlacePoll = {
  kind: string;
  status: string;
  ends_at: string;
  parent_poll_id: string | null;
  options: { activity_id: string | null; title: string }[];
};

/** Ob „Anderen Ort vorschlagen“ überhaupt erscheint: laufende Orts-Abstimmung, keine Stichwahl. */
export function canSuggestPlace(poll: PlacePoll, now: Date = new Date()): boolean {
  return poll.kind === "place" && poll.status === "open" && new Date(poll.ends_at).getTime() > now.getTime() && !poll.parent_poll_id;
}

export function placesFull(poll: Pick<PlacePoll, "options">): boolean {
  return poll.options.length >= MAX_POLL_PLACES;
}

export type PlaceProblem = "invalid" | "duplicate" | "full";

/** Wie `app_private.clean_line`: Leerraum zusammenziehen, trimmen, auf 120 Zeichen kürzen. */
export function cleanPlaceTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim().slice(0, 120);
}

/** Prüft einen Vorschlag: Ort aus Discover (`activityId`, Titel = sein Name) oder eigener Titel. */
export function placeProblem(poll: Pick<PlacePoll, "options">, input: { activityId: string | null; title: string }): PlaceProblem | null {
  const title = cleanPlaceTitle(input.title);
  if (!title) return "invalid";
  const lower = title.toLocaleLowerCase("de");
  if (poll.options.some((o) => (input.activityId && o.activity_id === input.activityId) || o.title.toLocaleLowerCase("de") === lower)) return "duplicate";
  if (placesFull(poll)) return "full";
  return null;
}
