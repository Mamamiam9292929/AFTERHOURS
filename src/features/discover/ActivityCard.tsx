import { useState } from "react";
import { Link } from "react-router-dom";
import { IconCheck, IconClock, IconPin, IconPlus } from "@/components/icons";
import { DemoBadge } from "@/components/ui/Feedback";
import { useToast } from "@/components/ui/Toast";
import { usePollDraft } from "@/features/polls/draft";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { formatDistance } from "@/lib/format";
import { categoryWorld } from "@/lib/stage";
import type { PlacePhoto } from "@/lib/commons";
import type { Activity } from "@/lib/types";
import { typicalPriceCents } from "./api";
import { CategoryArt } from "./CategoryArt";
import { openLabel, priceLabel } from "./display";

/**
 * Titelbild eines Ortes: Foto von Wikimedia Commons (P7, nur mit Einwilligung geladen), sonst ein eigenes Bild,
 * sonst die Kategorie-Grafik auf der Farbwelt ihrer Kategorie. Ein Commons-Foto trägt immer Urheber:in und Lizenz.
 */
export function ActivityCover({
  activity,
  className,
  photo,
  creditAt = "bottom",
}: {
  activity: Pick<Activity, "image_url" | "category" | "name">;
  className?: string;
  photo?: PlacePhoto | null;
  creditAt?: "top" | "bottom";
}) {
  const [broken, setBroken] = useState<string | null>(null);
  const commons = photo && broken !== photo.src ? photo : null;
  const src = commons?.src ?? (activity.image_url && broken !== activity.image_url ? activity.image_url : null);
  return (
    <div className={cn("cat-world relative overflow-hidden", className)} data-world={categoryWorld(activity.category)}>
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          referrerPolicy={commons ? "no-referrer" : undefined}
          data-commons={commons ? "" : undefined}
          className="size-full object-cover"
          onError={() => setBroken(src)}
        />
      ) : (
        <CategoryArt category={activity.category} onLight />
      )}
      {commons && <PhotoCredit photo={commons} className={creditAt === "top" ? "left-2.5 top-2.5" : "bottom-2.5 right-2.5"} />}
    </div>
  );
}

/** Kurze Bildangabe auf einem Foto: „Foto: Lea · CC BY-SA 4.0“, verlinkt auf die Seite der Datei bei Commons. */
function PhotoCredit({ photo, className }: { photo: PlacePhoto; className?: string }) {
  const author = photo.author ?? t.discover.photo.unknownAuthor;
  return (
    <a
      href={photo.pageUrl}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="card-photo-credit"
      aria-label={t.discover.photo.creditLabel(author, photo.license)}
      title={t.discover.photo.creditLabel(author, photo.license)}
      // Über dem Link der ganzen Karte und ohne Wischgeste des Stapels auszulösen.
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        "absolute z-10 max-w-[calc(100%-1.25rem)] truncate rounded-full border border-white/10 bg-nav/85 px-2 py-0.5 text-[11px] font-medium text-fg backdrop-blur hover:border-lime focus-visible:outline-2 focus-visible:outline-lime",
        className,
      )}
    >
      {t.discover.photo.cardCredit(author, photo.license)}
    </a>
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

export function ActivityCard({ activity, distanceKm, compact = false, photo }: { activity: Activity; distanceKm?: number | null; compact?: boolean; photo?: PlacePhoto | null }) {
  const { selected, toggle } = usePollToggle(activity);
  const open = openLabel(activity);

  return (
    <article className={cn("deck-card group relative flex flex-col rounded-card border transition-[border-color,transform] duration-300", selected ? "border-lime" : "border-white/[0.08] hover:-translate-y-0.5 hover:border-white/20")}>
      <div className="relative p-1.5 pb-0">
        <ActivityCover activity={activity} photo={photo} creditAt="top" className={cn("rounded-[19px]", compact ? "aspect-[16/9]" : "aspect-[16/10]")} />
        <span className="glass absolute bottom-2.5 left-4 rounded-full border border-white/10 px-2.5 py-1 text-xs font-semibold text-fg">{t.enums.category[activity.category]}</span>
        {activity.is_demo && <DemoBadge className="absolute right-4 top-4 bg-nav/85" />}
        {/* Sitzt auf der Kante zwischen Bild und Text – so bleibt die Preiszeile frei. */}
        <button
          type="button"
          onClick={toggle}
          aria-pressed={selected}
          aria-label={selected ? t.discover.card.removeFromPoll(activity.name) : `${activity.name}: ${t.discover.card.addToPoll}`}
          title={selected ? t.discover.card.addedToPoll : t.discover.card.addToPoll}
          className={cn(
            "absolute -bottom-[22px] right-3 z-10 inline-flex size-11 items-center justify-center rounded-full border-2 transition-colors",
            selected ? "border-base bg-lime text-lime-ink shadow-[0_10px_24px_-10px_var(--color-lime)]" : "border-base bg-raised text-fg ring-1 ring-line-strong hover:bg-lime hover:text-lime-ink hover:ring-lime",
          )}
        >
          {selected ? <IconCheck className="size-5" strokeWidth={3} aria-hidden /> : <IconPlus className="size-5" aria-hidden />}
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <div className="min-w-0">
          <h3 className="pr-12 font-display text-[16px] font-bold leading-tight tracking-[-0.01em] text-fg">
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
