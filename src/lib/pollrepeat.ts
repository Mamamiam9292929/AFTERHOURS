/**
 * S7 · Runde jede Woche von selbst: wann die nächste Runde einer Serie endet und ab wann sie läuft.
 * Gleiche Rechnung wie `app_private.poll_series_next` (Migration 20261020010000_poll_series.sql):
 * Ende = letztes Ende + n Wochen in Berliner Zeit (12:00 bleibt 12:00 über die Zeitumstellung), das erste,
 * das mehr als eine Stunde in der Zukunft liegt; sie öffnet so lange vorher, wie die letzte Runde lief
 * (mindestens 1, höchstens 6 Tage).
 *
 * Keine Importe aus `@/`, damit `tests/unit/pollrepeat.test.mjs` die Datei direkt lädt.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;

export interface NextRound {
  weeks: number;
  endsAt: Date;
  opensAt: Date;
}

/** Versatz von Europe/Berlin gegenüber UTC zu einem Zeitpunkt, in Millisekunden. */
function berlinOffset(at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** p_at + n Wochen auf der Berliner Uhr (wie `(t at time zone 'Europe/Berlin' + 7n days) at time zone 'Europe/Berlin'`). */
export function plusBerlinWeeks(at: Date, weeks: number): Date {
  const wall = at.getTime() + berlinOffset(at) + weeks * 7 * DAY;
  // Wanduhrzeit zurück in UTC: Versatz am Ziel bestimmen (einmal nachjustieren genügt außerhalb der Lücke).
  let utc = wall - berlinOffset(new Date(wall));
  utc = wall - berlinOffset(new Date(utc));
  return new Date(utc);
}

export function nextRound(endsAt: Date | string, createdAt: Date | string, now: Date = new Date()): NextRound | null {
  const end = new Date(endsAt);
  const created = new Date(createdAt);
  if (Number.isNaN(end.getTime()) || Number.isNaN(created.getTime())) return null;
  const lead = Math.min(Math.max(end.getTime() - created.getTime(), DAY), 6 * DAY);
  for (let weeks = 1; weeks <= 520; weeks++) {
    const next = plusBerlinWeeks(end, weeks);
    if (next.getTime() > now.getTime() + HOUR) return { weeks, endsAt: next, opensAt: new Date(next.getTime() - lead) };
  }
  return null;
}

interface RepeatPoll {
  id: string;
  series_id: string | null;
  parent_poll_id?: string | null;
  status: string;
  ends_at: string;
  created_at: string;
  series?: { id: string; active: boolean } | null;
}

/**
 * Serien, deren letzte Runde vorbei ist und deren nächste schon laufen müsste – dann stößt die App
 * `roll_poll_series` an. Je Serie zählt die Runde mit dem spätesten Ende (Stichwahlen gehören nie dazu).
 */
export function dueRepeats(polls: RepeatPoll[], now: Date = new Date()): string[] {
  const latest = new Map<string, RepeatPoll>();
  for (const poll of polls) {
    if (!poll.series_id || !poll.series?.active) continue;
    const seen = latest.get(poll.series_id);
    if (!seen || new Date(poll.ends_at) > new Date(seen.ends_at)) latest.set(poll.series_id, poll);
  }
  const due: string[] = [];
  for (const [seriesId, poll] of latest) {
    const running = poll.status === "open" && new Date(poll.ends_at) > now;
    if (running) continue;
    const next = nextRound(poll.ends_at, poll.created_at, now);
    if (next && now >= next.opensAt) due.push(seriesId);
  }
  return due;
}
