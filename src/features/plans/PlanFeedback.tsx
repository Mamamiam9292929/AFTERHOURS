import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { IconCalendarCheck } from "@/components/icons";
import { PosterTitle } from "@/components/layout/Page";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { PanelCard } from "@/components/ui/PanelCard";
import { Skeleton } from "@/components/ui/Feedback";
import { useToast } from "@/components/ui/Toast";
import { loadTexts, t } from "@/i18n";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { isFavoriteEvening } from "@/lib/favorites";
import { supabase } from "@/lib/supabase";
import { formatDateLong } from "@/lib/time";
import { useClosePlan } from "./api";

// F7: Texte von „Wie war’s?“ liegen nicht im Start-Bundle – sie laden erst mit der Karte auf einem abgeschlossenen Plan.
await loadTexts("planFeedback");

export type Verdict = "again" | "ok" | "meh";

export interface PlanFeedbackSummary {
  again: number;
  ok: number;
  meh: number;
  mine: Verdict | null;
  open: boolean;
  can_answer: boolean;
}

const VERDICTS: Verdict[] = ["again", "ok", "meh"];
/** Wie die Antwort beim Plan: grün „Nochmal!“, gelb „War okay“, rot „Eher nicht“ (`.vote-card[data-answer]`). */
const CARD_ANSWER: Record<Verdict, "yes" | "maybe" | "no"> = { again: "yes", ok: "maybe", meh: "no" };

const feedbackKey = (planId: string) => ["plan-feedback", planId] as const;

function usePlanFeedback(planId: string) {
  return useQuery({
    queryKey: feedbackKey(planId),
    queryFn: async (): Promise<PlanFeedbackSummary> => {
      const { data, error } = await supabase.rpc("plan_feedback_summary", { p_plan_id: planId });
      if (error) throw error;
      return data as PlanFeedbackSummary;
    },
  });
}

function useSetPlanFeedback(planId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (verdict: Verdict | null) => {
      const { error } = await supabase.rpc("set_plan_feedback", { p_plan_id: planId, p_verdict: verdict });
      if (error) throw error;
    },
    // Sofort zeigen, was angetippt wurde – bei einem Fehler stellt das Neuladen den echten Stand wieder her.
    onMutate: (verdict) => {
      client.setQueryData<PlanFeedbackSummary>(feedbackKey(planId), (old) => (old ? applyVerdict(old, verdict) : old));
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: feedbackKey(planId) });
      // P29 Etappe 2: Das Urteil kann einen Abend zum Lieblingsabend machen (oder nicht mehr).
      void client.invalidateQueries({ queryKey: ["crew-favorite-evenings"] });
    },
  });
}

/** Zahlen nach dem eigenen Tipp, ohne auf den Server zu warten (eigene alte Antwort raus, neue rein). */
export function applyVerdict(summary: PlanFeedbackSummary, verdict: Verdict | null): PlanFeedbackSummary {
  const next = { ...summary, mine: verdict };
  if (summary.mine) next[summary.mine] = Math.max(0, next[summary.mine] - 1);
  if (verdict) next[verdict] += 1;
  return next;
}

/**
 * P29 · „Wie war’s?“ auf einem abgeschlossenen Plan. Wer dabei war, sagt mit einem Tipp „Nochmal!“, „War okay“
 * oder „Eher nicht“; die Karte füllt sich dann in dieser Farbe (wie die Antwort beim Plan). Die Crew sieht nur die
 * Zahlen – wer was gesagt hat, bleibt auf dem Server. Wer nicht dabei war, sieht nur die Zahlen und nichts, solange
 * niemand geantwortet hat.
 */
export function PlanFeedbackCard({ planId }: { planId: string }) {
  const toast = useToast();
  const summary = usePlanFeedback(planId);
  const setVerdict = useSetPlanFeedback(planId);
  const copy = t.planFeedback;
  const loaded = summary.isSuccess;

  // P29 Etappe 3: Die Erinnerung am Morgen danach führt hierher (`#wie-wars`) – erst springen, wenn die Karte steht.
  useEffect(() => {
    if (loaded && window.location.hash === "#wie-wars") document.getElementById("wie-wars")?.scrollIntoView({ block: "start" });
  }, [loaded]);

  if (summary.isPending) {
    return (
      <div className="mt-4" data-testid="plan-feedback-loading">
        <Skeleton className="h-36 rounded-[28px]" />
      </div>
    );
  }
  if (summary.isError) {
    return (
      <div role="alert" data-testid="plan-feedback-error" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[28px] border border-danger/35 bg-danger/5 px-4 py-3.5 text-sm">
        <span className="min-w-0 text-muted">
          <span className="block font-semibold text-fg">{copy.error}</span>
          {errorMessage(summary.error)}
        </span>
        <Button size="sm" variant="secondary" onClick={() => void summary.refetch()}>
          {copy.retry}
        </Button>
      </div>
    );
  }

  const data = summary.data;
  const total = data.again + data.ok + data.meh;
  if (!data.can_answer && total === 0) return null;

  const mine = data.mine;
  const lead = data.can_answer ? (mine ? copy.leadDone : copy.lead) : data.open ? copy.leadOthers : copy.leadClosed;

  function choose(verdict: Verdict) {
    if (verdict === mine || setVerdict.isPending) return;
    setVerdict.mutate(verdict, { onSuccess: () => toast.success(copy.saved[verdict]), onError: (error) => toast.error(error) });
  }

  return (
    <section
      id="wie-wars"
      aria-labelledby="plan-feedback-title"
      data-testid="plan-feedback"
      data-answer={mine ? CARD_ANSWER[mine] : undefined}
      className={cn("vote-card answer-card mt-4 scroll-mt-24 p-4 sm:p-5", !mine && data.can_answer && "answer-open")}
    >
      <h2 id="plan-feedback-title" className={cn("display text-[22px] uppercase sm:text-[26px]", mine ? "text-fg" : "chrome")}>
        <PosterTitle text={copy.title} />
      </h2>
      <p className="mt-1.5 max-w-prose text-sm leading-snug text-muted">{lead}</p>

      {data.can_answer && (
        <div role="radiogroup" aria-label={copy.label} className="mt-4 grid grid-cols-3 gap-2">
          {VERDICTS.map((verdict) => (
            <button
              key={verdict}
              type="button"
              role="radio"
              aria-checked={mine === verdict}
              data-response={CARD_ANSWER[verdict]}
              data-testid={`plan-feedback-${verdict}`}
              disabled={setVerdict.isPending}
              onClick={() => choose(verdict)}
              className="vote-pill"
            >
              {copy[verdict]}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2" aria-label={copy.tallyLabel} role="group" data-testid="plan-feedback-tally">
        {total === 0 ? (
          <span className="text-[13px] text-faint">{copy.none}</span>
        ) : (
          VERDICTS.filter((verdict) => data[verdict] > 0).map((verdict) => (
            <span
              key={verdict}
              data-verdict={verdict}
              className="inline-flex h-8 items-center rounded-full border border-line-strong bg-surface px-3 text-[13px] font-bold whitespace-nowrap text-fg"
            >
              {copy.tally[verdict](data[verdict])}
            </span>
          ))
        )}
      </div>

      {data.can_answer && mine && (
        <button
          type="button"
          data-testid="plan-feedback-undo"
          disabled={setVerdict.isPending}
          onClick={() => setVerdict.mutate(null, { onSuccess: () => toast.success(copy.removed), onError: (error) => toast.error(error) })}
          className="mt-3 inline-flex min-h-11 items-center text-[13px] font-semibold text-muted underline decoration-line-strong underline-offset-4 hover:text-fg"
        >
          {copy.undo}
        </button>
      )}
      {!data.open && <p className="mt-2.5 text-[13px] text-muted">{copy.closedNote}</p>}
    </section>
  );
}

/**
 * P29 Etappe 2 · Auf „Nochmal?“ (P17): Ist der Abend ein Lieblingsabend (mind. zwei und mehr als die Hälfte „Nochmal!“),
 * steht dort „3 wollen nochmal“ als Lime-Pille – der Anstoß für die nächste Runde. Gleiche Abfrage wie die Karte darüber
 * (wird nur einmal geladen); sonst, beim Laden oder bei einem Fehler nichts.
 */
export function PlanFeedbackAgainPill({ planId }: { planId: string }) {
  const summary = usePlanFeedback(planId);
  if (!summary.data || !isFavoriteEvening(summary.data)) return null;
  return (
    <span
      data-testid="plan-again-favorite"
      className="inline-flex h-8 items-center rounded-full bg-lime px-3 text-[13px] font-bold whitespace-nowrap text-lime-ink shadow-[0_0_14px_color-mix(in_srgb,var(--color-lime)_45%,transparent)]"
    >
      {t.planFeedback.againPill(summary.data.again)}
    </span>
  );
}

/**
 * P30 · „Fand der Abend statt?“ – oben auf der Planseite für Organisator:in, Owner und Admins, sobald der Abend vorbei
 * ist (`closePromptDue`). „Ja, abschließen“ schließt mit einem Tipp ab – danach steht hier „Wie war’s?“ und alle mit
 * Zusage werden gefragt. „Hat nicht stattgefunden“ sagt nach einer Rückfrage still ab (ohne Nachricht an alle).
 * Die Erinnerung am Morgen danach führt hierher (`#abschliessen`).
 */
export function PlanCloseCard({ planId }: { planId: string }) {
  const copy = t.planFeedback.close;

  useEffect(() => {
    if (window.location.hash === "#abschliessen") document.getElementById("abschliessen")?.scrollIntoView({ block: "start" });
  }, []);

  return (
    <section id="abschliessen" aria-labelledby="plan-close-title" data-testid="plan-close" className="vote-card answer-card answer-open mt-5 max-w-3xl scroll-mt-24 p-4 sm:p-5">
      <h2 id="plan-close-title" className="display chrome text-[22px] uppercase sm:text-[26px]">
        <PosterTitle text={copy.title} />
      </h2>
      <p className="mt-1.5 max-w-prose text-sm leading-snug text-muted">{copy.lead}</p>
      <CloseActions planId={planId} className="mt-4" />
    </section>
  );
}

/**
 * P30 · „Ja, abschließen“ (ein Tipp) und „Hat nicht stattgefunden“ (nach Rückfrage still absagen) – auf der Planseite
 * und je Abend in „Fand’s statt?“ auf Home. Fehler kommen als Meldung; der Plan bleibt dann offen.
 */
function CloseActions({ planId, className }: { planId: string; className?: string }) {
  const toast = useToast();
  const close = useClosePlan(planId);
  const copy = t.planFeedback.close;
  const [asking, setAsking] = useState(false);

  function happened() {
    if (close.isPending) return;
    close.mutate(true, { onSuccess: () => toast.success(copy.done), onError: (error) => toast.error(error) });
  }

  return (
    <div className={cn("flex flex-wrap gap-2.5", className)}>
      <Button onClick={happened} loading={close.isPending && !asking} disabled={close.isPending} icon={<IconCalendarCheck className="size-4" aria-hidden />} data-testid="plan-close-happened">
        {copy.happened}
      </Button>
      <Button variant="secondary" onClick={() => setAsking(true)} disabled={close.isPending} data-testid="plan-close-skipped">
        {copy.skipped}
      </Button>
      <ConfirmDialog
        open={asking}
        onClose={() => setAsking(false)}
        title={copy.skipTitle}
        description={copy.skipBody}
        confirmLabel={copy.skipConfirm}
        destructive
        loading={close.isPending}
        error={close.isError && asking ? errorMessage(close.error) : null}
        onConfirm={() =>
          close.mutate(false, {
            onSuccess: () => {
              setAsking(false);
              toast.success(copy.skippedDone);
            },
          })
        }
      />
    </div>
  );
}

/** Ein offener Abend für „Fand’s statt?“ auf Home – nur, was die Zeile zeigt. */
export interface HomeClosePlan {
  id: string;
  title: string;
  starts_at: string;
  crewName?: string;
  going: number;
}

/**
 * P30 Etappe 2 · „Fand’s statt?“ auf Home: vergangene, offene Abende, die du abschließen darfst (`plansToClose` in
 * `src/lib/closing.ts`), höchstens drei, der jüngste zuerst – je mit denselben zwei Knöpfen wie auf der Planseite.
 * Abgeschlossene oder abgesagte Abende fallen nach dem Neuladen der Pläne von selbst heraus. „Heute ausblenden“ gilt
 * nur auf diesem Gerät bis morgen. Liegt im Chunk von „Wie war’s?“ (Texte `planFeedback`), lädt also erst, wenn
 * überhaupt ein Abend offen ist.
 */
export function HomeCloseCard({ plans, more, onHide }: { plans: readonly HomeClosePlan[]; more: number; onHide: () => void }) {
  const toast = useToast();
  const copy = t.planFeedback.close.home;
  return (
    <div className="mt-9 first:mt-0">
      <PanelCard
        id="fands-statt"
        title={copy.title}
        icon={<IconCalendarCheck />}
        tone="lime"
        lead={copy.lead}
        testId="home-close"
        status={
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onHide();
              toast.success(copy.hidden);
            }}
            data-testid="home-close-hide"
          >
            {copy.hide}
          </Button>
        }
      >
        <ul className="grid gap-3">
          {plans.map((plan) => (
            <li key={plan.id} data-testid="home-close-plan" className="rounded-[20px] border border-white/[0.08] bg-white/[0.03] p-3.5">
              <Link to={`/plans/${plan.id}#abschliessen`} aria-label={copy.open(plan.title)} className="group block min-w-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime">
                <span className="block break-words font-semibold text-fg group-hover:underline">{plan.title}</span>
                <span className="mt-0.5 block text-[13px] text-muted">
                  {[formatDateLong(plan.starts_at), plan.crewName, plan.going > 0 ? copy.going(plan.going) : null].filter(Boolean).join(" · ")}
                </span>
              </Link>
              <CloseActions planId={plan.id} className="mt-3" />
            </li>
          ))}
        </ul>
        {more > 0 && (
          <Link to="/plans" className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-lime hover:underline" data-testid="home-close-more">
            {copy.more(more)}
          </Link>
        )}
      </PanelCard>
    </div>
  );
}
