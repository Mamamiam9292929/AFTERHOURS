import { useState } from "react";
import { Link } from "react-router-dom";
import { IconCheck, IconClock, IconPin, IconPlus } from "@/components/icons";
import { DemoBadge } from "@/components/ui/Feedback";
import { useToast } from "@/components/ui/Toast";
import { usePollDraft } from "@/features/polls/draft";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { formatDistance } from "@/lib/format";
import type { Activity } from "@/lib/types";
import { typicalPriceCents } from "./api";
import { CategoryArt } from "./CategoryArt";
import { openLabel, priceLabel } from "./display";

/** Titelbild eines Ortes: echtes Foto, wenn vorhanden und ladbar – sonst die Kategorie-Grafik. */
export function ActivityCover({ activity, className }: { activity: Pick<Activity, "image_url" | "category" | "name">; className?: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className={cn("overflow-hidden bg-raised", className)}>
      {activity.image_url && !broken ? (
        <img src={activity.image_url} alt="" loading="lazy" decoding="async" className="size-full object-cover" onError={() => setBroken(true)} />
      ) : (
        <CategoryArt category={activity.category} />
      )}
    </div>
  );
}

/** Ort in den Sammelkorb für die nächste Abstimmung legen oder wieder herausnehmen. */
export function usePollToggle(activity: Activity): { selected: boolean; toggle: () => void } {
  const draft = usePollDraft();
  const toast = useToast();
  const selected = draft.has(activity.id);
  return {
    selected,
    toggle() {
      if (selected) draft.remove(activity.id);
      else if (!draft.add({ activityId: activity.id, title: activity.name, priceCents: typicalPriceCents(activity) })) toast.error(t.discover.draft.full);
    },
  };
}

export function ActivityCard({ activity, distanceKm, compact = false }: { activity: Activity; distanceKm?: number | null; compact?: boolean }) {
  const { selected, toggle } = usePollToggle(activity);
  const open = openLabel(activity);

  return (
    <article className={cn("group relative flex flex-col rounded-card border bg-surface transition-colors", selected ? "border-lime" : "border-line hover:border-line-strong")}>
      <div className="relative">
        <ActivityCover activity={activity} className={cn("rounded-t-[15px]", compact ? "aspect-[16/9]" : "aspect-[16/10]")} />
        <span className="absolute bottom-2.5 left-2.5 rounded-full bg-nav/85 px-2.5 py-1 text-xs font-semibold text-fg">{t.enums.category[activity.category]}</span>
        {activity.is_demo && <DemoBadge className="absolute right-2.5 top-2.5 bg-nav/85" />}
        {/* Sitzt auf der Kante zwischen Bild und Text – so bleibt die Preiszeile frei. */}
        <button
          type="button"
          onClick={toggle}
          aria-pressed={selected}
          aria-label={selected ? t.discover.card.removeFromPoll(activity.name) : `${activity.name}: ${t.discover.card.addToPoll}`}
          title={selected ? t.discover.card.addedToPoll : t.discover.card.addToPoll}
          className={cn(
            "absolute -bottom-[22px] right-3 z-10 inline-flex size-11 items-center justify-center rounded-full border-2 transition-colors",
            selected ? "border-lime bg-lime text-lime-ink" : "border-surface bg-raised text-fg ring-1 ring-line-strong hover:bg-lime hover:text-lime-ink hover:ring-lime",
          )}
        >
          {selected ? <IconCheck className="size-5" strokeWidth={3} aria-hidden /> : <IconPlus className="size-5" aria-hidden />}
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <div className="min-w-0">
          <h3 className="pr-12 text-[17px] font-bold leading-tight text-fg">
            <Link to={`/activities/${activity.id}`} className="after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-lime">
              {activity.name}
            </Link>
          </h3>
          <p className="mt-1 flex items-center gap-1.5 text-[13px] text-muted">
            <IconPin className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              {activity.city ?? t.states.notSpecified}
              {distanceKm != null && `, ${compact ? formatDistance(distanceKm) : t.discover.distanceFromCenter(formatDistance(distanceKm))}`}
            </span>
          </p>
        </div>
        <div className="mt-auto space-y-1">
          <p className="text-[15px] font-bold text-fg">
            {priceLabel(activity)}
            {(activity.price_min_cents != null || activity.price_max_cents != null) && <span className="ml-1 whitespace-nowrap text-[13px] font-normal text-muted">{t.perPerson}</span>}
          </p>
          {!compact && (
            <p className={cn("flex items-center gap-1.5 text-[13px]", open.tone === "open" ? "text-lime" : "text-muted")}>
              <IconClock className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{open.text}</span>
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
