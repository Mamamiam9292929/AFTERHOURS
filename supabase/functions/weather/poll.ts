/**
 * P5 Etappe 2 · Wetter je Vorschlag einer laufenden Abstimmung – ohne Netz testbar (poll_test.ts).
 *
 * poll_weather liefert je Vorschlag mit Ort und Termin, was zu tun ist. Hier wird jeder Ort und Tag
 * höchstens einmal abgefragt (mehrere Vorschläge am selben Ort und Tag teilen sich die Abfrage) und
 * je Vorschlag die passende Antwort gebaut: die Stunde des Termins oder – ohne Uhrzeit – eine
 * Zusammenfassung des Tages.
 */
import { type HourForecast, pickHour, summarizeDay, WeatherError } from "./forecast.ts";

export interface PollOptionInfo {
  option_id: string;
  status: "too_far" | "fetch" | "cached";
  latitude?: number;
  longitude?: number;
  day?: string;
  hour?: number | null;
  setting?: string | null;
  available_from?: string;
  hourly?: HourForecast[] | null;
  fetched_at?: string | null;
}

export interface PollWeatherInfo {
  status: "open" | "closed";
  options?: PollOptionInfo[];
}

export type PollOptionWeather =
  | { option_id: string; status: "too_far"; available_from: string }
  | { option_id: string; status: "unavailable" }
  | {
      option_id: string;
      status: "ok";
      /** hour: Stunde des Termins; day: Vorschlag ohne Uhrzeit, Werte zwischen 10 und 22 Uhr. */
      mode: "hour" | "day";
      hour: number | null;
      temperature: number | null;
      precipitation_probability: number | null;
      weather_code: number | null;
      wind_speed: number | null;
      setting: string | null;
    };

export type PollWeatherResult =
  | { status: "closed" }
  | { status: "open"; options: PollOptionWeather[]; fetched_at: string | null; source: "Open-Meteo" };

/** Holt die Stundenwerte eines Tages (Open-Meteo) und legt sie ab; liefert den Abrufzeitpunkt mit. */
export type FetchDay = (latitude: number, longitude: number, day: string) => Promise<{ hours: HourForecast[]; fetchedAt: string }>;

/** Höchstens so viele verschiedene Orte/Tage je Anfrage (eine Abstimmung hat höchstens 10 Vorschläge). */
export const MAX_LOOKUPS = 10;

const keyOf = (o: PollOptionInfo) => `${Number(o.latitude).toFixed(2)}|${Number(o.longitude).toFixed(2)}|${o.day}`;

export async function buildPollWeather(info: PollWeatherInfo, fetchDay: FetchDay): Promise<PollWeatherResult> {
  if (info.status !== "open") return { status: "closed" };
  const options = Array.isArray(info.options) ? info.options : [];

  // Gespeicherte Tage zuerst; was fehlt, einmal je Ort und Tag abfragen.
  const known = new Map<string, { hours: HourForecast[]; fetchedAt: string | null }>();
  for (const o of options) {
    if (o.status === "cached" && Array.isArray(o.hourly) && o.hourly.length > 0 && o.day) known.set(keyOf(o), { hours: o.hourly, fetchedAt: o.fetched_at ?? null });
  }
  const missing = new Map<string, PollOptionInfo>();
  for (const o of options) {
    if (o.status === "too_far" || o.latitude == null || o.longitude == null || !o.day) continue;
    const key = keyOf(o);
    if (!known.has(key) && !missing.has(key) && missing.size < MAX_LOOKUPS) missing.set(key, o);
  }
  const errors: WeatherError[] = [];
  await Promise.all(
    [...missing.entries()].map(async ([key, o]) => {
      try {
        const { hours, fetchedAt } = await fetchDay(Number(o.latitude), Number(o.longitude), o.day as string);
        known.set(key, { hours, fetchedAt });
      } catch (error) {
        errors.push(error instanceof WeatherError ? error : new WeatherError("weather_unavailable"));
      }
    }),
  );

  const result: PollOptionWeather[] = [];
  const stamps: string[] = [];
  for (const o of options) {
    if (o.status === "too_far") {
      if (o.available_from) result.push({ option_id: o.option_id, status: "too_far", available_from: o.available_from });
      continue;
    }
    if (o.latitude == null || o.longitude == null || !o.day) continue;
    const day = known.get(keyOf(o));
    const hour = typeof o.hour === "number" ? o.hour : null;
    const values = day ? (hour == null ? summarizeDay(day.hours) : pickHour(day.hours, hour)) : null;
    if (!day || !values) {
      result.push({ option_id: o.option_id, status: "unavailable" });
      continue;
    }
    if (day.fetchedAt) stamps.push(day.fetchedAt);
    result.push({
      option_id: o.option_id,
      status: "ok",
      mode: hour == null ? "day" : "hour",
      hour: hour == null ? null : (values as HourForecast).hour,
      temperature: values.temperature,
      precipitation_probability: values.precipitation_probability,
      weather_code: values.weather_code,
      wind_speed: values.wind_speed,
      setting: o.setting ?? null,
    });
  }

  // Ging gar nichts, ist das ein Fehler (mit „Erneut versuchen“), kein stilles Weglassen.
  const asked = result.filter((r) => r.status !== "too_far");
  if (asked.length > 0 && asked.every((r) => r.status === "unavailable")) {
    throw errors.find((e) => e.code === "weather_busy") ?? new WeatherError("weather_unavailable");
  }
  // Der älteste Stand gilt für alle – so behauptet die Anzeige nie, etwas sei frischer als es ist.
  const fetchedAt = stamps.length > 0 ? stamps.reduce((a, b) => (new Date(a) <= new Date(b) ? a : b)) : null;
  return { status: "open", options: result, fetched_at: fetchedAt, source: "Open-Meteo" };
}
