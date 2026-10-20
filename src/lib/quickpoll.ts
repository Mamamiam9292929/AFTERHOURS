/**
 * S1 · Ein Satz, eine Abstimmung: zerlegt einen Satz wie im Gruppenchat („bowling oder kino, fr oder sa,
 * 20 uhr“) in Aktivitäten, Tage und Uhrzeit. Läuft komplett im Browser, ohne KI und ohne Netz.
 * Bewusst einfach und vorhersehbar: Was nicht erkannt wird, bleibt als Aktivität stehen – die Vorschau
 * zeigt alles, bevor etwas abgeschickt wird.
 *
 * Keine Importe aus `@/`, damit die Unit-Tests (`tests/unit/quickpoll.test.mjs`) die Datei direkt laden.
 */

export interface QuickDay {
  /** YYYY-MM-DD in Berliner Zeit */
  date: string;
  /** „Fr 24.10.“ */
  label: string;
}

export interface QuickOption {
  title: string;
  proposed_date: string | null;
  proposed_time: string | null;
}

export interface QuickPoll {
  activities: string[];
  days: QuickDay[];
  /** HH:MM oder null */
  time: string | null;
  title: string;
  options: QuickOption[];
  /** Ende der Abstimmung (ISO). */
  endsAt: string;
}

export const MAX_OPTIONS = 10;

const WEEKDAYS: Record<string, number> = {
  so: 0, sonntag: 0, sonntags: 0,
  mo: 1, montag: 1, montags: 1,
  di: 2, dienstag: 2, dienstags: 2,
  mi: 3, mittwoch: 3, mittwochs: 3,
  do: 4, donnerstag: 4, donnerstags: 4,
  fr: 5, freitag: 5, freitags: 5,
  sa: 6, samstag: 6, samstags: 6, sonnabend: 6,
};
const SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

/** Füllwörter aus dem Chat, die keine Aktivität sind. */
const FILLER = [
  "wer hat bock auf", "wer hat lust auf", "wer hat bock", "wer hat lust", "jemand bock auf", "jemand lust auf", "jemand bock", "jemand lust",
  "hat jemand bock auf", "hat jemand lust auf", "habt ihr bock auf", "habt ihr lust auf", "bock auf", "lust auf", "lass mal", "lasst uns",
  "gehen wir", "wollen wir", "sollen wir", "wie wärs mit", "wie wäre es mit", "was ist mit", "vielleicht", "diese woche", "nächste woche",
  "am", "an", "um", "ab", "so gegen", "gegen", "zum", "zur", "ins", "in die", "in den", "ne runde", "eine runde", "noch", "mal", "wer", "abends", "abend",
  "nächsten", "nächste", "kommenden", "kommende", "diesen", "jeden",
];

/** Wörter, nach denen eine Kurzform („am so“, „jeden do“) sicher ein Wochentag ist. */
const DAY_LEAD = ["am", "ab", "bis", "jeden", "nächsten", "nächster", "kommenden", "diesen"];

/** Tageszeit an Tagesnamen: „Samstagabend“, „freitagnachts“, „sonntagmorgen“, „morgenabend“. */
const DAYTIME_SUFFIX = /(abends?|nachmittags?|vormittags?|mittags?|morgens?|nachts?)$/;

interface BerlinNow {
  date: string;
  weekday: number;
  year: number;
}

function berlinNow(now: Date): BerlinNow {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday ?? "");
  return { date, weekday, year: Number(parts.year) };
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function dayLabel(date: string): string {
  const [, m, d] = date.split("-");
  return `${SHORT[weekdayOf(date)]} ${d}.${m}.`;
}

/** Berliner Ortszeit → UTC-Zeitpunkt (Sommer-/Winterzeit über Intl). */
function berlinToUtc(date: string, time: string): Date {
  const guess = new Date(`${date}T${time}:00Z`);
  const shown = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(guess);
  const [h = 0, m = 0] = shown.split(":").map(Number);
  const [th = 0, tm = 0] = time.split(":").map(Number);
  const diff = (h * 60 + m - (th * 60 + tm) + 1440) % 1440;
  const offset = diff > 720 ? diff - 1440 : diff;
  return new Date(guess.getTime() - offset * 60_000);
}

function normalizeTime(h: number, m: number, explicitEvening: boolean): string | null {
  if (!Number.isInteger(h) || !Number.isInteger(m) || m < 0 || m > 59) return null;
  // „um 8“ im Chat meint den Abend; 10 und 11 bleiben vormittags nur mit „uhr morgens“ – das kennen wir nicht.
  if (h >= 1 && h <= 9 && !explicitEvening) h += 12;
  if (explicitEvening && h < 12) h += 12;
  if (h < 0 || h > 23) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toLocaleUpperCase("de") + s.slice(1);
}

/** Füllwörter nur vorne und hinten abschneiden – „Grillen am See“ bleibt ganz. */
function stripFiller(phrase: string): string {
  let p = phrase.replace(/\s+/g, " ").trim();
  const low = () => p.toLocaleLowerCase("de");
  const sorted = [...FILLER].sort((a, b) => b.length - a.length);
  for (let changed = true; changed; ) {
    changed = false;
    for (const f of sorted) {
      if (low() === f) return "";
      if (low().startsWith(`${f} `)) {
        p = p.slice(f.length + 1);
        changed = true;
      } else if (low().endsWith(` ${f}`)) {
        p = p.slice(0, -f.length - 1);
        changed = true;
      }
    }
  }
  return p;
}

/** Wochentag ab heute (heute zählt, wenn es derselbe Tag ist). */
function nextWeekday(now: BerlinNow, weekday: number): string {
  return addDays(now.date, (weekday - now.weekday + 7) % 7);
}

export function parseQuickPoll(input: string, now: Date = new Date()): QuickPoll {
  const today = berlinNow(now);
  const days: string[] = [];
  const activities: string[] = [];
  let time: string | null = null;
  const addDay = (d: string) => {
    if (!days.includes(d)) days.push(d);
  };

  // Schreibweise bleibt erhalten („Grillen am See“); verglichen wird klein geschrieben.
  let text = ` ${input.replace(/[!?]+/g, " ").replace(/\s+/g, " ")} `;

  // Datum zuerst (mit Punkt am Ende): „24.10.“ oder „24.10.2026“ – sonst hielte die Uhrzeit „24.10“ für sich.
  text = text.replace(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})?/g, (all, d: string, m: string, y?: string) => {
    const dd = Number(d);
    const mm = Number(m);
    if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return all;
    let year = y ? Number(y) : today.year;
    let iso = `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    if (!y && iso < today.date) {
      year += 1;
      iso = `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }
    addDay(iso);
    return " , ";
  });

  // Uhrzeit: „20 uhr“, „20:30“, „20.30 uhr“, „um 8“, „8 uhr abends“, „20h“, „halb 8“, „viertel nach 8“.
  // „so gegen 9“ ist ungefähr, kein Sonntag; „am so um 8“ bleibt Sonntag. „rum“ dahinter gehört dazu.
  // (Ohne Lookbehind, damit ältere Safari-Versionen den Ausdruck laden.)
  text = text.replace(/\bam\s+so\b\.?/gi, "am sonntag");
  const lead = String.raw`(?:\bso\s+(?=gegen|um\s))?(?:\b(?:um|ab|gegen)\s*)?`;
  const tail = String.raw`(?:\s*(?:uhr|h\b))?(?:\s*(abends))?(?:\s+(?:rum|herum)\b)?`;
  const timePatterns: { re: RegExp; hour: (h: number) => number; minute: number | null }[] = [
    { re: new RegExp(String.raw`${lead}\bhalb\s+(\d{1,2})\b(?![.:]\d)${tail}`, "i"), hour: (h) => h - 1, minute: 30 },
    { re: new RegExp(String.raw`${lead}\bviertel\s+nach\s+(\d{1,2})\b(?![.:]\d)${tail}`, "i"), hour: (h) => h, minute: 15 },
    { re: new RegExp(String.raw`${lead}\b(?:viertel\s+vor|dreiviertel)\s+(\d{1,2})\b(?![.:]\d)${tail}`, "i"), hour: (h) => h - 1, minute: 45 },
    { re: new RegExp(String.raw`${lead}\b(\d{1,2})[:.](\d{2})${tail}`, "i"), hour: (h) => h, minute: null },
    { re: new RegExp(String.raw`${lead}\b(\d{1,2})\s*(?:uhr|h\b)(?:\s*(abends))?(?:\s+(?:rum|herum)\b)?`, "i"), hour: (h) => h, minute: 0 },
    { re: new RegExp(String.raw`(?:\bso\s+(?=gegen|um\s))?\b(?:um|ab|gegen)\s+(\d{1,2})\b(?![.:]\d)(?:\s*(abends))?(?:\s+(?:rum|herum)\b)?`, "i"), hour: (h) => h, minute: 0 },
  ];
  for (const { re, hour, minute } of timePatterns) {
    const m = re.exec(text);
    if (!m) continue;
    const minutes = minute ?? Number(m[2]);
    const evening = Boolean(minute === null ? m[3] : m[2]);
    const h = hour(Number(m[1]));
    const t = normalizeTime(h < 0 ? 23 : h, minutes, evening);
    if (t) {
      time = t;
      text = text.replace(m[0], " , ");
      break;
    }
  }

  // Phrasen trennen: Komma, „oder“, „/“, „und“, Zeilen
  const phrases = text
    .split(/,|;|\/|\n|\boder\b|\bund\b|\s-\s/i)
    .map((p) => p.trim())
    .filter(Boolean);

  for (const raw of phrases) {
    const words = raw.split(" ").filter(Boolean);
    const key = (w: string) => {
      const k = w.toLocaleLowerCase("de").replace(/[.:]+$/, "");
      // „Samstagabend“ → „samstag“, „morgenabend“ → „morgen“; „morgens“ allein bleibt, wie es ist.
      const base = k.replace(DAYTIME_SUFFIX, "");
      if (base !== k && ((base.length > 2 && base in WEEKDAYS) || ["heute", "morgen", "übermorgen"].includes(base))) return base;
      return k === "we" ? "wochenende" : k;
    };
    const isDayWord = (w: string) => key(w) in WEEKDAYS || ["heute", "heut", "morgen", "übermorgen", "uebermorgen", "wochenende"].includes(key(w));
    // Kurzformen („do“, „so“, „mi“) sind im Deutschen auch normale Wörter: als Wochentag nur nach „am“,
    // „jeden“ & Co., in kurzen Phrasen oder am Anfang/Ende; „so“ zusätzlich nur mit Punkt, in einer reinen
    // Tagesliste oder am Rand einer kurzen Phrase („Brunch so“).
    const others = words.filter((w) => !isDayWord(w)).length;
    const rest: string[] = [];
    for (const [i, w] of words.entries()) {
      const word = key(w);
      const short = word.length === 2 && word in WEEKDAYS;
      const led = i > 0 && DAY_LEAD.includes(key(words[i - 1] ?? ""));
      const edge = i === 0 || i === words.length - 1;
      const shortOk =
        !short || led || (word === "so" ? others === 0 || w.endsWith(".") || (edge && others <= 2) : others <= 2 || edge);
      if (word === "heute" || word === "heut") addDay(today.date);
      else if (word === "morgen") addDay(addDays(today.date, 1));
      else if (word === "übermorgen" || word === "uebermorgen") addDay(addDays(today.date, 2));
      else if (word === "wochenende") {
        addDay(nextWeekday(today, 5));
        addDay(nextWeekday(today, 6));
      } else if (word in WEEKDAYS && shortOk) addDay(nextWeekday(today, WEEKDAYS[word] ?? 0));
      else rest.push(w);
    }
    const activity = stripFiller(rest.join(" ")).replace(/^[-–]+|[-–.]+$/g, "").trim();
    if (activity.length >= 2 && !/^[\d:.\s]+$/.test(activity)) {
      const nice = capitalize(activity).slice(0, 60);
      if (!activities.some((a) => a.toLocaleLowerCase("de") === nice.toLocaleLowerCase("de"))) activities.push(nice);
    }
  }

  days.sort();
  const quickDays = days.map((date) => ({ date, label: dayLabel(date) }));

  const options: QuickOption[] = [];
  const acts = activities.length ? activities : [null];
  const dates = days.length ? days : [null];
  for (const d of dates) {
    for (const a of acts) {
      if (options.length >= MAX_OPTIONS) break;
      options.push({ title: a ?? (d ? (LONG[weekdayOf(d)] ?? "") : ""), proposed_date: d, proposed_time: d ? time : null });
    }
  }

  return { activities, days: quickDays, time, title: buildTitle(activities, days, today), options: options.filter((o) => o.title), endsAt: endsAt(days, time, now).toISOString() };
}

function buildTitle(activities: string[], days: string[], today: BerlinNow): string {
  if (days.length === 1) {
    const d = days[0] ?? today.date;
    if (d === today.date) return "Was geht heute?";
    if (d === addDays(today.date, 1)) return "Was geht morgen?";
    return `Was geht ${LONG[weekdayOf(d)]}?`;
  }
  if (days.length > 1) {
    const wd = days.map((d) => weekdayOf(d));
    if (days.length === 2 && wd[0] === 5 && wd[1] === 6) return "Was geht am Wochenende?";
    return `Wann geht ${activities.length === 1 ? activities[0] : "was"}?`;
  }
  if (activities.length === 1) return `${activities[0]} – wer ist dabei?`;
  if (activities.length > 1) return "Was machen wir?";
  return "Was geht?";
}

/**
 * Wann entscheidet sich die Abstimmung? Am frühesten Termin um 12:00 (bei „heute“ in 2 Stunden), ohne
 * Termin nach 48 Stunden; immer mindestens 1 Stunde und höchstens 89 Tage ab jetzt (Server-Grenze 90).
 */
function endsAt(days: string[], time: string | null, now: Date): Date {
  const min = now.getTime() + 60 * 60_000;
  const max = now.getTime() + 89 * 24 * 60 * 60_000;
  let target: number;
  if (days.length === 0) target = now.getTime() + 48 * 60 * 60_000;
  else {
    const first = days[0] ?? "";
    const noon = berlinToUtc(first, "12:00").getTime();
    target = noon > now.getTime() + 2 * 60 * 60_000 ? noon : now.getTime() + 2 * 60 * 60_000;
    if (time) {
      const start = berlinToUtc(first, time).getTime();
      if (start - 30 * 60_000 < target) target = start - 30 * 60_000;
    }
  }
  return new Date(Math.min(max, Math.max(min, target)));
}
