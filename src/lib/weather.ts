/**
 * P5 · Wetter zum Plan: Wettercodes (WMO, wie Open-Meteo sie liefert) in Arten übersetzen und
 * entscheiden, wann ein Hinweis für Draußen-Pläne sinnvoll ist. Ohne Abhängigkeiten, damit
 * tests/unit/weather.test.mjs die Datei direkt laden kann.
 */

export type WeatherKind = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "freezing" | "snow" | "showers" | "thunder" | "unknown";

/** Antwort der Edge Function `weather`. */
export type PlanWeather =
  | { status: "past" | "no_location" }
  | { status: "too_far"; available_from: string; setting: string | null }
  | {
      status: "ok";
      day: string;
      hour: number;
      temperature: number | null;
      precipitation_probability: number | null;
      weather_code: number | null;
      wind_speed: number | null;
      setting: string | null;
      fetched_at: string | null;
      source: string;
    };

/** P5 Etappe 2: Wetter je Vorschlag einer laufenden Abstimmung (Edge Function `weather` mit `poll_id`). */
export type PollOptionWeather =
  | { option_id: string; status: "too_far"; available_from: string }
  | { option_id: string; status: "unavailable" }
  | {
      option_id: string;
      status: "ok";
      /** hour: Stunde des Termins; day: Vorschlag ohne Uhrzeit, höchste Werte zwischen 10 und 22 Uhr. */
      mode: "hour" | "day";
      hour: number | null;
      temperature: number | null;
      precipitation_probability: number | null;
      weather_code: number | null;
      wind_speed: number | null;
      setting: string | null;
    };

export type PollWeather =
  | { status: "closed" }
  | { status: "open"; options: PollOptionWeather[]; fetched_at: string | null; source: string };

/** WMO-Wettercode → Art. Unbekannte Codes bleiben unbekannt statt geraten. */
export function weatherKind(code: number | null | undefined): WeatherKind {
  if (code == null) return "unknown";
  if (code === 0) return "clear";
  if (code === 1 || code === 2) return "partly";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 55) return "drizzle";
  if (code === 56 || code === 57 || code === 66 || code === 67) return "freezing";
  if (code >= 61 && code <= 65) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 80 && code <= 82) return "showers";
  if (code >= 95 && code <= 99) return "thunder";
  return "unknown";
}

/** Gerundete Temperatur für die Anzeige („14 °C“, „-2 °C“, nie „-0 °C“). */
export function formatTemperature(celsius: number): string {
  const rounded = Math.round(celsius);
  return `${rounded === 0 ? 0 : rounded} °C`;
}

export type OutdoorHint = "rain" | "thunder" | "snow" | "cold" | null;

/**
 * Hinweis nur bei Plänen, die (auch) draußen stattfinden, und nur bei klaren Signalen:
 * Gewitter, Schnee/Eisregen, Regenrisiko ab 50 % oder höchstens 3 °C.
 */
export function outdoorHint(weather: { setting: string | null; precipitation_probability: number | null; weather_code: number | null; temperature: number | null }): OutdoorHint {
  if (weather.setting !== "outdoor" && weather.setting !== "both") return null;
  const kind = weatherKind(weather.weather_code);
  if (kind === "thunder") return "thunder";
  if (kind === "snow" || kind === "freezing") return "snow";
  if ((weather.precipitation_probability ?? 0) >= 50 || kind === "rain" || kind === "showers") return "rain";
  if (weather.temperature != null && weather.temperature <= 3) return "cold";
  return null;
}
