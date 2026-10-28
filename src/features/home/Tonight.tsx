import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { IconPin, IconWarning, IconWeatherUnknown } from "@/components/icons";
import { usePlanWeather, type PlanWithParticipants } from "@/features/plans/api";
import { WEATHER_ICONS } from "@/features/plans/weatherIcons";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { tonightStrip } from "@/lib/quickvote";
import { calendarDaysBetween, formatTime, zonedParts } from "@/lib/time";
import { formatTemperature, outdoorHint, weatherKind } from "@/lib/weather";

/**
 * D3 Etappe 2a · „Heute Abend“-Leiste direkt unter dem großen Ticket auf Home: in den letzten
 * 12 Stunden vor dem Plan (und solange er läuft) das Wetter zur Planzeit am Ort und der Treffpunkt –
 * ein Blick, und man weiß, was heute läuft. Gleiche Wetterabfrage wie auf der Planseite (geteilter
 * Speicher), nichts wird geschätzt: ohne Ort aus Discover kein Wetter, ohne Treffpunkt „noch offen“.
 */
export function TonightStrip({ plan, now }: { plan: PlanWithParticipants; now: Date }) {
  const strip = tonightStrip(plan, now, calendarDaysBetween(now, plan.starts_at), zonedParts(plan.starts_at).hour);
  const weather = usePlanWeather(plan, Boolean(strip?.weather));
  if (!strip) return null;

  const meetingMain = strip.meetingPoint ?? strip.address;
  const meetingSub = strip.meetingPoint ? strip.address : null;

  let weatherTile: ReactNode = null;
  if (strip.weather) {
    if (weather.isPending) {
      weatherTile = (
        <Tile icon={<IconWeatherUnknown aria-hidden />} label={t.home.tonight.weatherLabel}>
          <span className="block text-sm text-muted" aria-busy="true">
            {t.home.tonight.weatherLoading}
          </span>
        </Tile>
      );
    } else if (weather.isError) {
      weatherTile = (
        <Tile icon={<IconWeatherUnknown aria-hidden />} label={t.home.tonight.weatherLabel}>
          <span className="block text-sm text-muted" role="status" data-testid="tonight-weather-error">
            {t.home.tonight.weatherError}
          </span>
          <button
            type="button"
            onClick={() => void weather.refetch()}
            className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-fg underline decoration-line-strong underline-offset-4 hover:decoration-lime"
          >
            {t.home.tonight.retry}
          </button>
        </Tile>
      );
    } else if (weather.data.status === "ok") {
      const data = weather.data;
      const kind = weatherKind(data.weather_code);
      const Icon = WEATHER_ICONS[kind];
      const hint = outdoorHint(data);
      const details = [
        data.precipitation_probability != null ? t.home.tonight.rain(Math.round(data.precipitation_probability)) : t.plans.weather.rainUnknown,
        data.wind_speed != null ? t.plans.weather.wind(Math.round(data.wind_speed)) : null,
      ].filter(Boolean);
      weatherTile = (
        <Tile icon={<Icon aria-hidden />} label={t.home.tonight.weatherAt(data.hour)}>
          <span data-testid="tonight-weather" className="flex flex-wrap items-baseline gap-x-2">
            {data.temperature != null && <span className="font-display text-[22px] font-extrabold leading-tight tabular-nums text-fg">{formatTemperature(data.temperature)}</span>}{" "}
            <span className="font-semibold text-fg">{t.plans.weather.kinds[kind]}</span>
          </span>
          <span className="mt-0.5 block text-sm text-muted">{details.join(" · ")}</span>
          {hint && (
            <span className="mt-1.5 flex items-start gap-1.5 text-sm font-semibold text-amber" data-testid="tonight-weather-hint">
              <IconWarning className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t.plans.weather.hints[hint]}
            </span>
          )}
          <a
            href="https://open-meteo.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 block text-[13px] text-faint underline decoration-line underline-offset-4 hover:text-fg hover:decoration-lime"
          >
            {t.home.tonight.source(data.fetched_at ? formatTime(data.fetched_at) : "–")}
          </a>
        </Tile>
      );
    }
  }

  return (
    <section aria-labelledby="tonight-title" data-testid="tonight-strip" data-tone="lime" className="plan-panel mt-3 rounded-[24px] border border-white/[0.08] p-3.5 sm:p-4">
      <div className="flex items-center justify-between gap-3 px-1">
        <h2 id="tonight-title" className="display flex items-center gap-2 text-[15px] uppercase text-fg">
          <span aria-hidden className="size-2 rounded-full bg-lime" />
          {t.home.tonight.title[strip.when]}
        </h2>
        <Link
          to={`/plans/${plan.id}`}
          className="inline-flex min-h-11 items-center text-sm font-semibold text-muted underline decoration-line-strong underline-offset-4 hover:text-fg hover:decoration-lime"
        >
          {t.home.tonight.toPlan}
        </Link>
      </div>
      <div className={cn("mt-2 grid gap-2.5", weatherTile && "sm:grid-cols-2")}>
        {weatherTile}
        <Tile icon={<IconPin aria-hidden />} label={t.home.tonight.meeting}>
          {meetingMain ? (
            <>
              <span data-testid="tonight-meeting" className="block break-words text-[17px] font-semibold leading-snug text-fg">
                {meetingMain}
              </span>
              {meetingSub && <span className="mt-0.5 block break-words text-sm text-muted">{meetingSub}</span>}
            </>
          ) : (
            <span data-testid="tonight-meeting" className="block text-sm text-muted">
              {t.home.tonight.meetingOpen}
            </span>
          )}
        </Tile>
      </div>
    </section>
  );
}

function Tile({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
      <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full border border-white/15 bg-white/[0.06] text-fg [&>svg]:size-5">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-bold uppercase tracking-wide text-muted">{label}</p>
        <div className="mt-0.5">{children}</div>
      </div>
    </div>
  );
}
