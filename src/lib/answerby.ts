/**
 * P46 · „Sagt bis Donnerstag Bescheid“ – Antwortfrist für Pläne. Reine Regeln ohne Laufzeit-Importe, damit Node
 * sie im Unit-Test ohne Bundler laden kann. Die Frist ist ein Hinweis, keine Sperre (wie auf dem Server).
 */

type FristPlan = { answer_by?: string | null; status: string; starts_at: string };

/** Auswählbare Fristen: so viele Tage vor Beginn, zur selben Uhrzeit (Berliner Zeit). */
export const ANSWER_BY_DAYS = [1, 2, 3, 7] as const;

const DAY = 24 * 60 * 60 * 1000;
/** Spätestens so lange vor Beginn (wie `set_plan_answer_by`). */
const BEFORE_START = 60 * 60 * 1000;
/** Eine Frist muss noch mindestens so weit weg sein, damit sie zur Wahl steht – sonst ist sie vorbei, bevor jemand sie liest. */
const MIN_AHEAD = 30 * 60 * 1000;

const offsetFormat = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", timeZoneName: "shortOffset" });

/** Abstand der Berliner Zeit zu UTC in Minuten (60 im Winter, 120 im Sommer). */
function berlinOffset(ms: number): number {
  const name = offsetFormat.formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

/** N Tage vor `start`, zur selben Berliner Uhrzeit – auch über die Zeitumstellung hinweg. */
export function daysBefore(start: number, days: number): number {
  const naive = start - days * DAY;
  return naive + (berlinOffset(start) - berlinOffset(naive)) * 60 * 1000;
}

/**
 * Frist eines Plans zum Zeitpunkt `now`: `null`, wenn es keine gibt oder nichts mehr zu fragen ist (abgesagt,
 * abgeschlossen, schon begonnen). Sonst der Zeitpunkt und ob er schon vorbei ist.
 */
export function answerByState(plan: FristPlan, now: Date = new Date()): { at: string; passed: boolean } | null {
  if (!plan.answer_by) return null;
  if (plan.status === "cancelled" || plan.status === "completed") return null;
  const start = new Date(plan.starts_at).getTime();
  const at = new Date(plan.answer_by).getTime();
  if (Number.isNaN(at) || start <= now.getTime()) return null;
  return { at: plan.answer_by, passed: at <= now.getTime() };
}

/** Die Fristen, die gerade zur Wahl stehen: N Tage vor Beginn, noch mindestens eine halbe Stunde entfernt. */
export function answerByOptions(startsAt: string, now: Date = new Date()): { days: number; at: string }[] {
  const start = new Date(startsAt).getTime();
  if (Number.isNaN(start)) return [];
  return ANSWER_BY_DAYS.map((days) => ({ days, time: daysBefore(start, days) }))
    .filter(({ time }) => time >= now.getTime() + MIN_AHEAD && time <= start - BEFORE_START)
    .map(({ days, time }) => ({ days, at: new Date(time).toISOString() }));
}

/** Gehört die gespeicherte Frist zu einer der Auswahlen? Sonst zeigt die Karte sie als eigene, ausgewählte Pille. */
export function matchingDays(answerBy: string | null | undefined, startsAt: string): number | null {
  if (!answerBy) return null;
  const start = new Date(startsAt).getTime();
  const at = new Date(answerBy).getTime();
  const days = ANSWER_BY_DAYS.find((d) => Math.abs(daysBefore(start, d) - at) < 60 * 1000);
  return days ?? null;
}

/** P47: Die Frist zu `days` Tagen vor `startsAt`, wenn sie gerade zur Wahl steht – sonst `null` (passt nicht mehr). */
export function answerByFor(startsAt: Date | null, days: number | null, now: Date = new Date()): string | null {
  if (!startsAt || days == null || Number.isNaN(startsAt.getTime())) return null;
  return answerByOptions(startsAt.toISOString(), now).find((o) => o.days === days)?.at ?? null;
}
