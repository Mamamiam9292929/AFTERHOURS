// deno test supabase/functions/weather/forecast_test.ts
// P5: Open-Meteo-Abfrage und -Antwort – ohne Netz, mit nachgebautem fetch.
import { DEFAULT_OPEN_METEO_URL, fetchForecast, forecastUrl, parseForecast, pickHour, WeatherError } from "./forecast.ts";

function eq(actual: unknown, expected: unknown, message = ""): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message} erwartet ${JSON.stringify(expected)}, erhalten ${JSON.stringify(actual)}`);
}

const DAY = "2026-10-24";
const sample = (day = DAY) => ({
  latitude: 51.34,
  longitude: 12.38,
  hourly: {
    time: Array.from({ length: 24 }, (_, h) => `${day}T${String(h).padStart(2, "0")}:00`),
    temperature_2m: Array.from({ length: 24 }, (_, h) => 8 + h / 2),
    precipitation_probability: Array.from({ length: 24 }, (_, h) => (h >= 18 ? 70 : 10)),
    weather_code: Array.from({ length: 24 }, (_, h) => (h >= 18 ? 61 : 2)),
    wind_speed_10m: Array.from({ length: 24 }, () => 12.5),
  },
});

function fakeFetch(reply: Response | "network", calls: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    calls.push(String(input));
    if (reply === "network") throw new TypeError("connection refused");
    return new Response(await reply.clone().text(), { status: reply.status });
  }) as typeof fetch;
}

Deno.test("Adresse: gerundeter Ort, ein Tag, Berliner Zeit, nur nötige Werte", () => {
  const url = new URL(forecastUrl(DEFAULT_OPEN_METEO_URL, 51.340632, 12.374733, DAY));
  eq(url.origin + url.pathname, "https://api.open-meteo.com/v1/forecast");
  eq(url.searchParams.get("latitude"), "51.34");
  eq(url.searchParams.get("longitude"), "12.37");
  eq(url.searchParams.get("start_date"), DAY);
  eq(url.searchParams.get("end_date"), DAY);
  eq(url.searchParams.get("timezone"), "Europe/Berlin");
  eq(url.searchParams.get("hourly"), "temperature_2m,precipitation_probability,weather_code,wind_speed_10m");
});

Deno.test("Adresse: eigener Server mit Schrägstrich am Ende", () => {
  eq(new URL(forecastUrl("http://127.0.0.1:8089/", 1, 2, DAY)).pathname, "/v1/forecast");
});

Deno.test("Antwort: 24 Stunden mit allen Werten", () => {
  const hours = parseForecast(sample(), DAY)!;
  eq(hours.length, 24);
  eq(hours[20], { hour: 20, temperature: 18, precipitation_probability: 70, weather_code: 61, wind_speed: 12.5 });
});

Deno.test("Antwort: fehlende Werte bleiben null statt erfunden", () => {
  const data = sample();
  data.hourly.precipitation_probability[20] = null as unknown as number;
  const hours = parseForecast(data, DAY)!;
  eq(hours[20].precipitation_probability, null);
  eq(hours[20].temperature, 18);
});

Deno.test("Antwort: anderer Tag, kaputte Form oder ganz leer → null", () => {
  eq(parseForecast(sample("2026-10-25"), DAY), null);
  eq(parseForecast({ error: true, reason: "bad" }, DAY), null);
  eq(parseForecast(null, DAY), null);
  eq(parseForecast({ hourly: { time: [`${DAY}T20:00`], temperature_2m: [null], weather_code: [null] } }, DAY), null);
});

Deno.test("Zeitumstellung: doppelte Stunde nur einmal", () => {
  const data = { hourly: { time: [`${DAY}T02:00`, `${DAY}T02:00`, `${DAY}T03:00`], temperature_2m: [5, 4, 3], weather_code: [0, 0, 0] } };
  eq(parseForecast(data, DAY)!.map((h) => [h.hour, h.temperature]), [[2, 5], [3, 3]]);
});

Deno.test("Stunde wählen: genau, sonst die nächstgelegene, bei Gleichstand die frühere", () => {
  const hours = parseForecast(sample(), DAY)!;
  eq(pickHour(hours, 20)?.hour, 20);
  const gaps = hours.filter((h) => h.hour !== 20 && h.hour !== 21 && h.hour !== 19);
  eq(pickHour(gaps, 20)?.hour, 18);
  eq(pickHour([], 20), null);
});

Deno.test("Abruf: Erfolg liefert die Stunden", async () => {
  const calls: string[] = [];
  const hours = await fetchForecast("https://meteo.example", 51.34, 12.37, DAY, fakeFetch(new Response(JSON.stringify(sample())), calls));
  eq(hours.length, 24);
  eq(calls.length, 1);
  eq(new URL(calls[0]).origin, "https://meteo.example");
});

async function failsWith(code: string, reply: Response | "network") {
  try {
    await fetchForecast("https://meteo.example", 51.34, 12.37, DAY, fakeFetch(reply));
  } catch (error) {
    if (error instanceof WeatherError && error.code === code) return;
    throw new Error(`erwartet ${code}, erhalten ${error}`);
  }
  throw new Error(`erwartet ${code}, aber kein Fehler`);
}

Deno.test("Abruf: Netzfehler, Serverfehler, Unbrauchbares → weather_unavailable", async () => {
  await failsWith("weather_unavailable", "network");
  await failsWith("weather_unavailable", new Response("oops", { status: 500 }));
  await failsWith("weather_unavailable", new Response("kein json"));
  await failsWith("weather_unavailable", new Response(JSON.stringify({ error: true, reason: "Parameter" }), { status: 400 }));
});

Deno.test("Abruf: Kontingent erschöpft → weather_busy", async () => {
  await failsWith("weather_busy", new Response("{}", { status: 429 }));
});
