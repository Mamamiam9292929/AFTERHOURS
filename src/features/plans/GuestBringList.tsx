import { useState } from "react";
import { IconCheck } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/Feedback";
import { FormMessage } from "@/components/ui/Field";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { useGuestClaimPlanItem, useSharedPlanItems } from "./guestsApi";

/**
 * P52 · Gäste bringen was mit: die Mitbring-Liste der Crew (P14) auf der Zusagekarte des Teilen-Links (W10), für
 * Gäste mit „Bin dabei“ oder „Vielleicht“. Offene Sachen stehen oben und lassen sich mit „Bring ich“ übernehmen,
 * eigene mit „Doch nicht“ freigeben. Wer die anderen Sachen mitbringt, steht hier nicht – Namen bleiben in der Crew.
 * Ohne Sachen auf der Liste zeigt die Karte nichts (die Crew hat dann nichts aufgeschrieben).
 */
export function GuestBringList({ token, secret }: { token: string; secret: string }) {
  const items = useSharedPlanItems(token, secret, true);
  const claim = useGuestClaimPlanItem(token, secret);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const texts = t.planGuests.items;

  if (items.isPending) {
    return (
      <div className="vote-card h-28 animate-pulse p-4" data-testid="rsvp-items-loading" aria-busy="true">
        <span className="sr-only">{texts.loading}</span>
      </div>
    );
  }
  if (items.isError) return <ErrorState error={items.error} onRetry={() => void items.refetch()} />;

  const list = items.data.items;
  if (list.length === 0) return null;
  const open = items.data.open;
  const sorted = [...list].sort((a, b) => Number(a.state !== "open") - Number(b.state !== "open"));
  const taken = list.filter((i) => i.state !== "open").length;

  function toggle(id: string, label: string, value: boolean) {
    setBusyId(id);
    setMessage(null);
    claim.mutate(
      { itemId: id, claim: value },
      {
        onSuccess: () => setMessage({ tone: "success", text: value ? texts.claimed(label) : texts.unclaimed(label) }),
        onError: (error) => setMessage({ tone: "error", text: errorMessage(error) }),
        onSettled: () => setBusyId(null),
      },
    );
  }

  return (
    <section className="vote-card p-4 sm:p-5" aria-labelledby="rsvp-items-title" data-testid="rsvp-items">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="rsvp-items-title" className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
          {texts.title}
        </h2>
        <span
          data-testid="rsvp-items-progress"
          className={cn(
            "inline-flex h-8 items-center rounded-full px-3 text-[13px] font-bold whitespace-nowrap",
            taken === list.length ? "bg-lime text-lime-ink" : "border border-amber/50 bg-amber/15 text-amber",
          )}
        >
          {texts.progress(taken, list.length)}
        </span>
      </div>
      <p className="mt-1.5 text-[14px] leading-snug text-muted">{open ? texts.intro : texts.locked}</p>
      <ul className="mt-3 space-y-2" aria-label={texts.title}>
        {sorted.map((item) => (
          <li
            key={item.id}
            data-testid="rsvp-item"
            data-state={item.state}
            className={cn(
              "flex min-h-14 items-center gap-3 rounded-[20px] border border-white/10 bg-white/[0.04] py-2 pr-2 pl-3.5",
              item.state === "mine" && "border-lime/45 bg-lime/[0.07]",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-full",
                item.state === "open" ? "border-2 border-dashed border-white/25" : "bg-lime text-lime-ink",
                item.state === "taken" && "opacity-60",
              )}
            >
              {item.state !== "open" && <IconCheck className="size-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn("font-semibold break-words text-fg", item.state === "taken" && "text-muted")}>{item.label}</p>
              <p className={cn("mt-0.5 text-[13px]", item.state === "open" ? "font-semibold text-amber" : "text-muted")}>
                {item.state === "open" ? texts.open : item.state === "mine" ? texts.mine : texts.taken}
              </p>
            </div>
            {open && item.state === "open" && (
              <Button size="sm" variant="secondary" aria-label={texts.claimLabel(item.label)} loading={busyId === item.id} disabled={claim.isPending && busyId !== item.id} onClick={() => toggle(item.id, item.label, true)}>
                {texts.claim}
              </Button>
            )}
            {open && item.state === "mine" && (
              <Button size="sm" variant="ghost" aria-label={texts.unclaimLabel(item.label)} loading={busyId === item.id} disabled={claim.isPending && busyId !== item.id} onClick={() => toggle(item.id, item.label, false)}>
                {texts.unclaim}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div aria-live="polite" className="mt-2 empty:hidden">
        {message && <FormMessage tone={message.tone === "success" ? "success" : undefined}>{message.text}</FormMessage>}
      </div>
    </section>
  );
}
