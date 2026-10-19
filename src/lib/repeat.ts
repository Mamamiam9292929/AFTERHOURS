/**
 * P8 · Wiederkehrende Pläne: Regeln und Kalenderrechnung – gleich wie auf dem Server
 * (`app_private.plan_series_next_on`), damit die App den nächsten Termin nennen kann, bevor er angelegt ist.
 * Alles in Berliner Zeit; Kalendertage als „YYYY-MM-DD“.
 *
 * Bewusst ohne Importe: Die Datei läuft unverändert im Unit-Test (`node --test`, Typen werden entfernt).
 */

export type RepeatRule = "weekly" | "biweekly" | "monthly_nth" | "monthly_last";
export const REPEAT_RULES: readonly RepeatRule[] = ["weekly", "biweekly", "monthly_nth", "monthly_last"];

export interface PlanSeries {
  id: string;
  crew_id: string;
  created_by: string | null;
  rule: RepeatRule;
  /** ISO-Wochentag: 1 = Montag … 7 = Sonntag. */
  weekday: number;
  /** Nur bei monthly_nth: der wievielte (1–4) im Monat. */
  nth: number | null;
  /** Kalendertag des letzten angelegten Termins laut Regel. */
  last_on: string;
  active: boolean;
  stopped_at: string | null;
  created_at: string;
  updated_at: string;
}

const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" });

/** Kalendertag in Berliner Zeit. */
export function berlinDate(value: string | Date): string {
  return dayFormat.format(new Date(value));
}

function parse(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}
const iso = (date: Date) => date.toISOString().slice(0, 10);
/** ISO-Wochentag eines Kalendertags. */
export function isoWeekday(date: string): number {
  return ((parse(date).getUTCDay() + 6) % 7) + 1;
}
function addDays(date: string, days: number): string {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}

/** Nächster Termin nach `after` (selbst ein Termin der Serie). */
export function nextOccurrence(rule: RepeatRule, weekday: number, nth: number | null, after: string): string {
  if (rule === "weekly") return addDays(after, 7);
  if (rule === "biweekly") return addDays(after, 14);
  const base = parse(after);
  for (let i = 0; i <= 1; i++) {
    const year = base.getUTCFullYear();
    const month = base.getUTCMonth() + i;
    let candidate: string;
    if (rule === "monthly_nth") {
      const first = iso(new Date(Date.UTC(year, month, 1)));
      candidate = addDays(first, ((weekday - isoWeekday(first) + 7) % 7) + ((nth ?? 1) - 1) * 7);
    } else {
      const last = iso(new Date(Date.UTC(year, month + 1, 0)));
      candidate = addDays(last, -((isoWeekday(last) - weekday + 7) % 7));
    }
    if (candidate > after) return candidate;
  }
  return addDays(after, 28);
}

export interface RepeatAnchor {
  date: string;
  weekday: number;
  /** Der wievielte dieses Wochentags im Monat (1–5). */
  nth: number;
  /** Liegt der Tag in der letzten Woche des Monats? */
  lastWeek: boolean;
}

export function repeatAnchor(startsAt: string | Date): RepeatAnchor {
  const date = berlinDate(startsAt);
  const day = Number(date.slice(8, 10));
  return { date, weekday: isoWeekday(date), nth: Math.ceil(day / 7), lastWeek: addDays(date, 7).slice(0, 7) !== date.slice(0, 7) };
}

/** Welche Regeln zu diesem Tag passen: „1.–4. Freitag“ nur bis zum 28., „letzter Freitag“ nur in der letzten Woche. */
export function repeatOptions(anchor: RepeatAnchor): RepeatRule[] {
  return REPEAT_RULES.filter((rule) => (rule === "monthly_nth" ? anchor.nth <= 4 : rule === "monthly_last" ? anchor.lastWeek : true));
}

/** Gehört der Plan zu einer Serie, die schon einen späteren Termin hat? Dann ist er nicht der letzte. */
export function latestInSeries<T extends { id: string; starts_at: string; series_id?: string | null }>(plans: readonly T[], seriesId: string): T | null {
  let latest: T | null = null;
  for (const plan of plans) {
    if (plan.series_id !== seriesId) continue;
    if (!latest || Date.parse(plan.starts_at) > Date.parse(latest.starts_at)) latest = plan;
  }
  return latest;
}

/** Wie früh der nächste Termin einer Serie entsteht (gleich wie auf dem Server). */
export const ROLL_AHEAD_MS = 7 * 86_400_000;

function dayIndex(date: string): number {
  return parse(date).getTime() / 86_400_000;
}

/**
 * Serien, bei denen der Server den nächsten Termin anlegen soll: Er beginnt in höchstens 7 Tagen, oder der
 * letzte Termin ist abgesagt („diesmal ausgesetzt“) – dann sofort. Die Startzeit wird aus dem letzten Termin
 * hochgerechnet; über eine Zeitumstellung kann sie um eine Stunde abweichen, deshalb eine Stunde Puffer
 * (lieber eine Stunde später fragen als vergeblich – der Server prüft ohnehin selbst).
 * `plans` sind die geladenen Pläne mit eingebetteter Serie.
 */
export function dueSeries(
  plans: readonly { starts_at: string; status?: string; series_id?: string | null; series?: Pick<PlanSeries, "active" | "rule" | "weekday" | "nth" | "last_on"> | null }[],
  now: Date = new Date(),
): string[] {
  type Latest = (typeof plans)[number];
  const latest = new Map<string, Latest>();
  const series = new Map<string, NonNullable<Latest["series"]>>();
  for (const plan of plans) {
    if (!plan.series_id) continue;
    if (plan.series?.active) series.set(plan.series_id, plan.series);
    const known = latest.get(plan.series_id);
    if (!known || Date.parse(plan.starts_at) > Date.parse(known.starts_at)) latest.set(plan.series_id, plan);
  }
  const due: string[] = [];
  for (const [id, plan] of latest) {
    const rule = series.get(id);
    if (!rule) continue;
    if (plan.status === "cancelled") {
      due.push(id);
      continue;
    }
    const lastStart = Date.parse(plan.starts_at);
    let on = rule.last_on;
    let nextStart = lastStart;
    // Wie auf dem Server: der nächste Termin nach jetzt und nach dem letzten (verpasste übersprungen).
    for (let i = 0; i < 300 && nextStart <= Math.max(now.getTime(), lastStart); i++) {
      on = nextOccurrence(rule.rule, rule.weekday, rule.nth, on);
      nextStart = lastStart + (dayIndex(on) - dayIndex(berlinDate(plan.starts_at))) * 86_400_000;
    }
    if (nextStart + 3_600_000 - ROLL_AHEAD_MS <= now.getTime()) due.push(id);
  }
  return due;
}
