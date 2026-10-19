/**
 * P1 Etappe 3b · Termin-Vorschläge aus den Abenden der Crew.
 *
 * Grundlage sind nur die abgeschlossenen Pläne der Crew (wie beim Rückblick, `src/lib/recap.ts`), davon die
 * letzten 20 – so zählen die heutigen Gewohnheiten, nicht die von vor zwei Jahren. Vorgeschlagen wird erst,
 * wenn es etwas zu erkennen gibt: mindestens drei Abende und ein Wochentag mit mindestens zwei davon.
 * Sonst gibt es keinen Vorschlag (null) – die App bleibt dann beim nächsten Wochenende.
 *
 * Vorschläge: die nächsten Termine am Lieblingstag (ab morgen, höchstens fünf Wochen voraus), dazu der
 * nächste am zweitliebsten Tag, falls auch der mindestens zwei Abende hat. Uhrzeit je Tag: die häufigste,
 * bei Gleichstand die jüngste. Tage, an denen die Crew schon einen aktiven Plan hat, fallen weg.
 * Alles in Berliner Zeit.
 *
 * Bewusst ohne Importe: Die Datei läuft unverändert im Unit-Test (`node --test`, Typen werden entfernt).
 */

export interface SlotPlan {
  id: string;
  starts_at: string;
  status: string;
}

export interface SuggestedSlot {
  /** „2026-10-22“ (Berliner Kalendertag) */
  date: string;
  /** „19:30“ */
  time: string;
  /** 0 = Sonntag … 6 = Samstag */
  weekday: number;
}

export interface SlotSuggestion {
  /** Zahl der betrachteten Abende (höchstens 20). */
  evenings: number;
  /** Lieblingstag, 0 = Sonntag. */
  weekday: number;
  /** So viele der betrachteten Abende lagen an diesem Tag. */
  weekdayCount: number;
  /** Übliche Uhrzeit am Lieblingstag. */
  time: string;
  /** So oft begann ein Abend am Lieblingstag zu dieser Uhrzeit (1 = nur zuletzt, keine Gewohnheit). */
  timeCount: number;
  /** Höchstens drei Termine, chronologisch. */
  slots: SuggestedSlot[];
}

const TIME_ZONE = "Europe/Berlin";
const RECENT = 20;
const MIN_EVENINGS = 3;
const MIN_PER_WEEKDAY = 2;
const MAX_SLOTS = 3;
const HORIZON_DAYS = 35;
const ACTIVE = new Set(["proposed", "confirmed", "booking_pending", "booked"]);

const partsFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Kalendertag, Uhrzeit und Wochentag in Berliner Zeit. */
export function berlinSlot(value: string | Date): SuggestedSlot {
  const p = Object.fromEntries(partsFormat.formatToParts(new Date(value)).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  return { date, time: `${p.hour}:${p.minute}`, weekday: weekdayOf(date) };
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}

function plusDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days)).toISOString().slice(0, 10);
}

interface DayStats {
  weekday: number;
  count: number;
  /** Beginn des jüngsten Abends an diesem Tag (ISO) – entscheidet bei Gleichstand. */
  latest: string;
  times: Map<string, { count: number; latest: string }>;
}

function usualTime(day: DayStats): { time: string; count: number } {
  const [best] = [...day.times.entries()].sort((a, b) => b[1].count - a[1].count || b[1].latest.localeCompare(a[1].latest));
  return { time: best?.[0] ?? "19:00", count: best?.[1].count ?? 0 };
}

export function suggestDateSlots(plans: readonly SlotPlan[], now: Date = new Date()): SlotSuggestion | null {
  const recent = plans
    .filter((p) => p.status === "completed" && !Number.isNaN(new Date(p.starts_at).getTime()) && new Date(p.starts_at) <= now)
    .slice()
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at) || a.id.localeCompare(b.id))
    .slice(0, RECENT);
  if (recent.length < MIN_EVENINGS) return null;

  const days = new Map<number, DayStats>();
  for (const plan of recent) {
    const slot = berlinSlot(plan.starts_at);
    const day = days.get(slot.weekday) ?? { weekday: slot.weekday, count: 0, latest: plan.starts_at, times: new Map() };
    day.count += 1;
    if (plan.starts_at > day.latest) day.latest = plan.starts_at;
    const time = day.times.get(slot.time) ?? { count: 0, latest: plan.starts_at };
    time.count += 1;
    if (plan.starts_at > time.latest) time.latest = plan.starts_at;
    day.times.set(slot.time, time);
    days.set(slot.weekday, day);
  }

  const ranked = [...days.values()].filter((d) => d.count >= MIN_PER_WEEKDAY).sort((a, b) => b.count - a.count || b.latest.localeCompare(a.latest));
  const [first, second] = ranked;
  if (!first) return null;
  const firstTime = usualTime(first);

  // Tage, an denen die Crew schon etwas vorhat, schlagen wir nicht noch einmal vor.
  const busy = new Set(plans.filter((p) => ACTIVE.has(p.status) && new Date(p.starts_at) > now).map((p) => berlinSlot(p.starts_at).date));
  const today = berlinSlot(now).date;
  const upcoming = (weekday: number, time: string, count: number): SuggestedSlot[] => {
    const found: SuggestedSlot[] = [];
    for (let offset = 1; offset <= HORIZON_DAYS && found.length < count; offset++) {
      const date = plusDays(today, offset);
      if (weekdayOf(date) === weekday && !busy.has(date)) found.push({ date, time, weekday });
    }
    return found;
  };

  const slots = second
    ? [...upcoming(first.weekday, firstTime.time, MAX_SLOTS - 1), ...upcoming(second.weekday, usualTime(second).time, 1)]
    : upcoming(first.weekday, firstTime.time, MAX_SLOTS);
  slots.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  if (slots.length === 0) return null;

  return {
    evenings: recent.length,
    weekday: first.weekday,
    weekdayCount: first.count,
    time: firstTime.time,
    timeCount: firstTime.count,
    slots: slots.slice(0, MAX_SLOTS),
  };
}
