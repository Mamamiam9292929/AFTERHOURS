import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconHome } from "@/components/icons";
import { PosterTitle } from "@/components/layout/Page";
import { Avatar, type Person } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Feedback";
import { useToast } from "@/components/ui/Toast";
import { loadTexts, t } from "@/i18n";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { homeOrder } from "@/lib/homecheck";
import { supabase } from "@/lib/supabase";
import { formatTime } from "@/lib/time";

// F7: Texte von „Gut heimgekommen?“ laden erst mit der Karte – also nur rund um einen Abend.
await loadTexts("planHome");

export interface PlanHomeStatus {
  open: boolean;
  can_answer: boolean;
  mine: string | null;
  home: { user_id: string; arrived_at: string }[];
  missing: number;
}

const homeKey = (planId: string) => ["plan-home", planId] as const;

function usePlanHome(planId: string) {
  return useQuery({
    queryKey: homeKey(planId),
    queryFn: async (): Promise<PlanHomeStatus> => {
      const { data, error } = await supabase.rpc("plan_home_status", { p_plan_id: planId });
      if (error) throw error;
      return data as PlanHomeStatus;
    },
    // Nachts kommen die Meldungen nacheinander – beim Draufschauen soll der Stand frisch sein.
    refetchInterval: 60_000,
  });
}

function useSetPlanHome(planId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (home: boolean) => {
      const { error } = await supabase.rpc("set_plan_home", { p_plan_id: planId, p_home: home });
      if (error) throw error;
    },
    onSettled: () => void client.invalidateQueries({ queryKey: homeKey(planId) }),
  });
}

/**
 * P31 · „Gut heimgekommen?“ auf der Planseite – ab Beginn bis 12 Stunden nach dem Ende (`homeCheckOpen`). Wer beim
 * Plan „Bin dabei“ oder „Vielleicht“ gesagt hat, tippt „Bin zuhause“; die Karte füllt sich dann grün. Die Crew sieht,
 * wer schon zuhause ist (mit Uhrzeit), und nur als Zahl, wie viele sich noch nicht gemeldet haben – niemand wird mit
 * Namen als „fehlt“ vorgeführt. Kein Standort, keine Benachrichtigung, kein Alarm – und das steht auch so auf der Karte.
 */
export function PlanHomeCard({
  planId,
  userId,
  lookup,
  kicker,
  aside,
}: {
  planId: string;
  userId: string;
  lookup: (id: string | null | undefined) => Person | null;
  /** Home: welcher Abend (Titel als Link zur Planseite) – auf der Planseite steht das schon darüber. */
  kicker?: ReactNode;
  /** Home: „Ausblenden“ rechts neben der Überschrift. */
  aside?: ReactNode;
}) {
  const toast = useToast();
  const status = usePlanHome(planId);
  const setHome = useSetPlanHome(planId);
  const copy = t.planHome;

  if (status.isPending) {
    return (
      <div className="mt-4" data-testid="plan-home-loading">
        <Skeleton className="h-36 rounded-[28px]" />
      </div>
    );
  }
  if (status.isError) {
    return (
      <div role="alert" data-testid="plan-home-error" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[28px] border border-danger/35 bg-danger/5 px-4 py-3.5 text-sm">
        <span className="min-w-0 text-muted">
          <span className="block font-semibold text-fg">{copy.error}</span>
          {errorMessage(status.error)}
        </span>
        <Button size="sm" variant="secondary" onClick={() => void status.refetch()}>
          {copy.retry}
        </Button>
      </div>
    );
  }

  const data = status.data;
  if (!data.open || (!data.can_answer && data.home.length === 0)) return null;
  const mine = data.mine;
  const lead = data.can_answer ? (mine ? copy.leadDone(formatTime(mine)) : copy.lead) : copy.leadOthers;
  const home = homeOrder(data.home, userId);

  function report(next: boolean) {
    if (setHome.isPending) return;
    setHome.mutate(next, { onSuccess: () => toast.success(next ? copy.saved : copy.removed), onError: (error) => toast.error(error) });
  }

  return (
    <section
      id="heimgekommen"
      aria-labelledby="plan-home-title"
      data-testid="plan-home"
      data-answer={mine ? "yes" : undefined}
      className={cn("vote-card answer-card mt-4 scroll-mt-24 p-4 sm:p-5", !mine && data.can_answer && "answer-open")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {kicker}
          <h2 id="plan-home-title" className={cn("display text-[22px] uppercase sm:text-[26px]", mine ? "text-fg" : "chrome")}>
            <PosterTitle text={copy.title} />
          </h2>
        </div>
        {aside}
      </div>
      <p className="mt-1.5 max-w-prose text-sm leading-snug text-muted" data-testid="plan-home-lead">
        {lead}
      </p>

      {data.can_answer && !mine && (
        <Button className="mt-4" onClick={() => report(true)} loading={setHome.isPending} icon={<IconHome className="size-4" aria-hidden />} data-testid="plan-home-report">
          {copy.action}
        </Button>
      )}

      <div className="mt-4" role="group" aria-label={copy.listLabel} data-testid="plan-home-list">
        {home.length === 0 ? (
          <p className="text-[13px] text-muted">{copy.none}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {home.map((entry) => {
              const person = lookup(entry.user_id);
              const name = entry.user_id === userId ? t.states.you : (person?.display_name ?? t.states.formerMember);
              return (
                <li key={entry.user_id} data-testid="plan-home-person" className="who-chip inline-flex h-9 max-w-full items-center gap-2 rounded-full py-0.5 pl-1 pr-3 text-sm font-semibold text-fg">
                  <Avatar person={person} size="xs" decorative />
                  <span className="min-w-0 truncate">{copy.person(name, formatTime(entry.arrived_at))}</span>
                </li>
              );
            })}
          </ul>
        )}
        {(data.missing > 0 || home.length > 0) && (
          <p className="mt-2.5 text-[13px] text-muted" data-testid="plan-home-missing">
            {data.missing > 0 ? copy.missing(data.missing) : copy.allHome}
          </p>
        )}
      </div>

      {data.can_answer && mine && (
        <button
          type="button"
          data-testid="plan-home-undo"
          disabled={setHome.isPending}
          onClick={() => report(false)}
          className="mt-1 inline-flex min-h-11 items-center text-[13px] font-semibold text-muted underline decoration-line-strong underline-offset-4 hover:text-fg"
        >
          {copy.undo}
        </button>
      )}
      <p className="mt-2 text-[13px] leading-snug text-muted" data-testid="plan-home-honest">
        {copy.honest}
      </p>
    </section>
  );
}

/**
 * P31 Etappe 2 · „Gut heimgekommen?“ auf Home – wer nach dem Abend die App öffnet, meldet sich gleich hier, ohne erst
 * die Planseite zu suchen. Welcher Abend und ab wann, entscheidet `planForHomeCheck` (src/lib/homecheck.ts): nur mit
 * eigener Zusage, ab zwei Stunden vor dem Ende bis zum Vormittag. „Ausblenden“ gilt für diesen Abend auf diesem Gerät;
 * auf der Planseite bleibt die Karte.
 */
export function HomePlanHomeCard({
  plan,
  crewName,
  userId,
  lookup,
  onHide,
}: {
  plan: { id: string; title: string };
  crewName?: string;
  userId: string;
  lookup: (id: string | null | undefined) => Person | null;
  onHide: () => void;
}) {
  const toast = useToast();
  const copy = t.planHome.home;
  return (
    <div className="mt-7 max-w-2xl [&>*:first-child]:mt-0" data-testid="home-plan-home">
      <PlanHomeCard
        planId={plan.id}
        userId={userId}
        lookup={lookup}
        kicker={
          <Link
            to={`/plans/${plan.id}#heimgekommen`}
            aria-label={copy.open(plan.title)}
            data-testid="home-plan-home-link"
            className="mb-1 inline-flex min-h-11 max-w-full items-center text-[13px] font-semibold text-muted hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime"
          >
            <span className="truncate">{[plan.title, crewName].filter(Boolean).join(" · ")}</span>
          </Link>
        }
        aside={
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0"
            data-testid="home-plan-home-hide"
            onClick={() => {
              onHide();
              toast.success(copy.hidden);
            }}
          >
            {copy.hide}
          </Button>
        }
      />
    </div>
  );
}
