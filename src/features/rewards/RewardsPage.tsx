import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { IconAward, IconCalendarCheck, IconCheck, IconCrown, IconEdit, IconInfo, IconSparkles } from "@/components/icons";
import { PageHeader } from "@/components/layout/Page";
import { Button } from "@/components/ui/Button";
import { DemoBadge, ErrorState, ListSkeleton, Notice } from "@/components/ui/Feedback";
import { PANEL_ITEM, PlanPanel, StatusPill } from "@/features/plans/PlanPanel";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { qk } from "@/lib/query";
import { supabase } from "@/lib/supabase";
import { formatDateWithYear } from "@/lib/time";
import type { RewardTransaction } from "@/lib/types";

const LEVEL_THRESHOLDS = [0, 50, 150, 300, 600];

export function useRewards() {
  return useQuery({
    queryKey: qk.rewards,
    queryFn: async (): Promise<RewardTransaction[]> => {
      const { data, error } = await supabase.from("reward_transactions").select("*").order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data as RewardTransaction[];
    },
  });
}

export const totalPoints = (transactions: RewardTransaction[] | undefined) => (transactions ?? []).reduce((sum, tx) => sum + tx.points_delta, 0);

/** Symbol je Grund im Verlauf – nur Bild, der Grund steht daneben als Text. */
const REASON_ICON: Record<RewardTransaction["reason"], ReactNode> = {
  plan_organized: <IconCrown className="size-5" />,
  plan_attended: <IconCalendarCheck className="size-5" />,
  partner_bonus: <IconSparkles className="size-5" />,
  admin_adjustment: <IconEdit className="size-5" />,
};

/**
 * V2 Etappe 3o · Rewards im Stil 2.0: Der Punktestand ist eine Karte oben auf dem Stapel (wie die Stammkarte
 * im Profil) mit der Zahl in Lime, der Stufe als Pille und den fünf Stufen als Leiter. Regeln, Meilensteine,
 * Verlauf und Prämien sind Glas-Karten aus dem Deck mit eigenem Farbschein (`PlanPanel`).
 * Daten und Regeln sind unverändert: Punkte gibt es weiterhin nur serverseitig beim Abschließen eines Plans.
 */
export function RewardsPage() {
  useDocumentTitle(t.rewards.title);
  const rewards = useRewards();
  const transactions = rewards.data ?? [];
  const points = totalPoints(transactions);
  const levelIndex = LEVEL_THRESHOLDS.reduce((index, threshold, i) => (points >= threshold ? i : index), 0);
  const nextThreshold = LEVEL_THRESHOLDS[levelIndex + 1];
  const currentThreshold = LEVEL_THRESHOLDS[levelIndex] ?? 0;
  const progress = nextThreshold ? Math.min(Math.max((points - currentThreshold) / (nextThreshold - currentThreshold), 0), 1) : 1;
  const level = t.rewards.levels[levelIndex] ?? "";
  const nextText = nextThreshold ? t.rewards.nextLevel(nextThreshold - points, t.rewards.levels[levelIndex + 1] ?? "") : t.rewards.maxLevel;

  const attended = transactions.filter((tx) => tx.reason === "plan_attended").length;
  const organized = transactions.filter((tx) => tx.reason === "plan_organized").length;
  const milestones = [
    { label: t.rewards.milestones.firstAttended, current: attended, target: 1 },
    { label: t.rewards.milestones.fiveAttended, current: attended, target: 5 },
    { label: t.rewards.milestones.firstOrganized, current: organized, target: 1 },
    { label: t.rewards.milestones.fiveOrganized, current: organized, target: 5 },
  ];
  const stats = [
    { label: t.rewards.stats.organized, value: organized },
    { label: t.rewards.stats.attended, value: attended },
  ];

  return (
    <div className="relative isolate">
      <div className="home-glow" aria-hidden />
      <PageHeader title={t.rewards.title} lead={t.rewards.lead} poster />
      {rewards.isPending ? (
        <ListSkeleton rows={3} height="h-28" />
      ) : rewards.isError ? (
        <ErrorState error={rewards.error} onRetry={() => void rewards.refetch()} />
      ) : (
        <div className="grid gap-x-8 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            <section aria-labelledby="balance-label" className="ticket-feature-wrap" data-testid="rewards-card">
              <div className="vote-card overflow-hidden rounded-[32px] p-5 sm:p-7">
                <span aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-lime/15 blur-3xl" />
                <span aria-hidden className="pointer-events-none absolute -bottom-24 -left-16 size-56 rounded-full bg-violet/25 blur-3xl" />
                <div className="relative">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p id="balance-label" className="text-[13px] font-semibold uppercase tracking-[0.12em] text-faint">
                      {t.rewards.balanceLabel}
                    </p>
                    <StatusPill tone={points > 0 ? "lime" : "glass"} testId="rewards-level">
                      <IconAward className="size-4" aria-hidden />
                      {level}
                    </StatusPill>
                  </div>
                  <p className="mt-3 flex flex-wrap items-baseline gap-x-3">
                    <span data-testid="rewards-points" className={cn("font-display text-[72px] font-extrabold leading-[0.85] sm:text-[92px]", points > 0 ? "text-lime" : "text-fg")}>
                      {formatNumber(points)}
                    </span>
                    <span className="text-[15px] font-bold uppercase tracking-wide text-muted">{t.rewards.pointsWord(points)}</span>
                  </p>

                  {/* Die fünf Stufen als Leiter: erreichte in Lime, die laufende füllt sich, kommende gestrichelt. */}
                  <div
                    className="mt-6 grid grid-cols-5 gap-1.5"
                    role="progressbar"
                    aria-label={t.rewards.ladderLabel(level)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(progress * 100)}
                    aria-valuetext={nextText}
                    data-testid="rewards-ladder"
                  >
                    {LEVEL_THRESHOLDS.map((threshold, i) => {
                      const state = i < levelIndex || (i === levelIndex && !nextThreshold) ? "done" : i === levelIndex ? "current" : "open";
                      return (
                        <div key={threshold} aria-hidden data-state={state} className="min-w-0" title={`${t.rewards.levels[i]} · ${t.rewards.cost(threshold)}`}>
                          <div className={cn("h-2.5 overflow-hidden rounded-full", state === "open" ? "border border-dashed border-white/25" : "bg-white/10")}>
                            {state !== "open" && <div className="h-full rounded-full bg-lime" style={{ width: state === "done" ? "100%" : `${Math.max(progress, 0.04) * 100}%` }} />}
                          </div>
                          <p className={cn("mt-1.5 truncate text-[11px] font-bold tabular-nums", state === "open" ? "text-faint" : "text-muted")}>{formatNumber(threshold)}</p>
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-sm text-muted" data-testid="rewards-next">
                    {nextText}
                  </p>

                  <dl className="mt-5 grid grid-cols-2 gap-2">
                    {stats.map((stat) => (
                      <div key={stat.label} className="flex min-w-0 flex-col-reverse rounded-[20px] border border-white/10 bg-white/[0.05] p-3">
                        <dt className="mt-1 truncate text-[13px] text-muted">{stat.label}</dt>
                        <dd className="font-display text-[24px] font-extrabold leading-none text-fg sm:text-[28px]">{formatNumber(stat.value)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            </section>

            <PlanPanel id="verlauf" title={t.rewards.historyTitle} icon={<IconAward className="size-5" />} tone="violet">
              {transactions.length === 0 ? (
                <div className={cn(PANEL_ITEM, "border-dashed p-5 text-center")} data-testid="rewards-empty">
                  <p className="font-semibold text-fg">{t.rewards.historyEmpty.title}</p>
                  <p className="mx-auto mt-1 max-w-prose text-sm leading-snug text-muted">{t.rewards.historyEmpty.body}</p>
                </div>
              ) : (
                <ul className="space-y-2" data-testid="rewards-history">
                  {transactions.map((tx) => (
                    <li key={tx.id} className={cn(PANEL_ITEM, "flex items-center gap-3 px-3 py-3 sm:px-4")} data-testid="rewards-entry">
                      <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full border border-white/15 bg-white/[0.06] text-fg">
                        {REASON_ICON[tx.reason]}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-fg">{t.rewards.reason[tx.reason]}</p>
                        <p className="text-[13px] text-muted">
                          {formatDateWithYear(tx.created_at)}
                          {tx.related_entity_id && (tx.reason === "plan_attended" || tx.reason === "plan_organized") && (
                            <>
                              {" · "}
                              <Link to={`/plans/${tx.related_entity_id}`} className="underline underline-offset-2 hover:text-fg">
                                {t.rewards.showPlan}
                              </Link>
                            </>
                          )}
                        </p>
                      </div>
                      <StatusPill tone={tx.points_delta > 0 ? "lime" : "danger"} className="tabular-nums" testId="rewards-entry-points">
                        {tx.points_delta > 0 ? "+" : ""}
                        {tx.points_delta}
                      </StatusPill>
                    </li>
                  ))}
                </ul>
              )}
            </PlanPanel>

            <PlanPanel id="praemien" title={t.rewards.partnersTitle} icon={<IconSparkles className="size-5" />} tone="pink">
              <Notice tone="amber" icon={<IconInfo aria-hidden />} title={t.rewards.partnersNotice.title} className="mb-4">
                {t.rewards.partnersNotice.body}
              </Notice>
              <ul className="grid gap-2 sm:grid-cols-3">
                {t.rewards.partnerExamples.map((example) => (
                  <li key={example.title} className={cn(PANEL_ITEM, "flex flex-col border-dashed p-4")} data-testid="rewards-partner-example">
                    <DemoBadge className="self-start" />
                    <p className="mt-3 font-semibold leading-snug text-fg">{example.title}</p>
                    <p className="mt-1 text-[13px] text-muted">{example.partner}</p>
                    <p className="mt-3 text-sm font-semibold text-muted">{t.rewards.cost(example.cost)}</p>
                    <Button variant="secondary" size="sm" disabled className="mt-3">
                      {t.rewards.redeem}
                    </Button>
                  </li>
                ))}
              </ul>
            </PlanPanel>
          </div>

          <aside className="min-w-0">
            <PlanPanel id="regeln" title={t.rewards.rulesTitle} icon={<IconCheck className="size-5" />} tone="lime">
              <ul className="space-y-2">
                {t.rewards.rules.map((rule) => (
                  <li key={rule.title} className={cn(PANEL_ITEM, "flex gap-3.5 p-3.5")}>
                    <span className="grid h-12 min-w-14 shrink-0 place-items-center rounded-[16px] bg-lime px-2 font-display text-[20px] font-extrabold leading-none text-lime-ink">+{rule.points}</span>
                    <span className="min-w-0">
                      <span className="block font-semibold text-fg">{rule.title}</span>
                      <span className="mt-0.5 block text-[13px] leading-snug text-muted">{rule.body}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[13px] leading-snug text-faint">{t.rewards.rulesFine}</p>
            </PlanPanel>

            <PlanPanel id="meilensteine" title={t.rewards.milestonesTitle} icon={<IconCrown className="size-5" />} tone="violet">
              <ul className="grid grid-cols-2 gap-2">
                {milestones.map((milestone) => {
                  const done = milestone.current >= milestone.target;
                  const share = Math.min(milestone.current / milestone.target, 1);
                  return (
                    <li
                      key={milestone.label}
                      data-testid="rewards-milestone"
                      data-done={done ? "true" : "false"}
                      className={cn("flex min-w-0 flex-col rounded-[20px] p-3.5", done ? "bg-lime text-lime-ink" : "border border-dashed border-white/20 bg-white/[0.03] text-fg")}
                    >
                      <span aria-hidden className={cn("grid size-8 place-items-center rounded-full", done ? "bg-lime-ink text-lime" : "border border-white/20 text-faint")}>
                        <IconCheck className="size-4" />
                      </span>
                      <span className="mt-2.5 text-[14px] font-bold leading-snug">{milestone.label}</span>
                      {done ? (
                        <span className="mt-auto pt-1.5 text-[13px] font-semibold">{t.rewards.milestoneDone}</span>
                      ) : (
                        <span className="mt-auto pt-1.5">
                          <span aria-hidden className="block h-1.5 overflow-hidden rounded-full bg-white/10">
                            <span className="block h-full rounded-full bg-lime" style={{ width: `${share * 100}%` }} />
                          </span>
                          <span className="mt-1 block text-[13px] text-muted">{t.rewards.milestoneProgress(milestone.current, milestone.target)}</span>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </PlanPanel>
          </aside>
        </div>
      )}
    </div>
  );
}
