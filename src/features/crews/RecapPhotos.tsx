import { Link } from "react-router-dom";
import { IconRefresh } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Feedback";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { recapPhotoStacks } from "@/lib/recap";
import { formatDateShort } from "@/lib/time";
import { useCrewPhotoStacks } from "./photoStacksApi";

const tx = t.crews.recap.photos;

/**
 * P10 Etappe 2c · Fotos im Crew-Rückblick: die letzten (bis zu drei) abgeschlossenen Abende mit Fotos als
 * kleine Stapel – neuestes Foto vorn, bis zu zwei gedreht dahinter, wie auf der Planseite. Ein Tipp führt zu
 * „Fotos vom Abend“ des Plans. In „Euer Jahr“ nur Abende des Jahres. Gemeldete Fotos fehlen (Server).
 * Nicht im Rückblick-Bild zum Teilen – das bleibt bei Zahlen.
 */
export function RecapPhotos({ crewId, year }: { crewId: string; year: number | null }) {
  const query = useCrewPhotoStacks(crewId);
  const stacks = query.data ? recapPhotoStacks(query.data, year) : [];

  return (
    <div data-testid="recap-photos" data-state={query.isPending ? "loading" : query.isError ? "error" : stacks.length === 0 ? "empty" : "ready"}>
      <h4 className="mt-6 text-[13px] font-medium text-muted">{tx.title}</h4>
      {query.isPending ? (
        <div className="mt-3 grid grid-cols-3 gap-3 sm:gap-4" role="status" aria-label={tx.loading}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="aspect-[4/3] rounded-[14px]" />
          ))}
        </div>
      ) : query.isError ? (
        <div role="alert" className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-[14px] leading-snug text-muted">{tx.failed}</p>
          <Button variant="secondary" size="sm" icon={<IconRefresh className="size-4" aria-hidden />} onClick={() => void query.refetch()}>
            {t.actions.retry}
          </Button>
        </div>
      ) : stacks.length === 0 ? (
        <p className="mt-2 text-[14px] leading-snug text-faint">{tx.empty}</p>
      ) : (
        <ul className="mt-3 grid grid-cols-3 gap-3 sm:gap-4">
          {stacks.map((stack) => {
            const date = formatDateShort(stack.starts_at);
            return (
              <li key={stack.plan_id} className="min-w-0">
                <Link
                  to={`/plans/${stack.plan_id}#fotos`}
                  aria-label={tx.open(stack.title, date, stack.count)}
                  data-testid="recap-photo-stack"
                  className="photo-stack group block rounded-[16px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-lime"
                >
                  <span className="block px-[9%] pt-1 pb-2">
                    <span className="relative block aspect-[4/3] w-full">
                      {stack.photos
                        .map((photo, layer) => (
                          <span
                            key={photo.id}
                            aria-hidden
                            data-layer={layer}
                            className={cn(
                              "photo-layer absolute inset-0 overflow-hidden rounded-[14px] border bg-raised",
                              layer === 0 ? "border-white/20 shadow-[0_16px_30px_-16px_rgb(0_0_0/0.9)]" : "border-white/10 shadow-[0_10px_22px_-14px_rgb(0_0_0/0.8)]",
                            )}
                          >
                            {photo.url && (
                              <img src={photo.url} alt="" loading="lazy" decoding="async" width={photo.width} height={photo.height} className={cn("size-full object-cover", layer > 0 && "opacity-60")} />
                            )}
                          </span>
                        ))
                        .reverse()}
                    </span>
                  </span>
                  <span aria-hidden className="mt-1 block truncate text-[13px] font-semibold leading-tight text-fg group-hover:text-lime">
                    {stack.title}
                  </span>
                  <span aria-hidden className="mt-0.5 block truncate text-[12px] leading-tight text-muted">
                    {date} · {tx.count(stack.count)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
