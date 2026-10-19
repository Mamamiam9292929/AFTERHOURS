import { IconWarning, IconWeatherUnknown } from "@/components/icons";
import { Fact } from "@/components/layout/Page";
import { t } from "@/i18n";
import { errorMessage } from "@/lib/errors";
import { formatDateLong, formatTime } from "@/lib/time";
import { formatTemperature, outdoorHint, weatherKind } from "@/lib/weather";
import type { PlanWithParticipants } from "./api";
import { usePlanWeather } from "./api";
import { WEATHER_ICONS } from "./weatherIcons";

/**
 * P5: Wetter für Beginn und Ort des Plans – nur bei anstehenden Plänen mit Ort aus Discover.
 * Ohne Koordinaten, nach dem Plan oder bei Absage erscheint nichts; zu weit voraus steht, ab wann es
 * eine Vorhersage gibt. Nichts wird geschätzt: fehlende Werte fehlen auch in der Anzeige.
 */
export function PlanWeather({ plan }: { plan: PlanWithParticipants }) {
  const weather = usePlanWeather(plan, Boolean(plan.activity_id));
  if (!plan.activity_id) return null;

  if (weather.isPending) {
    return (
      <Fact icon={<IconWeatherUnknown aria-hidden />} label={t.plans.weather.label}>
        <span className="text-sm text-muted" aria-busy="true">
          {t.plans.weather.loading}
        </span>
      </Fact>
    );
  }

  if (weather.isError) {
    return (
      <Fact icon={<IconWeatherUnknown aria-hidden />} label={t.plans.weather.label}>
        <span className="text-sm text-muted" role="status">
          {errorMessage(weather.error) === t.errors.generic ? t.plans.weather.error : errorMessage(weather.error)}
        </span>
        <button
          type="button"
          onClick={() => void weather.refetch()}
          className="mt-1 block w-fit text-sm font-semibold text-fg underline decoration-line-strong underline-offset-4 hover:decoration-lime"
        >
          {t.plans.weather.retry}
        </button>
      </Fact>
    );
  }

  const data = weather.data;

  if (data.status === "too_far") {
    return (
      <Fact icon={<IconWeatherUnknown aria-hidden />} label={t.plans.weather.label}>
        <span className="text-sm text-muted">{t.plans.weather.tooFar(formatDateLong(data.available_from))}</span>
      </Fact>
    );
  }

  // Ohne Ort mit Koordinaten oder nach dem Plan: nichts anzeigen.
  if (data.status !== "ok") return null;

  const kind = weatherKind(data.weather_code);
  const Icon = WEATHER_ICONS[kind];
  const hint = outdoorHint(data);
  const details = [
    t.plans.weather.at(data.hour),
    data.precipitation_probability != null ? t.plans.weather.rain(Math.round(data.precipitation_probability)) : t.plans.weather.rainUnknown,
    data.wind_speed != null ? t.plans.weather.wind(Math.round(data.wind_speed)) : null,
  ].filter(Boolean);

  return (
    <Fact icon={<Icon aria-hidden />} label={t.plans.weather.label}>
      <span data-testid="plan-weather" className="font-semibold">
        {data.temperature != null && <span className="tabular-nums">{formatTemperature(data.temperature)} · </span>}
        {t.plans.weather.kinds[kind]}
      </span>
      <span className="mt-0.5 block text-sm text-muted">{details.join(" · ")}</span>
      {hint && (
        <span className="mt-1.5 flex items-start gap-1.5 text-sm font-semibold text-amber">
          <IconWarning className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t.plans.weather.hints[hint]}
        </span>
      )}
      <span className="mt-1 block text-[13px] text-faint">
        {t.plans.weather.sourceLead}{" "}
        <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer" className="underline decoration-line underline-offset-4 hover:text-fg hover:decoration-lime">
          {t.plans.weather.sourceLink}
        </a>
        {t.plans.weather.sourceTail(data.fetched_at ? formatTime(data.fetched_at) : "–")}
      </span>
    </Fact>
  );
}
