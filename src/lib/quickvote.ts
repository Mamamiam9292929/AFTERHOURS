/**
 * D3 Etappe 1 · Home als „Heute Abend“-Bühne – reine Logik (ohne React, per `node --test` geprüft).
 * Abstimmen auf Home: Welcher Vorschlag kommt als Nächstes? Live-Countdown: Wie lange noch bis zum Plan?
 * Der Server entscheidet über Stimmen und Pläne; hier wird nur ausgewählt und angezeigt.
 */

export type QuickResponse = "yes" | "maybe" | "no";

export interface QuickOption {
  id: string;
  /** Eigene gespeicherte Antwort, `null` ohne Antwort. */
  mine: QuickResponse | null;
}

/**
 * Vorschläge, die auf Home noch zur Antwort anstehen – in der Reihenfolge der Abstimmung. Was schon
 * gespeichert ist, gerade in dieser Sitzung beantwortet oder übersprungen wurde, fällt weg.
 */
export function pendingOptions<T extends QuickOption>(options: T[], answered: ReadonlySet<string>, skipped: ReadonlySet<string>): T[] {
  return options.filter((option) => option.mine === null && !answered.has(option.id) && !skipped.has(option.id));
}

/**
 * Gehört eine laufende Abstimmung unter „Deine Antwort fehlt“? Ja, solange du noch gar nicht abgestimmt hast –
 * und auch danach, wenn du in dieser Sitzung auf Home angefangen hast (`touched`). So verschwindet die
 * Karte nicht nach dem ersten Tipp; wer durch ist, sieht „Danke“, bis Home neu geöffnet wird.
 */
export function needsQuickVote(options: QuickOption[], touched: boolean): boolean {
  const open = options.some((option) => option.mine === null);
  const voted = options.some((option) => option.mine !== null);
  return touched || (open && !voted);
}

export type LiveCountdown = { kind: "soon"; minutes: number } | { kind: "live" } | null;

/** Ab wann der Countdown auf Home live mitläuft (Stunden vor Beginn). */
export const LIVE_HOURS = 12;
/** Ohne Ende des Plans gilt er so lange nach Beginn als „läuft gerade“. */
export const LIVE_FALLBACK_MINUTES = 180;

/**
 * Live-Countdown für das große Ticket auf Home: in den letzten 12 Stunden vor Beginn minutengenau
 * („noch 2:14 h“, aufgerundet – nie „noch 0 min“), danach „läuft gerade“ bis zum Ende (ohne Ende 3 h).
 * Abgesagte und abgeschlossene Pläne zählen nicht herunter.
 */
export function liveCountdown(plan: { starts_at: string; ends_at: string | null; status: string }, now: Date): LiveCountdown {
  if (plan.status === "cancelled" || plan.status === "completed") return null;
  const start = new Date(plan.starts_at).getTime();
  const diff = start - now.getTime();
  if (diff > 0) {
    if (diff > LIVE_HOURS * 3600_000) return null;
    return { kind: "soon", minutes: Math.max(1, Math.ceil(diff / 60_000)) };
  }
  const end = plan.ends_at ? new Date(plan.ends_at).getTime() : start + LIVE_FALLBACK_MINUTES * 60_000;
  return now.getTime() < end ? { kind: "live" } : null;
}

/** „2:14 h“ bzw. „35 min“ – wie die Restzeit bei „Heute noch wer?“. */
export function formatCountdown(minutes: number): string {
  if (minutes >= 60) return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")} h`;
  return `${minutes} min`;
}

/** D3 Etappe 2a: Wann ist der Plan, aus Sicht von Home? Steuert die Überschrift der „Heute“-Leiste. */
export type TonightWhen = "now" | "night" | "tonight" | "today" | "tomorrow";

export interface TonightStrip {
  when: TonightWhen;
  /** Wetter nur mit Ort aus Discover (Koordinaten) und nur, solange der Plan noch nicht begonnen hat. */
  weather: boolean;
  meetingPoint: string | null;
  address: string | null;
}

const clean = (value: string | null | undefined) => {
  const text = value?.trim();
  return text ? text : null;
};

/**
 * D3 Etappe 2a · „Heute“-Leiste unter dem großen Ticket: im selben Fenster wie der Live-Countdown
 * (12 Stunden vor Beginn bis zum Ende), mit Wetter und Treffpunkt. `days` sind die Kalendertage bis
 * zum Plan in Berliner Zeit (heute = 0), `startHour` die Stunde des Beginns in Berliner Zeit – beides
 * rechnet der Aufrufer, damit diese Datei ohne Abhängigkeiten bleibt. Nichts wird erfunden: ohne
 * Treffpunkt und Adresse steht dort „noch offen“, ohne Ort aus Discover gibt es kein Wetter.
 * Beginnt der Plan vor 5 Uhr, heißt die Leiste „Heute Nacht“ – auch wenn es kalendarisch schon morgen ist.
 */
export function tonightStrip(
  plan: { starts_at: string; ends_at: string | null; status: string; activity_id: string | null; meeting_point: string | null; address: string | null },
  now: Date,
  days: number,
  startHour: number,
): TonightStrip | null {
  const live = liveCountdown(plan, now);
  if (!live) return null;
  const when: TonightWhen = live.kind === "live" ? "now" : startHour < 5 ? "night" : days >= 1 ? "tomorrow" : startHour >= 17 ? "tonight" : "today";
  return {
    when,
    weather: Boolean(plan.activity_id) && live.kind === "soon",
    meetingPoint: clean(plan.meeting_point),
    address: clean(plan.address),
  };
}

/** D3 Etappe 2b: „Heute Abend“ ohne Plan – ab wann und bis wann (Stunde in Berliner Zeit, bis ausschließlich). */
export const TONIGHT_FROM_HOUR = 16;
export const TONIGHT_UNTIL_HOUR = 23;

/**
 * D3 Etappe 2b · Soll Home den „Heute Abend“-Kopf ohne Plan zeigen (Orte, die jetzt offen haben)?
 * Nur am späten Nachmittag und Abend (16 bis 23 Uhr Berliner Zeit), nur mit Crew, nicht während einer
 * laufenden „Heute noch wer?“-Frage (deren Karte zeigt die Orte selbst), nicht, wenn heute ausgeblendet –
 * und nie, wenn für dich heute schon etwas ansteht: ein Plan am selben Kalendertag (`days === 0`) oder
 * einer im Fenster des Live-Countdowns (auch nach Mitternacht), es sei denn abgesagt oder von dir abgesagt.
 * `hour` und `days` rechnet der Aufrufer in Berliner Zeit, damit diese Datei ohne Abhängigkeiten bleibt.
 */
export function showTonightIdeas(
  {
    hour,
    hasCrew,
    askOpen,
    dismissed,
    plans,
  }: {
    hour: number;
    hasCrew: boolean;
    askOpen: boolean;
    dismissed: boolean;
    plans: readonly { starts_at: string; ends_at: string | null; status: string; days: number; mine: string | null }[];
  },
  now: Date,
): boolean {
  if (!hasCrew || askOpen || dismissed) return false;
  if (hour < TONIGHT_FROM_HOUR || hour >= TONIGHT_UNTIL_HOUR) return false;
  return !plans.some((plan) => plan.status !== "cancelled" && plan.mine !== "declined" && (plan.days === 0 || liveCountdown(plan, now) !== null));
}
