import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { IconAward, IconCircleCheck, IconInfo } from "@/components/icons";
import { PageHeader, Section } from "@/components/layout/Page";
import { Button } from "@/components/ui/Button";
import { DemoBadge, EmptyState, ErrorState, ListSkeleton, Notice } from "@/components/ui/Feedback";
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

export function RewardsPage() {
  useDocumentTitle(t.rewards.title);
  const rewards = useRewards();
  const transactions = rewards.data ?? [];
  const points = totalPoints(transactions);
  const levelIndex = LEVEL_THRESHOLDS.reduce((index, threshold, i) => (points >= threshold ? i : index), 0);
  const nextThreshold = LEVEL_THRESHOLDS[levelIndex + 1];
  const currentThreshold = LEVEL_THRESHOLDS[levelIndex] ?? 0;
  const progress = nextThreshold ? (points - currentThreshold) / (nextThreshold - currentThreshold) : 1;

  const attended = transactions.filter((tx) => tx.reason === "plan_attended").length;
  const organized = transactions.filter((tx) => tx.reason === "plan_organized").length;
  const milestones = [
    { label: t.rewards.milestones.firstAttended, current: attended, target: 1 },
    { label: t.rewards.milestones.fiveAttended, current: attended, target: 5 },
    { label: t.rewards.milestones.firstOrganized, current: organized, target: 1 },
    { label: t.rewards.milestones.fiveOrganized, current: organized, target: 5 },
  ];

  return (
    <>
      <PageHeader title={t.rewards.title} lead={t.rewards.lead} />
      {rewards.isPending ? (
        <ListSkeleton rows={3} height="h-28" />
      ) : rewards.isError ? (
        <ErrorState error={rewards.error} onRetry={() => void rewards.refetch()} />
      ) : (
        <div className="grid gap-x-10 gap-y-9 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">
            <section className="rounded-card border border-line bg-surface p-5 sm:p-6" aria-labelledby="balance-label">
              <p id="balance-label" className="text-sm font-medium text-muted">
                {t.rewards.balanceLabel}
              </p>
              <p className="mt-1 flex items-baseline gap-3">
                <span className="font-display text-[84px] font-extrabold leading-[0.9] text-lime sm:text-[104px]">{formatNumber(points)}</span>
                <span className="text-lg font-semibold text-fg">{t.rewards.levels[levelIndex]}</span>
              </p>
              <div className="mt-5 h-2 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label={t.rewards.levels[levelIndex]}>
                <div className="h-full rounded-full bg-lime" style={{ width: `${Math.max(progress, 0.02) * 100}%` }} />
              </div>
              <p className="mt-2 text-sm text-muted">{nextThreshold ? t.rewards.nextLevel(nextThreshold - points, t.rewards.levels[levelIndex + 1] ?? "") : t.rewards.maxLevel}</p>
            </section>

            <Section title={t.rewards.historyTitle}>
              {transactions.length === 0 ? (
                <EmptyState icon={<IconAward aria-hidden />} title={t.rewards.historyEmpty.title} body={t.rewards.historyEmpty.body} />
              ) : (
                <ul className="divide-y divide-line rounded-card border border-line bg-surface">
                  {transactions.map((tx) => (
                    <li key={tx.id} className="flex items-center justify-between gap-4 px-4 py-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-fg">{t.rewards.reason[tx.reason]}</p>
                        <p className="text-[13px] text-muted">
                          {formatDateWithYear(tx.created_at)}
                          {tx.related_entity_id && (tx.reason === "plan_attended" || tx.reason === "plan_organized") && (
                            <>
                              {", "}
                              <Link to={`/plans/${tx.related_entity_id}`} className="underline underline-offset-2 hover:text-fg">
                                {t.rewards.showPlan}
                              </Link>
                            </>
                          )}
                        </p>
                      </div>
                      <span className={cn("font-display text-2xl font-extrabold", tx.points_delta > 0 ? "text-lime" : "text-danger")}>
                        {tx.points_delta > 0 ? "+" : ""}
                        {tx.points_delta}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title={t.rewards.partnersTitle}>
              <Notice tone="amber" icon={<IconInfo aria-hidden />} title={t.rewards.partnersNotice.title} className="mb-4">
                {t.rewards.partnersNotice.body}
              </Notice>
              <ul className="grid gap-3 sm:grid-cols-3">
                {t.rewards.partnerExamples.map((example) => (
                  <li key={example.title} className="flex flex-col rounded-card border border-dashed border-line-strong p-4 opacity-80">
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
            </Section>
          </div>

          <aside className="min-w-0 space-y-9">
            <Section title={t.rewards.rulesTitle}>
              <ul className="space-y-3">
                {t.rewards.rules.map((rule) => (
                  <li key={rule.title} className="flex gap-3.5 rounded-card border border-line bg-surface p-4">
                    <span className="font-display text-[34px] font-extrabold leading-none text-lime">+{rule.points}</span>
                    <span>
                      <span className="block font-semibold text-fg">{rule.title}</span>
                      <span className="mt-0.5 block text-[13px] leading-snug text-muted">{rule.body}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[13px] leading-snug text-faint">{t.rewards.rulesFine}</p>
            </Section>
            <Section title={t.rewards.milestonesTitle}>
              <ul className="space-y-2.5">
                {milestones.map((milestone) => {
                  const done = milestone.current >= milestone.target;
                  return (
                    <li key={milestone.label} className="flex items-center justify-between gap-3 text-[15px]">
                      <span className={cn("flex items-center gap-2.5", done ? "font-semibold text-fg" : "text-muted")}>
                        <IconCircleCheck className={cn("size-5 shrink-0", done ? "text-lime" : "text-line-strong")} aria-hidden />
                        {milestone.label}
                      </span>
                      <span className="shrink-0 text-[13px] text-muted">{done ? t.rewards.milestoneDone : t.rewards.milestoneProgress(milestone.current, milestone.target)}</span>
                    </li>
                  );
                })}
              </ul>
            </Section>
          </aside>
        </div>
      )}
    </>
  );
}
