import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { IconCamera, IconExternal, IconRefresh } from "@/components/icons";
import { SwitchRow } from "@/components/ui/Controls";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { hasPhotoRef, loadPlacePhoto, photosAutoLoad, setPhotosAutoLoad } from "@/lib/commons";
import type { Activity } from "@/lib/types";
import { ActivityCover } from "./ActivityCard";

const pill = "glass inline-flex h-10 items-center gap-2 rounded-full border border-white/15 px-4 text-[14px] font-semibold text-fg";
const creditLink = "underline decoration-white/25 underline-offset-2 hover:text-fg hover:decoration-lime";

/**
 * P7 · Titelbild eines Ortes mit Foto von Wikimedia Commons. Ohne Verweis aus OSM bleibt es bei der
 * Kategorie-Grafik. Mit Verweis geht erst eine Anfrage an Wikimedia, wenn die Person „Foto anzeigen“
 * tippt oder Fotos auf diesem Gerät eingeschaltet hat – wie bei der Karte („Karte laden“).
 */
export function PlacePhoto({ activity, className }: { activity: Activity; className?: string }) {
  const [auto, setAuto] = useState(photosAutoLoad);
  const [asked, setAsked] = useState(false);
  const [broken, setBroken] = useState(false);
  const ref = { commons_file: activity.commons_file ?? null, wikidata_id: activity.wikidata_id ?? null };
  const available = hasPhotoRef(ref);
  const wanted = available && (auto || asked);
  const photo = useQuery({
    queryKey: ["place-photo", activity.id, ref.commons_file, ref.wikidata_id],
    enabled: wanted,
    staleTime: 60 * 60_000,
    retry: false,
    queryFn: () => loadPlacePhoto(ref),
  });

  if (!available) return <ActivityCover activity={activity} className={className} />;

  const shown = wanted && photo.data && !broken ? photo.data : null;
  const failed = wanted && (photo.isError || broken);
  const none = wanted && photo.isSuccess && photo.data === null;

  return (
    <figure className="m-0">
      <div className={cn("relative overflow-hidden bg-surface", className)}>
        {shown ? (
          <img
            src={shown.src}
            width={shown.width ?? undefined}
            height={shown.height ?? undefined}
            alt={t.discover.photo.alt(activity.name)}
            referrerPolicy="no-referrer"
            decoding="async"
            draggable={false}
            className="size-full object-cover"
            onError={() => setBroken(true)}
          />
        ) : (
          <ActivityCover activity={activity} className="size-full" />
        )}
        {!shown && (
          <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-2 p-3" aria-live="polite">
            {!wanted && (
              <button type="button" className={pill} onClick={() => setAsked(true)}>
                <IconCamera className="size-4" aria-hidden />
                {t.discover.photo.show}
              </button>
            )}
            {wanted && photo.isFetching && (
              <span className={cn(pill, "text-muted")} role="status">
                <span aria-hidden className="size-2 animate-pulse rounded-full bg-lime motion-reduce:animate-none" />
                {t.discover.photo.loading}
              </span>
            )}
            {failed && !photo.isFetching && (
              <>
                <span className={cn(pill, "text-muted")}>{t.discover.photo.failed}</span>
                <button
                  type="button"
                  className={pill}
                  onClick={() => {
                    setBroken(false);
                    void photo.refetch();
                  }}
                >
                  <IconRefresh className="size-4" aria-hidden />
                  {t.discover.photo.retry}
                </button>
              </>
            )}
            {none && <span className={cn(pill, "text-muted")}>{t.discover.photo.none}</span>}
          </div>
        )}
      </div>

      <figcaption className="mt-2.5 space-y-1 text-[13px] leading-snug text-faint">
        {shown ? (
          <p data-testid="photo-credit">
            {t.discover.photo.by}{" "}
            <a href={shown.pageUrl} target="_blank" rel="noopener noreferrer" className={creditLink}>
              {shown.author ?? t.discover.photo.unknownAuthor}
            </a>
            {" · "}
            {shown.licenseUrl ? (
              <a href={shown.licenseUrl} target="_blank" rel="noopener noreferrer license" className={creditLink}>
                {shown.license}
              </a>
            ) : (
              shown.license
            )}
            {" · "}
            <a href={shown.pageUrl} target="_blank" rel="noopener noreferrer" className={cn(creditLink, "inline-flex items-center gap-1")}>
              {t.discover.photo.source}
              <IconExternal className="size-3" aria-hidden />
            </a>
          </p>
        ) : (
          !auto && <p>{t.discover.photo.privacy}</p>
        )}
      </figcaption>
      <div className="mt-1">
        <SwitchRow
          label={t.discover.photo.autoLabel}
          description={t.discover.photo.autoHint}
          checked={auto}
          onChange={(on) => {
            setPhotosAutoLoad(on);
            setAuto(on);
          }}
        />
      </div>
    </figure>
  );
}
