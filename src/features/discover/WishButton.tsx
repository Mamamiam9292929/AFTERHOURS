import { useState } from "react";
import { IconBookmark, IconBookmarkCheck, IconForward } from "@/components/icons";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { useCrews } from "@/features/crews/api";
import { useToggleCrewWish, useWishCrews } from "@/features/crews/wishlistApi";
import { PANEL_ITEM } from "@/features/plans/PlanPanel";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import type { Activity } from "@/lib/types";

const tx = t.discover.detail.wish;
const listLink = (crewId: string) => `/crews/${crewId}#merkliste`;

/**
 * P22 · „Für die Crew merken“ auf der Seite eines Orts. Eine Crew: ein Tipp merkt den Ort, danach führt der
 * Knopf zur Liste. Mehrere Crews: Auswahl im Dialog. Entfernen nur auf der Crew-Seite – dort weiß der Server,
 * wer darf. Ohne Crew (oder solange die Crews laden) kein Knopf.
 */
export function WishButton({ activity }: { activity: Pick<Activity, "id" | "name"> }) {
  const crews = useCrews();
  const list = crews.data ?? [];
  const saved = useWishCrews(activity.id, list.length > 0);
  const toggle = useToggleCrewWish();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pendingCrew, setPendingCrew] = useState<string | null>(null);

  if (list.length === 0) return null;
  const savedIds = new Set(saved.data ?? []);

  function add(crewId: string, crewName: string) {
    setPendingCrew(crewId);
    toggle.mutate(
      { crewId, activityId: activity.id, add: true },
      {
        onSuccess: () => toast.success(tx.added(crewName)),
        onError: (error) => toast.error(error),
        onSettled: () => setPendingCrew(null),
      },
    );
  }

  const single = list.length === 1 ? list[0] : null;
  if (single) {
    if (savedIds.has(single.id)) {
      return (
        <ButtonLink to={listLink(single.id)} variant="secondary" size="lg" block icon={<IconBookmarkCheck className="size-5 text-lime" aria-hidden />} data-testid="wish-saved">
          {tx.saved}
        </ButtonLink>
      );
    }
    return (
      <Button
        variant="secondary"
        size="lg"
        block
        loading={pendingCrew === single.id}
        disabled={saved.isPending}
        onClick={() => add(single.id, single.name)}
        icon={<IconBookmark className="size-5" aria-hidden />}
        data-testid="wish-add"
      >
        {tx.add}
      </Button>
    );
  }

  const allSaved = list.every((c) => savedIds.has(c.id));
  return (
    <>
      <Button
        variant="secondary"
        size="lg"
        block
        disabled={saved.isPending}
        onClick={() => setOpen(true)}
        icon={allSaved ? <IconBookmarkCheck className="size-5 text-lime" aria-hidden /> : <IconBookmark className="size-5" aria-hidden />}
        data-testid={allSaved ? "wish-saved" : "wish-add"}
      >
        {allSaved ? tx.saved : tx.add}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={tx.dialogTitle} description={tx.dialogLead} size="sm">
        <ul className="grid gap-1.5" data-testid="wish-dialog">
          {list.map((crew) => {
            const on = savedIds.has(crew.id);
            return (
              <li key={crew.id} className={cn(PANEL_ITEM, "flex items-center gap-3 py-2 pl-4 pr-2")}>
                <span aria-hidden className="text-xl">
                  {crew.emoji}
                </span>
                <span className="min-w-0 flex-1 truncate font-semibold text-fg">{crew.name}</span>
                {on ? (
                  <ButtonLink to={listLink(crew.id)} size="sm" variant="ghost" aria-label={tx.savedFor(crew.name)} icon={<IconBookmarkCheck className="size-4 text-lime" aria-hidden />}>
                    {tx.on}
                    <IconForward className="size-3.5 text-faint" aria-hidden />
                  </ButtonLink>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={pendingCrew === crew.id}
                    disabled={pendingCrew !== null}
                    onClick={() => add(crew.id, crew.name)}
                    aria-label={tx.addFor(crew.name)}
                    icon={<IconBookmark className="size-4" aria-hidden />}
                  >
                    {tx.off}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </Dialog>
    </>
  );
}
