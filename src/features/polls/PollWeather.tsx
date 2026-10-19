import { IconWarning, IconWeatherUnknown } from "@/components/icons";
import { WEATHER_ICONS } from "@/features/plans/weatherIcons";
import { t } from "@/i18n";
import { errorMessage } from "@/lib/errors";
import { formatPlainDate, formatTime } from "@/lib/time";
import { formatTemperature, outdoorHint, weatherKind, type PollOptionWeather } from "@/lib/weather";

/**
 * P5 Etappe 2: Wetter unter einem Vorschlag einer laufenden Abstimmung – eine Zeile, damit die Karte
 * ruhig bleibt. Mit Uhrzeit die Stunde des Termins, ohne Uhrzeit „Tagsüber bis 18 °C“. Fehlende Werte
 * fehlen auch hier; bei Orten draußen ein kurzer Hinweis in Gelb.
 */
export function OptionWeather({ title, weather, loading }: { title: string; weather: PollOptionWeather | undefined; loading: boolean }) {
  const w = t.polls.detail.weather;
  if (loading) {
    return (
      <p className="mt-1 flex items-center gap-1.5 text-sm text-faint" aria-busy="true">
        <IconWeatherUnknown className="size-4 shrink-0" aria-hidden />
        {w.loading}
      </p>
    );
  }
  if (!weather) return null;

  if (weather.status !== "ok") {
    return (
      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted" data-testid="poll-option-weather">
        <IconWeatherUnknown className="size-4 shrink-0" aria-hidden />
        {weather.status === "too_far" ? w.tooFar(formatPlainDate(weather.available_from, "long")) : w.unavailable}
      </p>
    );
  }

  const kind = weatherKind(weather.weather_code);
  const Icon = WEATHER_ICONS[kind];
  const hint = outdoorHint(weather);
  const day = weather.mode === "day";
  const temperature = weather.temperature != null ? formatTemperature(weather.temperature) : null;
  const rain = weather.precipitation_probability != null ? Math.round(weather.precipitation_probability) : null;
  const parts = [
    day ? w.dayLead : null,
    temperature ? (day ? w.dayTemperature(temperature) : temperature) : null,
    t.plans.weather.kinds[kind],
    rain != null ? (day ? w.dayRain(rain) : w.rain(rain)) : t.plans.weather.rainUnknown,
  ].filter(Boolean);

  return (
    <div className="mt-1 text-sm" role="group" aria-label={w.label(title)}>
      <p className="flex items-start gap-1.5 text-muted">
        <Icon className="mt-0.5 size-4 shrink-0 text-fg/80" aria-hidden />
        <span data-testid="poll-option-weather" className="tabular-nums">
          {parts.join(" · ")}
        </span>
      </p>
      {hint && (
        <p className="mt-0.5 flex items-start gap-1.5 font-semibold text-amber">
          <IconWarning className="mt-0.5 size-4 shrink-0" aria-hidden />
          {w.hints[hint]}
        </p>
      )}
    </div>
  );
}

/** Quelle und Stand einmal unter allen Vorschlägen – oder der Fehler mit „Erneut versuchen“. */
export function PollWeatherFooter({ fetchedAt, error, onRetry }: { fetchedAt: string | null | undefined; error: unknown; onRetry: () => void }) {
  const w = t.polls.detail.weather;
  if (error) {
    const message = errorMessage(error);
    return (
      <p className="mt-3 text-sm text-muted" role="status">
        {message === t.errors.generic ? w.error : message}{" "}
        <button type="button" onClick={onRetry} className="font-semibold text-fg underline decoration-line-strong underline-offset-4 hover:decoration-lime">
          {w.retry}
        </button>
      </p>
    );
  }
  if (fetchedAt === undefined) return null;
  return (
    <p className="mt-3 text-[13px] leading-snug text-faint">
      {w.sourceLead}{" "}
      <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer" className="underline decoration-line underline-offset-4 hover:text-fg hover:decoration-lime">
        {w.sourceLink}
      </a>
      {w.sourceTail(fetchedAt ? formatTime(fetchedAt) : "–")}
    </p>
  );
}
