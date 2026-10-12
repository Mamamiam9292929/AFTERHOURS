import { zonedParts } from "./time";
import type { OpeningHours, Weekday } from "./types";

export const WEEK: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export type OpenState =
  | { state: "unknown" }
  | { state: "open"; closesAt: string }
  | { state: "closed"; opensAt: string | null; opensDay: Weekday | null };

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/**
 * Ist ein Ort zu einem Zeitpunkt (Berliner Zeit) geöffnet? Zeitfenster, die über Mitternacht
 * laufen ("18:00"–"03:00"), werden dem Starttag zugerechnet. Ohne Daten: "unknown".
 */
export function openStateAt(hours: OpeningHours | null | undefined, at: Date = new Date()): OpenState {
  if (!hours || Object.keys(hours).length === 0) return { state: "unknown" };
  const now = zonedParts(at);
  const minutes = now.hour * 60 + now.minute;
  const todayIndex = WEEK.indexOf(now.weekday);
  const yesterday = WEEK[(todayIndex + 6) % 7] as Weekday;

  for (const [from, to] of hours[yesterday] ?? []) {
    if (toMinutes(to) <= toMinutes(from) && minutes < toMinutes(to)) return { state: "open", closesAt: to };
  }
  for (const [from, to] of hours[now.weekday] ?? []) {
    const start = toMinutes(from);
    const end = toMinutes(to);
    if (end > start ? minutes >= start && minutes < end : minutes >= start) return { state: "open", closesAt: to };
  }
  for (let offset = 0; offset < 7; offset++) {
    const day = WEEK[(todayIndex + offset) % 7] as Weekday;
    const next = (hours[day] ?? []).map(([from]) => from).filter((from) => offset > 0 || toMinutes(from) > minutes).sort()[0];
    if (next) return { state: "closed", opensAt: next, opensDay: offset === 0 ? null : day };
  }
  return { state: "closed", opensAt: null, opensDay: null };
}
