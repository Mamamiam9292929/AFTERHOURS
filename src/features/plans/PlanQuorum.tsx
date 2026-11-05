import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IconCheck, IconCrews } from "@/components/icons";
import { useToast } from "@/components/ui/Toast";
import { loadTexts, t } from "@/i18n";
import { cn } from "@/lib/cn";
import { qk } from "@/lib/query";
import { supabase } from "@/lib/supabase";
import type { PlanWithParticipants } from "./api";
import { StatusPill } from "./PlanPanel";

// F7: Texte der Mindestzahl liegen nicht im Start-Bundle – sie laden erst, wenn ein Plan eine hat oder jemand sie einstellt.
await loadTexts("planQuorum");

/** Zur Wahl stehende Mindestzahlen; eine gespeicherte andere Zahl (2–50) wird ergänzt. */
const OPTIONS = [2, 3, 4, 5, 6, 8, 10];

/** P25: Zusagen wie bei „Wer kommt mit?“ – Mitglieder und Gäste mit „Bin dabei“. */
export function goingCount(plan: Pick<PlanWithParticipants, "participants" | "guests">): number {
  return plan.participants.filter((p) => p.attendance_status === "going").length + (plan.guests ?? []).filter((g) => g.attendance_status === "going").length;
}

function useSetPlanMinGoing(planId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (min: number | null): Promise<number> => {
      const { data, error } = await supabase.rpc("set_plan_min_going", { p_plan_id: planId, p_min: min });
      if (error) throw error;
      return data as number;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.plan(planId) });
      void client.invalidateQueries({ queryKey: qk.plans });
    },
  });
}

/**
 * P25 · „Findet statt ab 4“ unter „Wer kommt mit?“ – für alle in der Crew: wie viele zugesagt haben, wie viele
 * noch fehlen, als Balken in Lime. Ist die Zahl erreicht, steht „Findet statt“ als Lime-Pille da.
 */
export function QuorumMeter({ plan }: { plan: PlanWithParticipants }) {
  const min = plan.min_going ?? null;
  if (min == null) return null;
  const going = goingCount(plan);
  const reached = going >= min;
  const texts = t.planQuorum.meter;
  return (
    <div data-testid="plan-quorum" data-reached={reached ? "true" : "false"} className="mb-3 rounded-card border border-white/10 bg-white/[0.04] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-fg">{texts.title(min)}</p>
        <StatusPill tone={reached ? "lime" : "amber"} testId="plan-quorum-status">
          {reached && <IconCheck className="size-3.5" aria-hidden />}
          {reached ? texts.reached : texts.missing(min - going)}
        </StatusPill>
      </div>
      <div
        className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={min}
        aria-valuenow={Math.min(going, min)}
        aria-label={texts.progress(going, min)}
      >
        <div className={cn("bar-grow h-full rounded-full bg-lime", reached && "shadow-[0_0_18px_var(--color-lime)]")} style={{ width: `${Math.max(Math.min(going / min, 1), 0.04) * 100}%` }} />
      </div>
      <p className="mt-1.5 text-[13px] text-muted">{texts.count(going, min)}</p>
    </div>
  );
}

/**
 * P25 · Mindestzahl einstellen (Organisator:in, Owner, Admins; nur vor Beginn). Ein Tipp speichert – wie bei
 * den Vorschlägen zum Zusatz. Ist die Zahl schon erreicht, sagt der Hinweis, dass keine Nachricht kommt.
 */
export function QuorumCard({ plan }: { plan: PlanWithParticipants }) {
  const toast = useToast();
  const setMin = useSetPlanMinGoing(plan.id);
  const texts = t.planQuorum.card;
  const current = plan.min_going ?? null;
  const options = current != null && !OPTIONS.includes(current) ? [...OPTIONS, current].sort((a, b) => a - b) : OPTIONS;
  const going = goingCount(plan);

  function choose(min: number | null) {
    if (min === current || setMin.isPending) return;
    setMin.mutate(min, {
      onSuccess: () => toast.success(min == null ? texts.removed : texts.saved(min)),
      onError: (error) => toast.error(error),
    });
  }

  const chip = "inline-flex h-10 items-center justify-center rounded-full border px-4 text-[14px] font-semibold transition-colors disabled:opacity-50";
  return (
    <section aria-labelledby="quorum-heading" className="mt-4 rounded-card border border-line bg-surface p-4" data-testid="plan-quorum-card">
      <h2 id="quorum-heading" className="mb-1 flex items-center gap-2 text-[17px] font-bold text-fg">
        <IconCrews className="size-[18px] text-muted" aria-hidden />
        {texts.title}
      </h2>
      <p className="mb-3 text-[13px] leading-snug text-muted">{texts.intro}</p>
      <div role="radiogroup" aria-label={texts.label} className="flex flex-wrap gap-2">
        {[null, ...options].map((value) => {
          const on = value === current;
          return (
            <button
              key={value ?? "none"}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={value == null ? texts.noneLabel : texts.option(value)}
              disabled={setMin.isPending}
              onClick={() => choose(value)}
              className={cn(chip, on ? "border-lime bg-lime text-lime-ink" : "border-line-strong text-fg hover:border-white/25")}
            >
              {value == null ? texts.none : value}
            </button>
          );
        })}
      </div>
      {current != null && going >= current && <p className="mt-3 text-[13px] leading-snug text-faint">{texts.alreadyReached}</p>}
    </section>
  );
}
