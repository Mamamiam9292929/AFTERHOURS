import { useMemo } from "react";
import { Link } from "react-router-dom";
import { IconForward, IconWallet } from "@/components/icons";
import { Section } from "@/components/layout/Page";
import { ErrorState } from "@/components/ui/Feedback";
import { PanelCard } from "@/components/ui/PanelCard";
import { PANEL_ITEM, StatusPill } from "@/features/plans/PlanPanel";
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
 * Seit D8 als Glas-Karte im Stil 2.0 (`PanelCard`), Beträge je Abend als Pillen in Lime bzw. Gelb.
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
          <p className={cn("display shrink-0 text-[28px] leading-none sm:text-[34px]", total > 0 ? "text-lime" : total < 0 ? "text-amber" : "text-fg")}>
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
                  className={cn(PANEL_ITEM, "flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.08] focus-visible:bg-white/[0.08]")}
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
      </PanelCard>
      <p className="mt-2 text-[13px] leading-snug text-faint">{tx.hint}</p>
    </div>
  );
}
