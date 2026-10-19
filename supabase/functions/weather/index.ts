/**
 * AFTERHOURS – Edge Function "weather": Wettervorhersage für Beginn und Ort eines Plans (Roadmap P5)
 * und für die Vorschläge einer laufenden Abstimmung (P5 Etappe 2, POST {"poll_id": "<uuid>"}: je
 * Vorschlag mit Ort und Termin, siehe poll.ts – Mitgliedschaft und Rate Limit prüft poll_weather).
 *
 * Ablauf (POST {"plan_id": "<uuid>"}):
 *   1. plan_weather (mit dem Token der anfragenden Person): Mitgliedschaft, Rate Limit, gerundeter Ort,
 *      Tag und Stunde in Berliner Zeit – oder warum es keine Vorhersage gibt (past, no_location, too_far).
 *      Liegt eine frische Vorhersage (< 3 Stunden) im Speicher, kommt sie gleich mit.
 *   2. Sonst Open-Meteo fragen (forecast.ts) und die Stundenwerte mit store_weather_forecast
 *      (service_role) für die ganze Crew ablegen.
 *   3. Antwort: die Stunde des Planbeginns – Temperatur, Regenrisiko, Wettercode (WMO), Wind.
 *
 * Open-Meteo erfährt weder IP-Adressen der Nutzer noch Pläne oder Namen, nur Ort (2 Nachkommastellen)
 * und Tag. Frei ohne Schlüssel für nicht-kommerzielle Nutzung; für einen kommerziellen Betrieb
 * braucht es einen Tarif bei Open-Meteo (OPEN_METEO_URL, ggf. mit Schlüssel – siehe README).
 *
 * Umgebung (optional):
 *   OPEN_METEO_URL  Standard: https://api.open-meteo.com
 *   ALLOWED_ORIGIN  Standard: *
 * Deploy: supabase functions deploy weather
 */
import { DEFAULT_OPEN_METEO_URL, fetchForecast, type HourForecast, pickHour, WeatherError } from "./forecast.ts";
import { buildPollWeather, type PollWeatherInfo } from "./poll.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (body: unknown, status: number, origin: string) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });

class Failure extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

async function rpc(baseUrl: string, headers: Record<string, string>, name: string, args: unknown): Promise<unknown> {
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${name}`, { method: "POST", headers, body: JSON.stringify(args) });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (body as { message?: string } | null)?.message ?? "";
    if (message === "rate_limited") throw new Failure("rate_limited", 429);
    if (response.status === 401 || response.status === 403) throw new Failure("forbidden", 403);
    console.error(`weather: rpc ${name} failed`, response.status, message);
    throw new Failure("database_error", 502);
  }
  return body;
}

interface PlanWeather {
  status: "past" | "no_location" | "too_far" | "fetch" | "cached";
  latitude?: number;
  longitude?: number;
  day?: string;
  hour?: number;
  setting?: string | null;
  available_from?: string;
  hourly?: HourForecast[] | null;
  fetched_at?: string | null;
}

Deno.serve(async (req) => {
  const origin = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
  if (req.method === "OPTIONS") return json({}, 200, origin);
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "weather_not_configured" }, 503, origin);

  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "not_authenticated" }, 401, origin);
  const userHeaders = { apikey: anonKey, Authorization: authorization, "Content-Type": "application/json" };
  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  let planId = "";
  let pollId = "";
  try {
    const body = await req.json();
    planId = typeof body?.plan_id === "string" ? body.plan_id.trim() : "";
    pollId = typeof body?.poll_id === "string" ? body.poll_id.trim() : "";
  } catch {
    return json({ error: "invalid_request" }, 400, origin);
  }
  // Genau eins von beiden: ein Plan oder eine Abstimmung.
  if (planId && pollId) return json({ error: "invalid_request" }, 400, origin);
  if (!UUID.test(planId) && !UUID.test(pollId)) return json({ error: "invalid_request" }, 400, origin);

  const openMeteo = Deno.env.get("OPEN_METEO_URL") || DEFAULT_OPEN_METEO_URL;
  // Speichern ist Komfort: Scheitert es, bekommt die Person die Vorhersage trotzdem.
  const store = async (latitude: number, longitude: number, day: string, hours: HourForecast[]) => {
    const stored = await rpc(supabaseUrl, serviceHeaders, "store_weather_forecast", {
      p_latitude: latitude, p_longitude: longitude, p_day: day, p_hourly: hours,
    }).catch(() => null);
    return typeof stored === "string" ? stored : new Date().toISOString();
  };

  try {
    if (pollId) {
      const info = (await rpc(supabaseUrl, userHeaders, "poll_weather", { p_poll: pollId })) as PollWeatherInfo;
      const result = await buildPollWeather(info, async (latitude, longitude, day) => {
        const hours = await fetchForecast(openMeteo, latitude, longitude, day);
        return { hours, fetchedAt: await store(latitude, longitude, day, hours) };
      });
      return json(result, 200, origin);
    }

    const info = (await rpc(supabaseUrl, userHeaders, "plan_weather", { p_plan: planId })) as PlanWeather;
    if (info.status === "past" || info.status === "no_location") return json({ status: info.status }, 200, origin);
    if (info.status === "too_far") return json({ status: "too_far", available_from: info.available_from, setting: info.setting ?? null }, 200, origin);
    if (info.latitude == null || info.longitude == null || !info.day || info.hour == null) throw new Failure("database_error", 502);

    let hours = info.status === "cached" && Array.isArray(info.hourly) ? info.hourly : null;
    let fetchedAt = info.fetched_at ?? null;
    if (!hours) {
      hours = await fetchForecast(openMeteo, Number(info.latitude), Number(info.longitude), info.day);
      fetchedAt = await store(Number(info.latitude), Number(info.longitude), info.day, hours);
    }

    const at = pickHour(hours, info.hour);
    if (!at) throw new WeatherError("weather_unavailable");
    return json({
      status: "ok",
      day: info.day,
      hour: at.hour,
      temperature: at.temperature,
      precipitation_probability: at.precipitation_probability,
      weather_code: at.weather_code,
      wind_speed: at.wind_speed,
      setting: info.setting ?? null,
      fetched_at: fetchedAt,
      source: "Open-Meteo",
    }, 200, origin);
  } catch (error) {
    if (error instanceof WeatherError) return json({ error: error.code }, error.code === "weather_busy" ? 503 : 502, origin);
    const failure = error instanceof Failure ? error : new Failure("internal_error", 500);
    if (!(error instanceof Failure)) console.error("weather: unexpected error", error instanceof Error ? error.message : error);
    return json({ error: failure.code }, failure.status, origin);
  }
});
