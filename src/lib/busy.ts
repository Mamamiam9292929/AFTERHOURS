/**
 * P18 · „Da hast du schon was vor“ beim Abstimmen.
 *
 * Für jeden Vorschlag mit Termin sucht die App in den eigenen Plänen (alle Crews, so wie `usePlans` sie über
 * RLS ohnehin lädt) nach einem Abend, der dazwischenkommt. Gerechnet wird nur im Browser, für die eigene
 * Person – andere sehen davon nichts, und es geht keine Anfrage an den Server.
 *
 * Zählt nur, was wirklich ansteht: aktiver Plan (vorgeschlagen, bestätigt, Reservierung läuft, reserviert)
 * und die eigene Antwort „dabei“ oder „vielleicht“. Ohne Antwort („eingeladen“) oder mit Absage steht da
 * nichts – sonst würde jede Crew-Idee den Kalender verstopfen. Pläne, die aus genau dieser Abstimmung
 * (oder einer verknüpften wie Stichwahl und „Und wo?“) entstanden sind, zählen nicht.
 *
 * - Vorschlag mit Uhrzeit: belegt drei Stunden ab dann. Überschneidet sich ein Plan (ohne Ende: drei Stunden
 *   ab Beginn), heißt das „overlap“. Liegt ein Plan nur am selben Berliner Kalendertag, heißt es „day“.
 * - Vorschlag ohne Uhrzeit: jeder Plan an dem Tag ist „day“ – ob er stört, weiß nur die Person selbst.
 * Pläne mit Ende gelten an jedem Tag, den sie berühren (mehrtägig); ohne Ende nur am Tag des Beginns.
 *
 * Bewusst ohne Importe: Die Datei läuft unverändert im Unit-Test (`node --test`, Typen werden entfernt).
 */

export interface BusyPlan {
  id: string;
  title: string;
  crew_id: string;
  poll_id: string | null;
  starts_at: string;
  ends_at: string | null;
  status: string;
  participants: readonly { user_id: string; attendance_status: string }[];
}

export interface BusyOption {
  proposed_date: string | null;
  proposed_time: string | null;
}

export interface BusyHit {
  kind: "overlap" | "day";
  plan: BusyPlan;
  /** Beginn des Plans in Berliner Zeit, „20:00“ – für die Anzeige ohne zweite Rechnung. */
  time: string;
  /** Weitere Pläne an dem Tag (ohne den gezeigten). */
  more: number;
}

const TIME_ZONE = "Europe/Berlin";
const ACTIVE = new Set(["proposed", "confirmed", "booking_pending", "booked"]);
const COMMITTED = new Set(["going", "maybe"]);
/** So lange belegt ein Vorschlag mit Uhrzeit bzw. ein Plan ohne Ende den Abend. */
export const SLOT_MS = 3 * 3600_000;

const partsFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function parts(ms: number): { date: string; time: string; wall: number } {
  const p = Object.fromEntries(partsFormat.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  return { date, time: `${p.hour}:${p.minute}`, wall };
}

/** Berliner Ortszeit („2026-11-21“, „20:00“) als UTC-Millisekunden, sommerzeitfest. */
export function berlinToUtc(date: string, time: string): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})/.exec(time);
  if (!d || !t) return null;
  const wall = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  if (Number.isNaN(wall)) return null;
  let utc = wall;
  for (let i = 0; i < 2; i++) utc = wall - (parts(utc).wall - utc);
  return utc;
}

function span(plan: BusyPlan): [number, number] {
  const start = new Date(plan.starts_at).getTime();
  const end = plan.ends_at ? new Date(plan.ends_at).getTime() : Number.NaN;
  return [start, Number.isFinite(end) && end > start ? end : start + SLOT_MS];
}

/** Berührt der Plan diesen Berliner Kalendertag? */
function touchesDay(plan: BusyPlan, date: string): boolean {
  const [start, end] = span(plan);
  // Ohne Ende zählt nur der Tag des Beginns – „Party ab 23 Uhr“ belegt nicht den nächsten Tag.
  const last = plan.ends_at ? parts(end - 1).date : parts(start).date;
  return parts(start).date <= date && date <= last;
}

/** Pläne, die für die Person zählen: aktiv, mit eigener Zusage oder „vielleicht“, nicht aus diesen Abstimmungen. */
export function relevantPlans<T extends BusyPlan>(plans: readonly T[], userId: string, excludePollIds: ReadonlySet<string> = new Set()): T[] {
  return plans.filter(
    (plan) =>
      ACTIVE.has(plan.status) &&
      !(plan.poll_id && excludePollIds.has(plan.poll_id)) &&
      plan.participants.some((p) => p.user_id === userId && COMMITTED.has(p.attendance_status)),
  );
}

/**
 * Was am Termin des Vorschlags schon ansteht – Überschneidung vor „am selben Tag“, sonst der früheste Plan.
 * `plans` sind die schon gefilterten (`relevantPlans`). Ohne Datum: null.
 */
export function busyFor<T extends BusyPlan>(option: BusyOption, plans: readonly T[]): (BusyHit & { plan: T }) | null {
  const date = option.proposed_date;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const sameDay = plans.filter((plan) => touchesDay(plan, date));
  if (sameDay.length === 0) return null;

  const from = option.proposed_time ? berlinToUtc(date, option.proposed_time) : null;
  const overlapping =
    from == null
      ? []
      : sameDay.filter((plan) => {
          const [start, end] = span(plan);
          return start < from + SLOT_MS && from < end;
        });
  const pool = overlapping.length > 0 ? overlapping : sameDay;
  const [first] = [...pool].sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.id.localeCompare(b.id));
  if (!first) return null;
  return { kind: overlapping.length > 0 ? "overlap" : "day", plan: first, time: parts(new Date(first.starts_at).getTime()).time, more: sameDay.length - 1 };
}
