/**
 * P9 · Crew-Rückblick: was eine Crew schon gemeinsam erlebt hat – nur aus ihren eigenen Plänen.
 *
 * Ein „Abend“ ist ein abgeschlossener Plan (Status `completed`). Abgesagte, laufende und anstehende
 * Pläne zählen nicht. Alles in Berliner Zeit. Nichts wird geschätzt oder erfunden: Was sich aus den
 * Daten nicht ergibt (z. B. ein Lieblingstag bei nur zwei Abenden), bleibt leer.
 * Bewusst keine Rangliste von Personen – der Rückblick feiert die Crew, er vergleicht niemanden.
 *
 * Bewusst ohne Importe: Die Datei läuft unverändert im Unit-Test (`node --test`, Typen werden entfernt).
 */

export interface RecapPlan {
  id: string;
  title: string;
  starts_at: string;
  status: string;
  activity_id: string | null;
  participants: readonly { attendance_status: string }[];
}

export interface RecapPlace {
  /** Ort (activity_id) oder – ohne Ort – der Titel in Kleinbuchstaben. */
  key: string;
  /** Titel des jüngsten Abends an diesem Ort. */
  title: string;
  count: number;
}

export interface RecapMonth {
  /** „2026-10“ */
  key: string;
  count: number;
}

export interface CrewRecap {
  evenings: number;
  /** Beginn des ersten Abends (ISO) oder null. */
  firstAt: string | null;
  /** Längste Folge von Kalendermonaten mit mindestens einem Abend. */
  longestStreak: number;
  /** Größte Zahl an Zusagen bei einem Abend (0, wenn nie jemand zugesagt hat). */
  biggestRound: number;
  /** 0 = Sonntag … 6 = Samstag; nur ab drei Abenden und nur, wenn ein Tag eindeutig vorn liegt. */
  favoriteWeekday: number | null;
  /** Orte mit mindestens zwei Abenden, häufigste zuerst, höchstens drei. */
  places: RecapPlace[];
  /** Die letzten zwölf Kalendermonate bis einschließlich des aktuellen, älteste zuerst. */
  months: RecapMonth[];
}

const TIME_ZONE = "Europe/Berlin";
const monthFormat = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit" });
const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** „2026-10“ in Berliner Zeit. */
export function monthKey(value: string | Date): string {
  const parts = Object.fromEntries(monthFormat.formatToParts(new Date(value)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}`;
}

/** Wochentag in Berliner Zeit, 0 = Sonntag. */
export function berlinWeekday(value: string | Date): number {
  const parts = Object.fromEntries(dayFormat.formatToParts(new Date(value)).map((p) => [p.type, p.value]));
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day))).getUTCDay();
}

/** Laufende Monatsnummer (Jahr × 12 + Monat) aus „2026-10“. */
function monthIndex(key: string): number {
  const [y, m] = key.split("-").map(Number);
  return (y ?? 0) * 12 + ((m ?? 1) - 1);
}

function keyFromIndex(index: number): string {
  const year = Math.floor(index / 12);
  return `${year}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export function crewRecap(plans: readonly RecapPlan[], now: Date = new Date()): CrewRecap {
  const evenings = plans
    .filter((p) => p.status === "completed" && !Number.isNaN(new Date(p.starts_at).getTime()))
    .slice()
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.id.localeCompare(b.id));

  const perMonth = new Map<string, number>();
  const perWeekday = new Map<number, number>();
  const perPlace = new Map<string, RecapPlace>();
  let biggestRound = 0;

  for (const plan of evenings) {
    const month = monthKey(plan.starts_at);
    perMonth.set(month, (perMonth.get(month) ?? 0) + 1);
    const weekday = berlinWeekday(plan.starts_at);
    perWeekday.set(weekday, (perWeekday.get(weekday) ?? 0) + 1);
    const going = plan.participants.filter((p) => p.attendance_status === "going").length;
    biggestRound = Math.max(biggestRound, going);
    const title = plan.title.trim();
    const key = plan.activity_id ?? `title:${title.toLocaleLowerCase("de")}`;
    const place = perPlace.get(key);
    // Sortiert nach Beginn: Der zuletzt gesehene Titel ist der jüngste.
    perPlace.set(key, { key, title, count: (place?.count ?? 0) + 1 });
  }

  // Längste Serie über aufeinanderfolgende Kalendermonate.
  const indices = [...perMonth.keys()].map(monthIndex).sort((a, b) => a - b);
  let longestStreak = 0;
  let run = 0;
  for (let i = 0; i < indices.length; i++) {
    run = i > 0 && indices[i] === (indices[i - 1] ?? 0) + 1 ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
  }

  let favoriteWeekday: number | null = null;
  if (evenings.length >= 3) {
    const ranked = [...perWeekday.entries()].sort((a, b) => b[1] - a[1]);
    const [first, second] = ranked;
    if (first && (!second || first[1] > second[1])) favoriteWeekday = first[0];
  }

  const places = [...perPlace.values()]
    .filter((p) => p.count >= 2)
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title, "de"))
    .slice(0, 3);

  const current = monthIndex(monthKey(now));
  const months: RecapMonth[] = [];
  for (let index = current - 11; index <= current; index++) {
    const key = keyFromIndex(index);
    months.push({ key, count: perMonth.get(key) ?? 0 });
  }

  return {
    evenings: evenings.length,
    firstAt: evenings[0]?.starts_at ?? null,
    longestStreak,
    biggestRound,
    favoriteWeekday,
    places,
    months,
  };
}

const yearPartsFormat = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

function berlinParts(value: string | Date): { year: number; month: number; day: number } {
  const parts = Object.fromEntries(yearPartsFormat.formatToParts(new Date(value)).map((p) => [p.type, p.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

/** Kalenderjahr in Berliner Zeit (Silvester 23:30 Uhr gehört zum alten Jahr). */
export function berlinYear(value: string | Date): number {
  return berlinParts(value).year;
}

/**
 * P9 Etappe 3 · „Euer Jahr“: Welches Jahr der Rückblick anbietet und ob es hervorgehoben wird.
 * Im Dezember ist es das laufende Jahr, bis zum 15. Januar noch das alte (Rückblicke werden auch
 * nach Silvester geteilt) – dann öffnet der Rückblick gleich mit dem Jahr. Sonst gibt es das laufende
 * Jahr als Auswahl neben „Insgesamt“. Ohne Abend im Jahr gibt es nichts (kein leeres „Euer Jahr“).
 */
export interface RecapYearChoice {
  year: number;
  highlight: boolean;
}

function isEvening(plan: RecapPlan): boolean {
  return plan.status === "completed" && !Number.isNaN(new Date(plan.starts_at).getTime());
}

export function recapYearChoice(plans: readonly RecapPlan[], now: Date = new Date()): RecapYearChoice | null {
  const years = new Set(plans.filter(isEvening).map((p) => berlinYear(p.starts_at)));
  const today = berlinParts(now);
  if (today.month === 1 && today.day <= 15 && years.has(today.year - 1)) return { year: today.year - 1, highlight: true };
  if (years.has(today.year)) return { year: today.year, highlight: today.month === 12 };
  return null;
}

/**
 * P9 Etappe 3 · Rückblick nur über ein Kalenderjahr: dieselben Regeln wie `crewRecap`, aber nur Abende
 * dieses Jahres, und die Monate sind Januar bis Dezember (statt der letzten zwölf).
 */
export function crewYearRecap(plans: readonly RecapPlan[], year: number): CrewRecap {
  const inYear = plans.filter((p) => isEvening(p) && berlinYear(p.starts_at) === year);
  // Mitte Dezember als „jetzt“: Die letzten zwölf Monate sind dann genau Januar bis Dezember.
  return crewRecap(inYear, new Date(Date.UTC(year, 11, 15, 12)));
}
