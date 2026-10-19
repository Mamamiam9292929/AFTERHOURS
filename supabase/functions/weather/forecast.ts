/**
 * P5 · Wetter: Abfrage bei Open-Meteo und Umwandlung der Antwort – ohne Netz testbar (forecast_test.ts).
 *
 * Open-Meteo (https://open-meteo.com): frei ohne Schlüssel für nicht-kommerzielle Nutzung, Daten unter
 * CC BY 4.0 – die App nennt die Quelle bei jeder Vorhersage. Gefragt werden nur ein gerundeter Ort und
 * ein Tag, Zeitzone Europe/Berlin, damit die Stunden zur Planzeit passen.
 */

export const DEFAULT_OPEN_METEO_URL = "https://api.open-meteo.com";
const TIMEOUT_MS = 8_000;

export interface HourForecast {
  hour: number;
  temperature: number | null;
  precipitation_probability: number | null;
  weather_code: number | null;
  wind_speed: number | null;
}

export class WeatherError extends Error {
  constructor(readonly code: "weather_unavailable" | "weather_busy") {
    super(code);
  }
}

export function forecastUrl(base: string, latitude: number, longitude: number, day: string): string {
  const url = new URL("/v1/forecast", base.replace(/\/+$/, "") + "/");
  url.searchParams.set("latitude", latitude.toFixed(2));
  url.searchParams.set("longitude", longitude.toFixed(2));
  url.searchParams.set("hourly", "temperature_2m,precipitation_probability,weather_code,wind_speed_10m");
  url.searchParams.set("timezone", "Europe/Berlin");
  url.searchParams.set("start_date", day);
  url.searchParams.set("end_date", day);
  return url.toString();
}

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** Stundenwerte eines Tages; null, wenn die Antwort nicht die erwartete Form hat. */
export function parseForecast(data: unknown, day: string): HourForecast[] | null {
  const hourly = (data as { hourly?: Record<string, unknown> } | null)?.hourly;
  if (!hourly || !Array.isArray(hourly.time)) return null;
  const column = (name: string) => (Array.isArray(hourly[name]) ? (hourly[name] as unknown[]) : []);
  const temperature = column("temperature_2m");
  const precipitation = column("precipitation_probability");
  const code = column("weather_code");
  const wind = column("wind_speed_10m");
  const hours: HourForecast[] = [];
  (hourly.time as unknown[]).forEach((time, i) => {
    // "2026-10-24T20:00" – Ortszeit, weil timezone=Europe/Berlin
    const match = typeof time === "string" ? /^(\d{4}-\d{2}-\d{2})T(\d{2}):00$/.exec(time) : null;
    if (!match || match[1] !== day) return;
    const hour = Number(match[2]);
    if (hours.some((h) => h.hour === hour)) return; // Zeitumstellung: doppelte Stunde nur einmal
    hours.push({
      hour,
      temperature: num(temperature[i]),
      precipitation_probability: num(precipitation[i]),
      weather_code: num(code[i]),
      wind_speed: num(wind[i]),
    });
  });
  const usable = hours.filter((h) => h.temperature != null || h.weather_code != null);
  return usable.length > 0 ? usable.slice(0, 24) : null;
}

/** Die Stunde des Planbeginns; fehlt sie (z. B. Zeitumstellung), die nächstgelegene. */
export function pickHour(hours: HourForecast[], hour: number): HourForecast | null {
  if (hours.length === 0) return null;
  return [...hours].sort((a, b) => Math.abs(a.hour - hour) - Math.abs(b.hour - hour) || a.hour - b.hour)[0];
}

export async function fetchForecast(
  base: string,
  latitude: number,
  longitude: number,
  day: string,
  fetcher: typeof fetch = fetch,
): Promise<HourForecast[]> {
  let response: Response;
  try {
    response = await fetcher(forecastUrl(base, latitude, longitude, day), {
      headers: { Accept: "application/json", "User-Agent": "AFTERHOURS/0.2" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new WeatherError("weather_unavailable");
  }
  if (response.status === 429) {
    await response.body?.cancel().catch(() => undefined);
    throw new WeatherError("weather_busy");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new WeatherError("weather_unavailable");
  }
  const data = await response.json().catch(() => null);
  const hours = parseForecast(data, day);
  if (!hours) throw new WeatherError("weather_unavailable");
  return hours;
}
