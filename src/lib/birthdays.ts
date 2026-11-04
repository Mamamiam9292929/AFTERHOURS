/**
 * P20 · Geburtstage in der Crew.
 *
 * Der Server liefert nur Person, Tag und Monat (`crew_birthdays`). Wann der nächste Geburtstag ist und
 * wie viele Tage es noch sind, rechnet die App mit dem heutigen Datum in Berliner Zeit (als YYYY-MM-DD
 * hereingereicht). Ein 29. Februar wird in Jahren ohne Schalttag am 28. gefeiert.
 *
 * Bewusst ohne Importe: Die Datei läuft unverändert im Unit-Test (`node --test`, Typen werden entfernt).
 */

export interface Birthday {
  user_id: string;
  month: number;
  day: number;
}

export interface UpcomingBirthday extends Birthday {
  /** Nächster Geburtstag ab heute, YYYY-MM-DD (heute zählt). */
  date: string;
  /** 0 = heute, 1 = morgen … */
  inDays: number;
}

/** So weit voraus zeigt die Crew-Seite Geburtstage. */
export const BIRTHDAY_WINDOW_DAYS = 30;

const isLeap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

export function daysInMonth(month: number, year?: number): number {
  if (month === 2) return year === undefined || isLeap(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Gültiger Geburtstag ohne Jahr (29. Februar erlaubt). */
export function isValidBirthday(month: number, day: number): boolean {
  return Number.isInteger(month) && Number.isInteger(day) && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(month);
}

const pad = (n: number) => String(n).padStart(2, "0");
const toUtc = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
};

/** Tage zwischen zwei Kalenderdaten (YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

function dateIn(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(Math.min(day, daysInMonth(month, year)))}`;
}

/** Nächster Geburtstag ab `today` (heute eingeschlossen). */
export function nextBirthday(month: number, day: number, today: string): string {
  const year = Number(today.slice(0, 4));
  const thisYear = dateIn(year, month, day);
  return thisYear >= today ? thisYear : dateIn(year + 1, month, day);
}

/** Geburtstage innerhalb der nächsten `windowDays` Tage, der nächste zuerst (bei Gleichstand stabil nach Person). */
export function upcomingBirthdays<T extends Birthday>(list: readonly T[], today: string, windowDays = BIRTHDAY_WINDOW_DAYS): (T & UpcomingBirthday)[] {
  return list
    .filter((b) => isValidBirthday(b.month, b.day))
    .map((b) => {
      const date = nextBirthday(b.month, b.day, today);
      return { ...b, date, inDays: daysBetween(today, date) };
    })
    .filter((b) => b.inDays <= windowDays)
    .sort((a, b) => a.inDays - b.inDays || a.user_id.localeCompare(b.user_id));
}

const WEEKDAY = (date: string) => new Date(toUtc(date)).getUTCDay();
const plusDays = (date: string, days: number) => new Date(toUtc(date) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Termine für „Wann feiern wir?“ rund um einen Geburtstag: der Tag selbst und das Wochenende (Freitag,
 * Samstag) davor bzw. – liegt der Geburtstag selbst am Wochenende oder früh in der Woche – das davor und
 * danach. Nur Termine ab heute, sortiert, ohne Doppelte; höchstens vier.
 *
 * - Fr/Sa: Tag selbst, dazu der andere Wochenendtag und Freitag eine Woche später.
 * - So–Mi: das Wochenende davor (wenn noch nicht vorbei) und der Tag selbst.
 * - Do: der Tag selbst und das Wochenende direkt danach.
 */
export function birthdaySlots(date: string, today: string): string[] {
  const weekday = WEEKDAY(date);
  const candidates: string[] = [date];
  if (weekday === 5) candidates.push(plusDays(date, 1), plusDays(date, 7));
  else if (weekday === 6) candidates.push(plusDays(date, -1), plusDays(date, 6));
  else if (weekday === 4) candidates.push(plusDays(date, 1), plusDays(date, 2));
  else {
    // So (0) … Mi (3): Freitag und Samstag davor.
    const back = weekday === 0 ? 2 : weekday + 2;
    candidates.push(plusDays(date, -back), plusDays(date, -back + 1));
    // Liegt das Wochenende davor schon hinter uns, das danach.
    if (plusDays(date, -back) < today) {
      const ahead = 5 - weekday;
      candidates.push(plusDays(date, ahead), plusDays(date, ahead + 1));
    }
  }
  return [...new Set(candidates)].filter((d) => d >= today).sort().slice(0, 4);
}

/** P20 Etappe 2: So weit voraus zeigt Home Geburtstage – so weit vorher kommt auch die Erinnerung. */
export const HOME_BIRTHDAY_DAYS = 7;

export interface CrewBirthday extends Birthday {
  crew_id: string;
}

export interface HomeBirthday extends UpcomingBirthday {
  crew_id: string;
}

/**
 * Geburtstage für Home aus `my_crew_birthdays` (eine Zeile je Person und Crew, ohne die eigene Person):
 * jede Person einmal – mit der ersten Crew in `crewOrder` (Reihenfolge der Crews in der App), sonst der
 * ersten gelieferten –, nur heute bis in `windowDays` Tagen, der nächste zuerst.
 */
export function homeBirthdays(
  rows: readonly CrewBirthday[],
  today: string,
  userId: string,
  crewOrder: readonly string[] = [],
  windowDays = HOME_BIRTHDAY_DAYS,
): HomeBirthday[] {
  const rank = (crewId: string) => {
    const index = crewOrder.indexOf(crewId);
    return index === -1 ? crewOrder.length : index;
  };
  const byPerson = new Map<string, CrewBirthday>();
  for (const row of rows) {
    if (row.user_id === userId) continue;
    const seen = byPerson.get(row.user_id);
    if (!seen || rank(row.crew_id) < rank(seen.crew_id)) byPerson.set(row.user_id, row);
  }
  return upcomingBirthdays([...byPerson.values()], today, windowDays);
}

/** „Feier planen“: Termin-Abstimmung für die Crew rund um den Geburtstag (`PollCreatePage` liest `birthday`/`for`). */
export function birthdayPollLink(crewId: string, date: string, name: string): string {
  const params = new URLSearchParams({ crew: crewId, kind: "date", birthday: date, for: name });
  return `/polls/new?${params.toString()}`;
}
