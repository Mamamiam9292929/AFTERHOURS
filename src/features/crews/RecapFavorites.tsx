import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { IconRefresh } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Feedback";
import { loadTexts, t } from "@/i18n";
import { qk } from "@/lib/query";
import { supabase } from "@/lib/supabase";
import { formatDateShort } from "@/lib/time";

// F7: Die Texte gehören zu „Wie war’s?“ (P29) und liegen nicht im Start-Bundle.
await loadTexts("planFeedback");

export interface FavoriteEvening {
  plan_id: string;
  title: string;
  starts_at: string;
  again: number;
  total: number;
}

/**
 * P29 Etappe 2 · „Eure Lieblingsabende“ im Crew-Rückblick: bis zu drei abgeschlossene Abende, bei denen mindestens zwei
 * und mehr als die Hälfte „Nochmal!“ gesagt haben (`crew_favorite_evenings`, gleiche Regel wie `isFavoriteEvening`).
 * Meiste „Nochmal!“ zuerst; in „Euer Jahr“ nur Abende des Jahres. Nur Zahlen, keine Namen – wie auf der Planseite.
 * Ein Tipp führt zum Plan, wo „Nochmal?“ (P17) die nächste Runde startet. Nicht im Rückblick-Bild zum Teilen.
 */
export function RecapFavorites({ crewId, year }: { crewId: string; year: number | null }) {
  const tx = t.planFeedback.favorites;
  const query = useQuery({
    queryKey: qk.crewFavoriteEvenings(crewId, year),
    queryFn: async (): Promise<FavoriteEvening[]> => {
      const { data, error } = await supabase.rpc("crew_favorite_evenings", { p_crew_id: crewId, p_year: year });
      if (error) throw error;
      return (data ?? []) as FavoriteEvening[];
    },
  });
  const evenings = query.data ?? [];
  const state = query.isPending ? "loading" : query.isError ? "error" : evenings.length === 0 ? "empty" : "ready";

  return (
    <div data-testid="recap-favorites" data-state={state}>
      <h4 className="mt-6 text-[13px] font-medium text-muted">{tx.title}</h4>
      {query.isPending ? (
        <div className="mt-2 grid gap-1.5" role="status" aria-label={tx.loading}>
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-11 rounded-[16px]" />
          ))}
        </div>
      ) : query.isError ? (
        <div role="alert" className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-[14px] leading-snug text-muted">{tx.failed}</p>
          <Button variant="secondary" size="sm" icon={<IconRefresh className="size-4" aria-hidden />} onClick={() => void query.refetch()}>
            {t.actions.retry}
          </Button>
        </div>
      ) : evenings.length === 0 ? (
        <p className="mt-2 text-[14px] leading-snug text-faint">{tx.empty}</p>
      ) : (
        <ol className="mt-2 grid gap-1.5">
          {evenings.map((evening, index) => {
            const date = formatDateShort(evening.starts_at);
            return (
              <li key={evening.plan_id}>
                <Link
                  to={`/plans/${evening.plan_id}#nochmal`}
                  aria-label={tx.open(evening.title, date, evening.again)}
                  data-testid="recap-favorite"
                  className="group flex min-h-11 items-center gap-3 rounded-[16px] border border-white/[0.1] bg-white/[0.04] px-3.5 py-2.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime"
                >
                  <span aria-hidden className="display w-5 text-[14px] text-faint">
                    {index + 1}
                  </span>
                  <span aria-hidden className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-fg group-hover:text-lime">{evening.title}</span>
                    <span className="block truncate text-[12px] leading-tight text-muted">{date}</span>
                  </span>
                  <span
                    aria-hidden
                    className="inline-flex h-7 shrink-0 items-center rounded-full bg-lime px-2.5 text-[12px] font-bold whitespace-nowrap text-lime-ink shadow-[0_0_14px_color-mix(in_srgb,var(--color-lime)_45%,transparent)]"
                  >
                    {tx.count(evening.again)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
