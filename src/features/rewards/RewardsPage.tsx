import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { IconAward, IconCircleCheck, IconInfo, IconRewards, IconSparkles } from "@/components/icons";
import { PageHeader } from "@/components/layout/Page";
import { Button } from "@/components/ui/Button";
import { DemoBadge, EmptyState, ErrorState, ListSkeleton, Notice } from "@/components/ui/Feedback";
import { PanelCard } from "@/components/ui/PanelCard";
import { PANEL_ITEM, StatusPill } from "@/features/plans/PlanPanel";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { qk } from "@/lib/query";
import { supabase } from "@/lib/supabase";
import { formatDateWithYear } from "@/lib/time";
import type { RewardTransaction } from "@/lib/types";
import "@/styles/motion.css";

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

  const doneMilestones = milestones.filter((milestone) => milestone.current >= milestone.target).length;

  return (
    <>
      <PageHeader title={t.rewards.title} lead={t.rewards.lead} />
      {rewards.isPending ? (
        <ListSkeleton rows={3} height="h-28" />
      ) : rewards.isError ? (
        <ErrorState error={rewards.error} onRetry={() => void rewards.refetch()} />
      ) : (
        <div className="grid gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-6">
            <BalanceCard points={points} levelIndex={levelIndex} progress={progress} nextThreshold={nextThreshold} />

            <PanelCard
              id="rewards-history"
              title={t.rewards.historyTitle}
              icon={<IconRewards />}
              tone="lime"
              status={transactions.length > 0 ? <StatusPill>{t.rewards.historyCount(transactions.length)}</StatusPill> : undefined}
            >
              {transactions.length === 0 ? (
                <EmptyState art={<IconAward aria-hidden />} title={t.rewards.historyEmpty.title} body={t.rewards.historyEmpty.body} />
              ) : (
                <ul className="space-y-2" data-testid="rewards-history">
                  {transactions.map((tx) => (
                    <li key={tx.id} className={cn(PANEL_ITEM, "flex items-center justify-between gap-4 px-4 py-3")}>
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
                      <StatusPill tone={tx.points_delta > 0 ? "lime" : "danger"} className="h-9 px-3.5 font-display text-[15px] font-extrabold">
                        {tx.points_delta > 0 ? "+" : ""}
                        {tx.points_delta}
                      </StatusPill>
                    </li>
                  ))}
                </ul>
              )}
            </PanelCard>

            <PanelCard id="rewards-partners" title={t.rewards.partnersTitle} icon={<IconSparkles />} tone="pink" status={<StatusPill tone="amber">{t.rewards.partnersStatus}</StatusPill>}>
              <Notice tone="amber" icon={<IconInfo aria-hidden />} title={t.rewards.partnersNotice.title} className="mb-4 rounded-[20px] bg-amber/[0.07]">
                {t.rewards.partnersNotice.body}
              </Notice>
              <ul className="grid gap-3 sm:grid-cols-3">
                {t.rewards.partnerExamples.map((example) => (
                  <li key={example.title} className="flex flex-col rounded-[20px] border border-dashed border-white/20 bg-white/[0.03] p-4">
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
            </PanelCard>
          </div>

          <aside className="min-w-0 space-y-6">
            <PanelCard id="rewards-rules" title={t.rewards.rulesTitle} icon={<IconAward />} tone="violet">
              <ul className="space-y-2">
                {t.rewards.rules.map((rule) => (
                  <li key={rule.title} className={cn(PANEL_ITEM, "flex items-center gap-3.5 p-3.5")}>
                    <span className="grid size-14 shrink-0 place-items-center rounded-[18px] bg-lime font-display text-[19px] font-extrabold text-lime-ink">+{rule.points}</span>
                    <span className="min-w-0">
                      <span className="block font-semibold text-fg">{rule.title}</span>
                      <span className="mt-0.5 block text-[13px] leading-snug text-muted">{rule.body}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[13px] leading-snug text-faint">{t.rewards.rulesFine}</p>
            </PanelCard>

            <PanelCard
              id="rewards-milestones"
              title={t.rewards.milestonesTitle}
              icon={<IconCircleCheck />}
              tone="pink"
              status={<StatusPill tone={doneMilestones > 0 ? "lime" : "glass"}>{t.rewards.milestonesCount(doneMilestones, milestones.length)}</StatusPill>}
            >
              <ul className="grid grid-cols-2 gap-2" data-testid="rewards-milestones">
                {milestones.map((milestone) => {
                  const done = milestone.current >= milestone.target;
                  const share = Math.min(milestone.current / milestone.target, 1);
                  return (
                    <li
                      key={milestone.label}
                      data-done={done ? "true" : "false"}
                      className={cn("flex min-w-0 flex-col rounded-[20px] p-3.5", done ? "bg-lime text-lime-ink" : "border border-dashed border-white/20 bg-white/[0.03] text-fg")}
                    >
                      <IconCircleCheck className={cn("size-6", done ? "text-lime-ink" : "text-line-strong")} aria-hidden />
                      <span className="mt-2 text-[14px] font-bold leading-snug">{milestone.label}</span>
                      <span className={cn("mt-auto pt-2 text-[13px] font-semibold", done ? "text-lime-ink/80" : "text-muted")}>
                        {done ? t.rewards.milestoneDone : t.rewards.milestoneProgress(milestone.current, milestone.target)}
                      </span>
                      {!done && (
                        <span aria-hidden className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                          <span className="bar-grow block h-full rounded-full bg-lime" style={{ width: `${Math.max(share, 0.04) * 100}%` }} />
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </PanelCard>
          </aside>
        </div>
      )}
    </>
  );
}

/**
 * V2 Etappe 3o · Punktestand als Karte oben auf dem Stapel (wie die Stammkarte im Profil): Zahl in Chrom,
 * Stufe als Lime-Pille, Fortschritt als leuchtender Balken und darunter alle Stufen als Leiter – erreichte
 * in Lime, die eigene hervorgehoben, kommende gestrichelt. Ohne Punkte bleibt alles ruhig (keine falsche Feier).
 */
function BalanceCard({ points, levelIndex, progress, nextThreshold }: { points: number; levelIndex: number; progress: number; nextThreshold: number | undefined }) {
  const level = t.rewards.levels[levelIndex] ?? "";
  return (
    <section aria-labelledby="balance-label" className="ticket-feature-wrap" data-testid="rewards-balance">
      <div className="vote-card overflow-hidden rounded-[32px] p-5 sm:p-7">
        <span aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-lime/15 blur-3xl" />
        <span aria-hidden className="pointer-events-none absolute -bottom-24 -left-16 size-56 rounded-full bg-pink/20 blur-3xl" />
        <div className="relative">
          <p id="balance-label" className="text-[13px] font-semibold uppercase tracking-[0.12em] text-faint">
            {t.rewards.balanceLabel}
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-3">
            <p className="display chrome text-[64px] leading-[0.9] sm:text-[84px]" data-testid="rewards-points">
              {formatNumber(points)}
            </p>
            <StatusPill tone={points > 0 ? "lime" : "glass"} className="mb-2 h-9 px-3.5 text-[14px]" testId="rewards-level">
              <IconAward className="size-4" aria-hidden />
              {level}
            </StatusPill>
          </div>
          <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label={level}>
            <div className="bar-grow h-full rounded-full bg-lime shadow-[0_0_18px_var(--color-lime)]" style={{ width: `${Math.max(progress, 0.02) * 100}%` }} />
          </div>
          <p className="mt-2 text-sm text-muted">{nextThreshold ? t.rewards.nextLevel(nextThreshold - points, t.rewards.levels[levelIndex + 1] ?? "") : t.rewards.maxLevel}</p>
          <ol aria-label={t.rewards.levelsLabel} lang="de" className="mt-5 grid grid-cols-5 gap-1.5" data-testid="rewards-levels">
            {t.rewards.levels.map((name, index) => {
              const reached = index <= levelIndex && points > 0;
              const current = index === levelIndex;
              return (
                <li
                  key={name}
                  data-reached={reached ? "true" : "false"}
                  aria-current={current ? "step" : undefined}
                  className={cn(
                    "flex min-w-0 flex-col rounded-[14px] px-1.5 py-2 text-center",
                    reached ? "bg-lime text-lime-ink" : "border border-dashed border-white/20 text-muted",
                    current && "ring-2 ring-lime ring-offset-2 ring-offset-surface",
                  )}
                >
                  <span className="font-display text-[13px] font-extrabold leading-none">{index + 1}</span>
                  {/* Auf dem Handy reicht der Platz nicht für „Organisationstalent“: Name nur für Screenreader, die eigene Stufe steht in der Pille. */}
                  <span className="sr-only text-[11px] font-bold leading-tight sm:not-sr-only sm:mt-1 sm:break-words sm:hyphens-auto">{name}</span>
                  <span className={cn("mt-1 text-[11px] font-semibold", reached ? "text-lime-ink" : "text-muted")}>{t.rewards.levelFrom(LEVEL_THRESHOLDS[index] ?? 0)}</span>
                  <span className="sr-only">{current ? `, ${t.rewards.levelCurrent}` : reached ? `, ${t.rewards.levelReached}` : ""}</span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
