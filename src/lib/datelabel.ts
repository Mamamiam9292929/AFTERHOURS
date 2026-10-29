/**
 * P11 Etappe 2c · Termine der Abstimmung „Wann könnt ihr?“ in der Sprache der Oberfläche.
 *
 * Der Server legt den Titel jedes Termins auf Deutsch an („Freitag, 17. Oktober“, `app_private.german_date_label`),
 * damit Benachrichtigungen, Stimmzettel und Teilen-Karte dasselbe zeigen. Die App ersetzt diesen Titel beim
 * Laden durch das Datum in der eigenen Sprache („Friday 17 October“) – aber nur, wenn der Titel genau der
 * vom Server ist. So bleiben Titel, die jemand anders gesetzt hat, unangetastet, und auf Deutsch ändert sich nichts.
 *
 * Ohne Importe, damit Unit-Tests die Datei direkt laden können.
 */

type Locale = "de" | "en";

const DE_WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const DE_MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const EN_WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** „2026-10-17“ → Wochentag (0 = Montag), Tag, Monat (0-basiert); null bei ungültigem Datum. */
function parts(date: string): { weekday: number; day: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const utc = new Date(Date.UTC(y, m - 1, d));
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== m - 1 || utc.getUTCDate() !== d) return null;
  return { weekday: (utc.getUTCDay() + 6) % 7, day: d, month: m - 1 };
}

/** Genau der Titel, den der Server anlegt: „Freitag, 17. Oktober“. */
export function germanDateLabel(date: string): string | null {
  const p = parts(date);
  return p ? `${DE_WEEKDAYS[p.weekday]}, ${p.day}. ${DE_MONTHS[p.month]}` : null;
}

/** Datum eines Termins in der Sprache der Oberfläche – Englisch britisch: „Friday 17 October“. */
export function dateLabel(date: string, locale: Locale): string | null {
  if (locale === "de") return germanDateLabel(date);
  const p = parts(date);
  return p ? `${EN_WEEKDAYS[p.weekday]} ${p.day} ${EN_MONTHS[p.month]}` : null;
}

/** Titel eines Termins: übersetzt, wenn er vom Server stammt, sonst unverändert. */
export function localizedDateTitle(title: string, date: string | null | undefined, locale: Locale): string {
  if (locale === "de" || !date || title !== germanDateLabel(date)) return title;
  return dateLabel(date, locale) ?? title;
}

interface DateOptionLike {
  title: string;
  proposed_date?: string | null;
}

/** Alle Termine einer Abstimmung übersetzen (nur bei „Wann könnt ihr?“; sonst dieselben Objekte zurück). */
export function localizeDateOptions<T extends DateOptionLike>(kind: string | null | undefined, options: T[], locale: Locale): T[] {
  if (kind !== "date" || locale === "de") return options;
  return options.map((option) => {
    const title = localizedDateTitle(option.title, option.proposed_date, locale);
    return title === option.title ? option : { ...option, title };
  });
}
