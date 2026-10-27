import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { IconForward, IconWallet } from "@/components/icons";
import { Section } from "@/components/layout/Page";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/Feedback";
import { PanelCard } from "@/components/ui/PanelCard";
import { useToast } from "@/components/ui/Toast";
import { PANEL_ITEM, StatusPill } from "@/features/plans/PlanPanel";
import type { PlanWithParticipants } from "@/features/plans/api";
import { usePeople } from "@/features/profile/api";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { formatEuro } from "@/lib/format";
import { openPlans, pairTotals, type PairTotal } from "@/lib/settle";
import { formatDateShort } from "@/lib/time";
import { useCrewBalances, useSettleWith } from "./api";

const tx = t.crews.balances;

/**
 * P3 Etappe 3 · Offene Beträge der Crew: eigener Stand über alle Abende und je Abend, was noch offen
 * ist – mit Sprung zu „Kosten teilen“ auf der Planseite. Erscheint erst, wenn etwas offen ist; solange
 * die Salden laden, bleibt der Platz leer (Crews ohne Ausgaben sollen nicht kurz einen Platzhalter sehen).
 * Seit D8 als Glas-Karte im Stil 2.0 (`PanelCard`), Beträge je Abend als Pillen in Lime bzw. Gelb.
 * P3 Etappe 3c: Ist mit derselben Person bei mindestens zwei Abenden etwas offen, steht darunter
 * „Mit einer Überweisung“ – die Summe über diese Abende und „Alles erledigt“ (`settle_crew_balances_with`).
 */
export function CrewBalances({ crewId, userId, plans }: { crewId: string; userId: string; plans: readonly PlanWithParticipants[] }) {
  const balances = useCrewBalances(crewId);
  const people = usePeople();
  const toast = useToast();
  const settleWith = useSettleWith(crewId);
  const [confirming, setConfirming] = useState<PairTotal | null>(null);
  const summary = useMemo(() => {
    const { plans: open, total } = openPlans(balances.data ?? [], userId);
    const byId = new Map(plans.map((plan) => [plan.id, plan]));
    // Neueste Abende zuerst; Abende außerhalb der geladenen Liste (sehr alt) ans Ende.
    const rows = open
      .map((entry) => ({ ...entry, plan: byId.get(entry.planId) ?? null }))
      .sort((a, b) => (b.plan?.starts_at ?? "").localeCompare(a.plan?.starts_at ?? ""));
    // Zusammenfassen lohnt erst ab zwei Abenden; bei einem reicht „Erledigt“ auf der Planseite.
    const pairs = pairTotals(open, userId).filter((pair) => pair.plans.length >= 2);
    return { rows, total, pairs, byId };
  }, [balances.data, plans, userId]);

  if (balances.isPending) return null;
  if (balances.isError) {
    return (
      <Section title={tx.title}>
        <ErrorState error={balances.error} onRetry={() => void balances.refetch()} />
      </Section>
    );
  }
  if (summary.rows.length === 0) return null;

  const { total, rows, pairs, byId } = summary;
  const name = (id: string) => people.lookup(id)?.display_name ?? t.states.formerMember;
  const pairText = (pair: PairTotal) =>
    pair.net > 0 ? tx.pairGets(name(pair.other), formatEuro(pair.net)) : pair.net < 0 ? tx.pairOwes(name(pair.other), formatEuro(-pair.net)) : tx.pairEven(name(pair.other));
  const pairPlansText = (pair: PairTotal) =>
    pair.plans
      .map(({ planId, cents }) =>
        tx.pairPlanPart(byId.get(planId)?.title ?? tx.unknownPlan, `${cents > 0 ? "+" : "−"}${formatEuro(Math.abs(cents))}`),
      )
      .join(", ");
  const sign = total > 0 ? "+" : total < 0 ? "−" : "±";

  // V2 (D8): Glas-Karte wie die Bereiche der Planseite; der Schein folgt dem eigenen Stand
  // (Lime: du bekommst, Gelb: du gibst, sonst Violett) – nur als Licht, die Zahl trägt die Farbe.
  return (
    <div className="mt-9 max-w-2xl">
      <PanelCard
        id="offene-betraege"
        title={tx.title}
        icon={<IconWallet />}
        tone={total > 0 ? "lime" : total < 0 ? "amber" : "violet"}
        status={<StatusPill tone="glass">{tx.planCount(rows.length)}</StatusPill>}
        testId="crew-balances"
      >
        <div className={cn(PANEL_ITEM, "flex items-end justify-between gap-4 p-4")}>
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-muted">{tx.yourTotal}</p>
            <p className="mt-1 text-[15px] font-semibold text-fg">
              {total > 0 ? tx.totalGets(formatEuro(total)) : total < 0 ? tx.totalOwes(formatEuro(-total)) : tx.totalEven}
            </p>
            {total === 0 && <p className="mt-0.5 text-[13px] text-muted">{tx.othersOnly}</p>}
          </div>
          <p className={cn("display shrink-0 text-[26px] leading-none sm:text-[32px]", total > 0 ? "text-lime" : total < 0 ? "text-amber" : "text-fg")}>
            {sign}
            {formatEuro(Math.abs(total))}
          </p>
        </div>
        <ul className="mt-2 grid gap-1.5">
          {rows.map(({ planId, mine, transfers, plan }) => {
            const title = plan?.title ?? tx.unknownPlan;
            const state = mine > 0 ? tx.gets(formatEuro(mine)) : mine < 0 ? tx.owes(formatEuro(-mine)) : tx.others(transfers.length);
            return (
              <li key={planId}>
                <Link
                  to={`/plans/${planId}#kosten`}
                  aria-label={tx.open(title, state)}
                  className={cn(PANEL_ITEM, "flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-raised focus-visible:bg-raised")}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-fg">{title}</span>
                    {plan && <span className="block text-[13px] text-muted">{formatDateShort(plan.starts_at)}</span>}
                  </span>
                  {mine !== 0 ? (
                    <StatusPill tone={mine > 0 ? "lime" : "amber"}>{state}</StatusPill>
                  ) : (
                    <span className="shrink-0 text-right text-sm font-semibold text-muted">{state}</span>
                  )}
                  <IconForward className="size-4 shrink-0 text-faint" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
        {pairs.length > 0 && (
          <div className="mt-5" data-testid="crew-balances-pairs">
            <h3 className="text-[13px] font-semibold tracking-wide text-muted uppercase">{tx.pairsTitle}</h3>
            <ul className="mt-2 grid gap-1.5">
              {pairs.map((pair) => {
                const text = pairText(pair);
                return (
                  <li key={pair.other} className={cn(PANEL_ITEM, "flex flex-wrap items-center gap-3 px-4 py-3")}>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block font-semibold", pair.net > 0 ? "text-lime" : pair.net < 0 ? "text-amber" : "text-fg")}>{text}</span>
                      <span className="block text-[13px] text-muted">{pair.net === 0 ? tx.pairEvenPlans(pair.plans.length) : tx.pairPlans(pair.plans.length)}</span>
                    </span>
                    <Button size="sm" variant="secondary" onClick={() => setConfirming(pair)} aria-label={tx.pairSettleLabel(text)}>
                      {tx.pairSettle}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </PanelCard>
      <p className="mt-2 text-[13px] leading-snug text-faint">{pairs.length > 0 ? tx.pairsHint : tx.hint}</p>
      <ConfirmDialog
        open={confirming != null}
        onClose={() => {
          setConfirming(null);
          settleWith.reset();
        }}
        title={tx.pairConfirmTitle}
        description={
          confirming
            ? confirming.net === 0
              ? tx.pairEvenConfirmBody(name(confirming.other), pairPlansText(confirming))
              : tx.pairConfirmBody(pairText(confirming), pairPlansText(confirming))
            : ""
        }
        confirmLabel={tx.pairConfirm}
        loading={settleWith.isPending}
        error={settleWith.isError ? errorMessage(settleWith.error) : null}
        onConfirm={() =>
          confirming &&
          settleWith.mutate(
            { other: confirming.other, expectedCents: confirming.net },
            {
              onSuccess: () => {
                toast.success(tx.pairSettled(confirming.plans.length));
                setConfirming(null);
              },
            },
          )
        }
      />
    </div>
  );
}
