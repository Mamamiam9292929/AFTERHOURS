import { useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { IconBookmark, IconDiscover, IconTrash, IconVote } from "@/components/icons";
import { Button, ButtonLink, IconButton } from "@/components/ui/Button";
import { DemoBadge, ErrorState } from "@/components/ui/Feedback";
import { PanelCard } from "@/components/ui/PanelCard";
import { useToast } from "@/components/ui/Toast";
import { CategoryArt } from "@/features/discover/CategoryArt";
import { PANEL_ITEM, StatusPill } from "@/features/plans/PlanPanel";
import { MAX_POLL_OPTIONS, usePollDraft } from "@/features/polls/draft";
import { usePeople } from "@/features/profile/api";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { categoryWorld } from "@/lib/stage";
import { wishPollItems, type CrewWish } from "@/lib/wishlist";
import { useCrewWishes, useToggleCrewWish } from "./wishlistApi";

const tx = t.crews.detail.wishlist;

/**
 * P22 · „Wollen wir mal hin“ auf der Crew-Seite: Orte, die jemand aus der Crew in Discover gemerkt hat
 * (neueste zuerst), mit „Abstimmung daraus“ – die Orte kommen in den Sammelkorb der Abstimmung (höchstens
 * zehn), die Crew ist vorausgewählt. Entfernen dürfen, wer gemerkt hat, Owner und Admins (sagt der Server).
 * Leer: Hinweis mit Weg nach Discover. Lädt: Platzhalter. Fehler: Fehlerzustand mit „Nochmal“.
 */
export function CrewWishlist({ crewId, userId }: { crewId: string; userId: string }) {
  const wishes = useCrewWishes(crewId);
  const toggle = useToggleCrewWish();
  const people = usePeople();
  const draft = usePollDraft();
  const navigate = useNavigate();
  const toast = useToast();
  const list = wishes.data ?? [];
  const items = useMemo(() => wishPollItems(list, MAX_POLL_OPTIONS), [list]);
  const demoLeftOut = items.length > 0 && list.some((w) => w.is_demo) && list.some((w) => !w.is_demo);
  const poolSize = list.filter((w) => !demoLeftOut || !w.is_demo).length;

  // Aus Discover („Zur Liste“) führt der Weg zu `/crews/<id>#merkliste` – sobald die Karte steht, dorthin.
  useEffect(() => {
    if (wishes.isSuccess && window.location.hash === "#merkliste") document.getElementById("merkliste")?.scrollIntoView({ block: "start" });
  }, [wishes.isSuccess]);

  function startPoll() {
    draft.replace(items);
    navigate(`/polls/new?crew=${crewId}`);
  }

  function remove(wish: CrewWish) {
    toggle.mutate(
      { crewId, activityId: wish.activity_id, add: false },
      { onSuccess: () => toast.success(tx.removed(wish.name)), onError: (error) => toast.error(error) },
    );
  }

  return (
    <div className="mt-9 max-w-2xl">
      <PanelCard
        id="merkliste"
        title={tx.title}
        icon={<IconBookmark />}
        tone="lime"
        lead={list.length > 0 ? tx.lead : undefined}
        status={list.length > 0 ? <StatusPill tone="glass" testId="crew-wishlist-count">{tx.count(list.length)}</StatusPill> : undefined}
        testId="crew-wishlist"
      >
        {wishes.isPending ? (
          <ul className="grid gap-1.5" aria-busy="true" aria-label={t.states.loading}>
            {[0, 1].map((i) => (
              <li key={i} className="h-[68px] animate-pulse rounded-[20px] bg-white/[0.04]" />
            ))}
          </ul>
        ) : wishes.isError ? (
          <ErrorState error={wishes.error} onRetry={() => void wishes.refetch()} />
        ) : list.length === 0 ? (
          <div className={cn(PANEL_ITEM, "px-4 py-4")} data-testid="crew-wishlist-empty">
            <p className="font-semibold text-fg">{tx.emptyTitle}</p>
            <p className="mt-1 text-[14px] leading-snug text-muted">{tx.emptyBody}</p>
            <ButtonLink to="/discover" size="sm" variant="secondary" className="mt-3" icon={<IconDiscover className="size-4" aria-hidden />}>
              {tx.emptyAction}
            </ButtonLink>
          </div>
        ) : (
          <>
            <ul className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5">
              {list.map((wish) => {
                const by = wish.added_by === userId ? tx.byYou : wish.added_by ? people.lookup(wish.added_by)?.display_name : null;
                return (
                  <li key={wish.activity_id} data-testid="crew-wish" className={cn(PANEL_ITEM, "flex min-w-0 items-center gap-3 py-2 pl-2 pr-1.5")}>
                    <span aria-hidden className="cat-world size-12 shrink-0 overflow-hidden rounded-[16px] border border-white/10" data-world={categoryWorld(wish.category)}>
                      <CategoryArt category={wish.category} onLight />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <Link to={`/activities/${wish.activity_id}`} className="min-w-0 truncate font-semibold text-fg underline-offset-2 hover:underline">
                          {wish.name}
                        </Link>
                        {wish.is_demo && <DemoBadge className="shrink-0" />}
                      </span>
                      <span className="block truncate text-[13px] text-muted">
                        {[t.enums.category[wish.category], wish.city, by && (wish.added_by === userId ? by : tx.by(by))].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    {wish.can_remove && (
                      <IconButton label={tx.remove(wish.name)} onClick={() => remove(wish)} disabled={toggle.isPending} data-testid="crew-wish-remove">
                        <IconTrash className="size-[18px] text-muted" aria-hidden />
                      </IconButton>
                    )}
                  </li>
                );
              })}
            </ul>
            {items.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                <Button onClick={startPoll} icon={<IconVote className="size-5" aria-hidden />} data-testid="crew-wishlist-poll">
                  {tx.startPoll}
                </Button>
                <p className="min-w-0 flex-1 basis-56 text-[13px] leading-snug text-muted">
                  {poolSize > items.length ? tx.startPollNewest(items.length) : tx.startPollAll(items.length)}
                  {demoLeftOut && ` ${tx.demoLeftOut}`}
                </p>
              </div>
            )}
          </>
        )}
      </PanelCard>
    </div>
  );
}
