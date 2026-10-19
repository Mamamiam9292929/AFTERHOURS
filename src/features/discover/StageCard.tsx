import { Link } from "react-router-dom";
import { IconCheck, IconPlus } from "@/components/icons";
import { Button, ButtonLink } from "@/components/ui/Button";
import { DemoBadge } from "@/components/ui/Feedback";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { formatDistance } from "@/lib/format";
import { openStateAt } from "@/lib/hours";
import type { Activity } from "@/lib/types";
import { ActivityCover, usePollToggle } from "./ActivityCard";
import { openLabel, priceLabel } from "./display";

interface Ranked {
  activity: Activity;
  distanceKm: number | null;
}

/**
 * Welcher Ort steht auf der Bühne? Bevorzugt einer, der laut bekannten Öffnungszeiten jetzt offen hat,
 * dann der nächstgelegene. Ohne beides bleibt es der erste Treffer – nichts wird geraten.
 */
export function pickStage<T extends Ranked>(results: T[], now: Date = new Date()): T | null {
  if (results.length === 0) return null;
  let best: T | null = null;
  let bestScore = -Infinity;
  for (const result of results) {
    const open = openStateAt(result.activity.opening_hours, now).state === "open";
    const score = (open ? 1000 : 0) - (result.distanceKm ?? 500);
    if (score > bestScore) {
      best = result;
      bestScore = score;
    }
  }
  return best;
}

/** D0 Discover: eine große Hauptkarte – Kategorie-Grafik auf Lime-Schein, Name als Plakat, zwei klare Aktionen. */
export function StageCard({ activity, distanceKm, now = new Date() }: Ranked & { now?: Date }) {
  const { selected, toggle } = usePollToggle(activity);
  const state = openStateAt(activity.opening_hours, now);
  const isOpen = state.state === "open";
  const meta = [t.enums.category[activity.category], isOpen ? t.discover.stage.openUntil(state.closesAt) : openLabel(activity, now).text, priceLabel(activity)];
  // Entfernung nur mit Koordinaten – und ehrlich als Luftlinie ab Stadtmitte, nicht ab deinem Standort.
  if (distanceKm != null) meta.push(t.discover.distanceFromCenter(formatDistance(distanceKm)));

  return (
    <article className={cn("stage-card overflow-hidden rounded-[20px] border bg-surface lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]", selected ? "border-lime" : "border-line")}>
      <div className="stage-art relative">
        <ActivityCover activity={activity} className="aspect-[16/9] bg-transparent lg:aspect-auto lg:h-full lg:min-h-[260px] [&_svg]:bg-transparent" />
        {isOpen && (
          <span className="absolute left-3 top-3 inline-flex items-center gap-2 rounded-full bg-nav/80 px-3 py-1.5 text-[13px] font-semibold text-lime">
            <span className="size-2 rounded-full bg-lime" aria-hidden />
            {t.discover.stage.openNow}
          </span>
        )}
        {activity.is_demo && <DemoBadge className="absolute right-3 top-3 bg-nav/85" />}
      </div>
      <div className="flex flex-col p-4 sm:p-5 lg:justify-end lg:p-7">
        <h2 className="display break-words text-[22px] uppercase text-fg sm:text-[27px]">
          <Link to={`/activities/${activity.id}`} className="rounded-sm hover:text-lime focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime">
            {activity.name}
          </Link>
        </h2>
        <p className="mt-1.5 text-[15px] text-muted">{meta.join(" · ")}</p>
        <div className="mt-4 grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-2.5">
          <Button
            size="lg"
            variant={selected ? "secondary" : "primary"}
            onClick={toggle}
            aria-pressed={selected}
            aria-label={selected ? t.discover.card.removeFromPoll(activity.name) : `${activity.name}: ${t.discover.card.addToPoll}`}
            icon={selected ? <IconCheck className="size-4" strokeWidth={3} aria-hidden /> : <IconPlus className="size-4" aria-hidden />}
          >
            {selected ? t.discover.stage.addedToPoll : t.discover.stage.addToPoll}
          </Button>
          <ButtonLink to={`/activities/${activity.id}`} size="lg" variant="secondary">
            {t.discover.card.details}
          </ButtonLink>
        </div>
      </div>
    </article>
  );
}
