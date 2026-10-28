/**
 * V2 Etappe 3l · Benachrichtigungen als Stapel: Bereich, Farbschein und Tagesgruppe je Eintrag.
 *
 * Jede Benachrichtigung gehört zu einem Bereich (Abstimmung, Plan, Crew, Kosten, Spontan, Punkte). Der
 * Bereich bestimmt Symbol und Farbschein der Karte – Farbe nur als Licht, nie als Textfarbe. Gruppiert wird
 * nach Kalendertagen in Berliner Zeit: Heute, Gestern, Diese Woche (2–6 Tage), Früher.
 *
 * Bewusst ohne Importe: Die Datei läuft unverändert im Unit-Test (`node --test`, Typen werden entfernt).
 */

export type InboxArea = "poll" | "plan" | "crew" | "money" | "spontaneous" | "reward";
export type InboxTone = "violet" | "lime" | "pink" | "amber" | "danger";
export type InboxGroupKey = "today" | "yesterday" | "week" | "older";

const AREA: Record<string, InboxArea> = {
  crew_member_joined: "crew",
  crew_member_removed: "crew",
  crew_role_changed: "crew",
  poll_created: "poll",
  poll_reminder: "poll",
  poll_vote: "poll",
  poll_result: "poll",
  plan_created: "plan",
  plan_changed: "plan",
  plan_cancelled: "plan",
  plan_attendance: "plan",
  booking_status: "plan",
  ride_request: "plan",
  ride_confirmed: "plan",
  plan_day_reminder: "plan",
  reward_earned: "reward",
  plan_expense: "money",
  plan_settlement: "money",
  plan_expense_reminder: "money",
  spontaneous_ask: "spontaneous",
  spontaneous_answer: "spontaneous",
  spontaneous_match: "spontaneous",
};

const AREA_TONE: Record<InboxArea, InboxTone> = {
  poll: "violet",
  plan: "lime",
  crew: "pink",
  money: "amber",
  spontaneous: "pink",
  reward: "lime",
};

/** Bereich einer Benachrichtigung; unbekannte (neuere) Arten landen bei „Crew“, damit nichts verschwindet. */
export function inboxArea(type: string): InboxArea {
  return AREA[type] ?? "crew";
}

/**
 * Farbschein der Karte. Absagen und Rauswürfe tragen Rot, damit sie im Stapel nicht wie eine gute
 * Nachricht aussehen; sonst die Farbe des Bereichs.
 */
export function inboxTone(type: string, payload: Record<string, unknown> = {}): InboxTone {
  // „Diesmal aussetzen“: der Abend fällt aus, der Stammtisch läuft weiter – Gelb statt Rot.
  if (type === "plan_cancelled") return payload.skipped ? "amber" : "danger";
  if (type === "crew_member_removed") return "danger";
  if (type === "ride_confirmed" && !payload.accepted) return "danger";
  if (type === "booking_status" && (payload.status === "unavailable" || payload.status === "failed")) return "danger";
  return AREA_TONE[inboxArea(type)];
}

const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" });

/** Kalendertag in Berliner Zeit als fortlaufende Zahl (Tage seit 1970). */
function berlinDay(v: Date | string): number {
  const [y, m, d] = dayFormat.format(new Date(v)).split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / 86_400_000;
}

/** Tagesgruppe einer Benachrichtigung relativ zu `now` (Berliner Kalendertage, nicht 24-Stunden-Blöcke). */
export function inboxGroup(createdAt: Date | string, now: Date = new Date()): InboxGroupKey {
  const days = berlinDay(now) - berlinDay(createdAt);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days <= 6) return "week";
  return "older";
}

export interface InboxGroup<T> {
  key: InboxGroupKey;
  items: T[];
}

/**
 * Teilt die (neueste zuerst sortierte) Liste in Tagesgruppen. Reihenfolge innerhalb einer Gruppe bleibt,
 * leere Gruppen fallen weg.
 */
export function groupInbox<T extends { created_at: string }>(items: readonly T[], now: Date = new Date()): InboxGroup<T>[] {
  const order: InboxGroupKey[] = ["today", "yesterday", "week", "older"];
  const buckets = new Map<InboxGroupKey, T[]>();
  for (const item of items) {
    const key = inboxGroup(item.created_at, now);
    const list = buckets.get(key) ?? [];
    list.push(item);
    buckets.set(key, list);
  }
  return order.filter((key) => buckets.has(key)).map((key) => ({ key, items: buckets.get(key) ?? [] }));
}
