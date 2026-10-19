import { useMemo } from "react";
import { Link } from "react-router-dom";
import { IconForward } from "@/components/icons";
import { Section } from "@/components/layout/Page";
import { ErrorState } from "@/components/ui/Feedback";
import type { PlanWithParticipants } from "@/features/plans/api";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { formatEuro } from "@/lib/format";
import { openPlans } from "@/lib/settle";
import { formatDateShort } from "@/lib/time";
import { useCrewBalances } from "./api";

const tx = t.crews.balances;

/**
 * P3 Etappe 3 · Offene Beträge der Crew: eigener Stand über alle Abende und je Abend, was noch offen
 * ist – mit Sprung zu „Kosten teilen“ auf der Planseite. Erscheint erst, wenn etwas offen ist; solange
 * die Salden laden, bleibt der Platz leer (Crews ohne Ausgaben sollen nicht kurz einen Platzhalter sehen).
 */
export function CrewBalances({ crewId, userId, plans }: { crewId: string; userId: string; plans: readonly PlanWithParticipants[] }) {
  const balances = useCrewBalances(crewId);
  const summary = useMemo(() => {
    const { plans: open, total } = openPlans(balances.data ?? [], userId);
    const byId = new Map(plans.map((plan) => [plan.id, plan]));
    // Neueste Abende zuerst; Abende außerhalb der geladenen Liste (sehr alt) ans Ende.
    const rows = open
      .map((entry) => ({ ...entry, plan: byId.get(entry.planId) ?? null }))
      .sort((a, b) => (b.plan?.starts_at ?? "").localeCompare(a.plan?.starts_at ?? ""));
    return { rows, total };
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

  const { total, rows } = summary;
  const sign = total > 0 ? "+" : total < 0 ? "−" : "±";

  return (
    <Section title={tx.title}>
      <div className="max-w-2xl overflow-hidden rounded-card border border-line bg-surface" data-testid="crew-balances">
        <div className="flex items-end justify-between gap-4 p-4 sm:p-5">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-muted">{tx.yourTotal}</p>
            <p className="mt-1 text-[15px] font-semibold text-fg">
              {total > 0 ? tx.totalGets(formatEuro(total)) : total < 0 ? tx.totalOwes(formatEuro(-total)) : tx.totalEven}
            </p>
            <p className="mt-0.5 text-[13px] text-muted">{total === 0 ? tx.othersOnly : tx.planCount(rows.length)}</p>
          </div>
          <p className={cn("display shrink-0 text-[26px] leading-none sm:text-[32px]", total > 0 ? "text-lime" : total < 0 ? "text-amber" : "text-fg")}>
            {sign}
            {formatEuro(Math.abs(total))}
          </p>
        </div>
        {/* Abriss wie beim Ticket: gestrichelte Linie zwischen Stand und Abenden. */}
        <ul className="divide-y divide-line border-t border-dashed border-line-strong">
          {rows.map(({ planId, mine, transfers, plan }) => {
            const title = plan?.title ?? tx.unknownPlan;
            const state = mine > 0 ? tx.gets(formatEuro(mine)) : mine < 0 ? tx.owes(formatEuro(-mine)) : tx.others(transfers.length);
            return (
              <li key={planId}>
                <Link
                  to={`/plans/${planId}#kosten`}
                  aria-label={tx.open(title, state)}
                  className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-raised focus-visible:bg-raised sm:px-5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-fg">{title}</span>
                    {plan && <span className="block text-[13px] text-muted">{formatDateShort(plan.starts_at)}</span>}
                  </span>
                  <span className={cn("shrink-0 text-right text-sm font-semibold", mine > 0 ? "text-lime" : mine < 0 ? "text-amber" : "text-muted")}>{state}</span>
                  <IconForward className="size-4 shrink-0 text-faint" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="mt-2 max-w-2xl text-[13px] leading-snug text-faint">{tx.hint}</p>
    </Section>
  );
}
