/**
 * P32 · „Neuer Anlauf?“ – auf einem abgesagten Plan führt ein Tipp zur Terminsuche („Wann könnt ihr?“) für dieselbe
 * Crew, mit dem Ort des Plans und seinem Namen im Titel („Hütte – wann klappt’s?“). Im Gruppenchat endet eine Absage
 * oft mit „dann ein andermal“ – und dann passiert nichts. Hier ist das Andermal einen Tipp entfernt.
 *
 * Keine neue Datenbankfunktion: Die Abstimmung legt wie gewohnt `create_date_poll` bzw. `create_place_date_poll` an,
 * mit allen Prüfungen dort (Mitgliedschaft, Eingaben, Rate-Limit). Der Titel aus dem Link ist nur ein Vorschlag im
 * Formular und lässt sich ändern.
 *
 * Bewusst ohne Importe: Die Datei läuft unverändert im Unit-Test (`node --test`, Typen werden entfernt).
 */
export interface RetryablePlan {
  status: string;
  starts_at: string;
  skipped_at?: string | null;
  crew_id: string;
  activity_id: string | null;
  title: string;
}

/** So lange nach dem geplanten Termin steht die Karte noch da – danach ist der Anlass vergessen. */
export const RETRY_DAYS = 30;
/** Länge des Plan-Namens im Link; der fertige Titel muss in die 80 Zeichen einer Abstimmung passen. */
export const RETRY_TITLE_MAX = 60;
const DAY = 24 * 60 * 60 * 1000;

/**
 * Karte zeigen? Nur bei abgesagten Plänen, nicht bei ausgesetzten Terminen eines Stammtischs (P8 – dort kommt der
 * nächste Termin von selbst) und nur bis 30 Tage nach dem geplanten Beginn.
 */
export function retryDue(plan: Pick<RetryablePlan, "status" | "starts_at" | "skipped_at">, now: Date = new Date()): boolean {
  if (plan.status !== "cancelled" || plan.skipped_at) return false;
  const start = Date.parse(plan.starts_at);
  if (!Number.isFinite(start)) return false;
  return now.getTime() < start + RETRY_DAYS * DAY;
}

/** Plan-Name für den Link bzw. aus dem Link: Leerraum zusammengefasst, 1–60 Zeichen, sonst keiner. */
export function retryTitle(value: string | null | undefined): string | null {
  const title = (value ?? "").replace(/\s+/g, " ").trim();
  return title.length > 0 && title.length <= RETRY_TITLE_MAX ? title : null;
}

/** `/polls/new?crew=…&kind=date[&place=…][&again=…]` – wie „Nochmal?“ (P17), dazu der Name des Plans. */
export function retryLink(plan: Pick<RetryablePlan, "crew_id" | "activity_id" | "title">): string {
  const params = new URLSearchParams({ crew: plan.crew_id, kind: "date" });
  if (plan.activity_id) params.set("place", plan.activity_id);
  const title = retryTitle(plan.title);
  if (title) params.set("again", title);
  return `/polls/new?${params.toString()}`;
}
