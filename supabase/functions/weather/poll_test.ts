// deno test supabase/functions/weather/poll_test.ts
// P5 Etappe 2: Wetter je Vorschlag einer Abstimmung – ohne Netz, mit nachgebauter Abfrage.
import { type HourForecast, summarizeDay, weatherSeverity, WeatherError } from "./forecast.ts";
import { buildPollWeather, type PollOptionInfo } from "./poll.ts";

function eq(actual: unknown, expected: unknown, message = ""): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message} erwartet ${JSON.stringify(expected)}, erhalten ${JSON.stringify(actual)}`);
}

const hours = (fn: (h: number) => Partial<HourForecast> = () => ({})): HourForecast[] =>
  Array.from({ length: 24 }, (_, h) => ({ hour: h, temperature: 10 + h / 2, precipitation_probability: 10, weather_code: 2, wind_speed: 8, ...fn(h) }));

const option = (id: string, extra: Partial<PollOptionInfo> = {}): PollOptionInfo => ({
  option_id: id, status: "fetch", latitude: 52.52, longitude: 13.5, day: "2026-10-24", hour: 20, setting: "indoor", hourly: null, fetched_at: null, ...extra,
});

Deno.test("Tag ohne Uhrzeit: höchste Werte und ungünstigstes Wetter zwischen 10 und 22 Uhr", () => {
  const day = hours((h) => ({
    temperature: h === 3 ? 30 : 10 + h / 2, // 3 Uhr nachts zählt nicht
    precipitation_probability: h === 16 ? 60 : h === 23 ? 100 : 10,
    weather_code: h === 15 ? 80 : h === 4 ? 95 : 2,
    wind_speed: h === 12 ? 20 : 8,
  }));
  eq(summarizeDay(day), { temperature: 21, precipitation_probability: 60, weather_code: 80, wind_speed: 20 });
});

Deno.test("Tag ohne Uhrzeit: fehlen die Tagesstunden, zählt der ganze Tag; fehlende Werte bleiben leer", () => {
  eq(summarizeDay([{ hour: 2, temperature: null, precipitation_probability: null, weather_code: 3, wind_speed: null }]),
    { temperature: null, precipitation_probability: null, weather_code: 3, wind_speed: null });
  eq(summarizeDay([]), null);
});

Deno.test("Rangfolge der Wettercodes: Gewitter vor Schnee vor Regen vor Sonne, unbekannt zählt nicht", () => {
  const order = [95, 66, 71, 61, 51, 45, 3, 2, 0].map(weatherSeverity);
  eq([...order].sort((a, b) => b - a), order);
  eq(weatherSeverity(null), -1);
  eq(weatherSeverity(42), -1);
});

Deno.test("Abgeschlossene Abstimmung: nichts abfragen", async () => {
  let calls = 0;
  eq(await buildPollWeather({ status: "closed" }, () => { calls++; return Promise.reject(); }), { status: "closed" });
  eq(calls, 0);
});

Deno.test("Ein Ort und Tag wird nur einmal abgefragt, Gespeichertes gar nicht", async () => {
  const asked: string[] = [];
  const result = await buildPollWeather({
    status: "open",
    options: [
      option("a"), // Bowling 20 Uhr
      option("b", { hour: 18 }), // gleicher Ort und Tag, andere Uhrzeit
      option("c", { latitude: 52.6, longitude: 13.4, status: "cached", hourly: hours(), fetched_at: "2026-10-19T04:00:00Z" }),
      option("d", { status: "too_far", latitude: undefined, longitude: undefined, day: undefined, available_from: "2026-11-01" }),
    ],
  }, (lat, lon, day) => {
    asked.push(`${lat}|${lon}|${day}`);
    return Promise.resolve({ hours: hours(), fetchedAt: "2026-10-19T05:00:00Z" });
  });
  eq(asked, ["52.52|13.5|2026-10-24"], "Abfragen");
  if (result.status !== "open") throw new Error("offen erwartet");
  eq(result.options.map((o) => o.option_id), ["a", "b", "c", "d"], "Reihenfolge wie geliefert");
  eq(result.options[0], { option_id: "a", status: "ok", mode: "hour", hour: 20, temperature: 20, precipitation_probability: 10, weather_code: 2, wind_speed: 8, setting: "indoor" });
  eq((result.options[1] as { hour: number }).hour, 18, "eigene Uhrzeit je Vorschlag");
  eq(result.options[3], { option_id: "d", status: "too_far", available_from: "2026-11-01" });
  eq(result.fetched_at, "2026-10-19T04:00:00Z", "der älteste Stand gilt");
  eq(result.source, "Open-Meteo");
});

Deno.test("Vorschlag ohne Uhrzeit: Zusammenfassung des Tages", async () => {
  const result = await buildPollWeather({ status: "open", options: [option("a", { hour: null, setting: "outdoor" })] },
    () => Promise.resolve({ hours: hours((h) => ({ weather_code: h === 14 ? 61 : 1 })), fetchedAt: "2026-10-19T05:00:00Z" }));
  if (result.status !== "open") throw new Error("offen erwartet");
  eq(result.options[0], { option_id: "a", status: "ok", mode: "day", hour: null, temperature: 21, precipitation_probability: 10, weather_code: 61, wind_speed: 8, setting: "outdoor" });
});

Deno.test("Fällt ein Ort aus, bleiben die anderen; fällt alles aus, ist es ein Fehler", async () => {
  const partial = await buildPollWeather({ status: "open", options: [option("a"), option("b", { latitude: 48.1 })] },
    (lat) => lat === 48.1 ? Promise.reject(new WeatherError("weather_unavailable")) : Promise.resolve({ hours: hours(), fetchedAt: "2026-10-19T05:00:00Z" }));
  if (partial.status !== "open") throw new Error("offen erwartet");
  eq(partial.options.map((o) => o.status), ["ok", "unavailable"]);

  let failure: unknown = null;
  await buildPollWeather({ status: "open", options: [option("a"), option("b", { latitude: 48.1 })] },
    (lat) => Promise.reject(new WeatherError(lat === 48.1 ? "weather_busy" : "weather_unavailable"))).catch((e) => (failure = e));
  eq(failure instanceof WeatherError && failure.code, "weather_busy", "ausgelastet hat Vorrang");

  failure = null;
  await buildPollWeather({ status: "open", options: [option("a")] }, () => Promise.reject(new Error("kaputt"))).catch((e) => (failure = e));
  eq(failure instanceof WeatherError && failure.code, "weather_unavailable", "unbekannter Fehler wird zu weather_unavailable");
});

Deno.test("Nur Termine zu weit voraus oder gar keine: kein Fehler, nichts abgefragt", async () => {
  let calls = 0;
  const fetchDay = () => { calls++; return Promise.reject(new WeatherError("weather_unavailable")); };
  const far = await buildPollWeather({ status: "open", options: [option("d", { status: "too_far", available_from: "2026-11-01" })] }, fetchDay);
  eq(far, { status: "open", options: [{ option_id: "d", status: "too_far", available_from: "2026-11-01" }], fetched_at: null, source: "Open-Meteo" });
  eq(await buildPollWeather({ status: "open", options: [] }, fetchDay), { status: "open", options: [], fetched_at: null, source: "Open-Meteo" });
  eq(calls, 0);
});

Deno.test("Höchstens 10 Abfragen je Anfrage", async () => {
  let calls = 0;
  const options = Array.from({ length: 12 }, (_, i) => option(`o${i}`, { latitude: 50 + i / 10 }));
  const result = await buildPollWeather({ status: "open", options }, () => {
    calls++;
    return Promise.resolve({ hours: hours(), fetchedAt: "2026-10-19T05:00:00Z" });
  });
  eq(calls, 10);
  if (result.status !== "open") throw new Error("offen erwartet");
  eq(result.options.filter((o) => o.status === "unavailable").length, 2);
});
