import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { PosterTitle } from "@/components/layout/Page";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Feedback";
import { useToast } from "@/components/ui/Toast";
import { loadTexts, t } from "@/i18n";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { isFavoriteEvening } from "@/lib/favorites";
import { supabase } from "@/lib/supabase";

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
