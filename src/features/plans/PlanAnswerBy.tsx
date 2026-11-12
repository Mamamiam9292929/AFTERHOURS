import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IconCheck, IconClock } from "@/components/icons";
import { useToast } from "@/components/ui/Toast";
import { loadTexts, t } from "@/i18n";
import { answerByOptions, answerByState, matchingDays } from "@/lib/answerby";
import { cn } from "@/lib/cn";
import { qk } from "@/lib/query";
import { supabase } from "@/lib/supabase";
import { formatDateTime } from "@/lib/time";
import type { PlanWithParticipants } from "./api";
import { StatusPill } from "./PlanPanel";

// F10: Texte der Planseite – lädt der Router mit der Seite; hier zur Sicherheit, falls die Karte zuerst da ist.
await loadTexts("planCards");

function useSetPlanAnswerBy(planId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (at: string | null): Promise<string | null> => {
      const { data, error } = await supabase.rpc("set_plan_answer_by", { p_plan_id: planId, p_answer_by: at });
      if (error) throw error;
      return (data as string | null) ?? null;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.plan(planId) });
      void client.invalidateQueries({ queryKey: qk.plans });
    },
  });
}

/**
 * P46 · Antwortfrist unter „Wer kommt mit?“ – für alle in der Crew: bis wann, wie viele noch fehlen. Nach Ablauf
 * steht dort, wer noch fehlt, und dass antworten trotzdem geht (die Frist ist ein Hinweis, keine Sperre).
 */
export function AnswerByMeter({ plan, now }: { plan: PlanWithParticipants; now: Date }) {
  const state = answerByState(plan, now);
  if (!state) return null;
  const open = plan.participants.filter((p) => p.attendance_status === "invited").length;
  const when = formatDateTime(state.at);
  const texts = t.planCards.answerBy.meter;
  return (
    <div
      data-testid="plan-answer-by"
      data-passed={state.passed ? "true" : "false"}
      className={cn("mb-3 rounded-card border bg-white/[0.04] p-3", state.passed && open > 0 ? "border-amber/40" : "border-white/10")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-fg">
          <IconClock className="size-4 shrink-0 text-muted" aria-hidden />
          <span className="min-w-0">{state.passed ? texts.passed(when) : texts.open(when)}</span>
        </p>
        <StatusPill tone={open === 0 ? "lime" : "amber"} testId="plan-answer-by-status">
          {open === 0 && <IconCheck className="size-3.5" aria-hidden />}
          {open === 0 ? texts.allAnswered : texts.missing(open)}
        </StatusPill>
      </div>
      {open > 0 && (
        <p className="mt-1.5 text-[13px] text-muted">
          {texts.missingLong(open)}
          {state.passed && ` ${texts.late}`}
        </p>
      )}
    </div>
  );
}

/**
 * P46 · Antwortfrist einstellen (Organisator:in, Owner, Admins; nur vor Beginn): ein Tipp auf „2 Tage vorher“
 * speichert – zur selben Berliner Uhrzeit wie der Beginn. Eine Frist, die zu keiner Auswahl passt (z. B. nach dem
 * Verschieben), steht als eigene, ausgewählte Pille da. P48: Bei einer laufenden Serie steht darunter, dass die Frist
 * auch für die nächsten Runden gilt (der Server übernimmt den Abstand beim Anlegen der Runde).
 */
export function AnswerByCard({ plan, now }: { plan: PlanWithParticipants; now: Date }) {
  const toast = useToast();
  const setAnswerBy = useSetPlanAnswerBy(plan.id);
  const texts = t.planCards.answerBy.card;
  const current = plan.answer_by ?? null;
  const currentDays = matchingDays(current, plan.starts_at);
  const options = answerByOptions(plan.starts_at, now);
  const custom = current != null && (currentDays == null || !options.some((o) => o.days === currentDays));

  function choose(at: string | null, selected: boolean) {
    if (selected || setAnswerBy.isPending) return;
    setAnswerBy.mutate(at, {
      onSuccess: () => toast.success(at == null ? texts.removed : texts.saved(formatDateTime(at))),
      onError: (error) => toast.error(error),
    });
  }

  const chip = "inline-flex h-10 items-center justify-center rounded-full border px-4 text-[14px] font-semibold transition-colors disabled:opacity-50";
  const tone = (on: boolean) => (on ? "border-lime bg-lime text-lime-ink" : "border-line-strong text-fg hover:border-white/25");
  return (
    <section aria-labelledby="answer-by-heading" className="mt-4 rounded-card border border-line bg-surface p-4" data-testid="plan-answer-by-card">
      <h2 id="answer-by-heading" className="mb-1 flex items-center gap-2 text-[17px] font-bold text-fg">
        <IconClock className="size-[18px] text-muted" aria-hidden />
        {texts.title}
      </h2>
      <p className="mb-3 text-[13px] leading-snug text-muted">{texts.intro}</p>
      {options.length === 0 && current == null ? (
        <p className="text-[13px] leading-snug text-faint">{texts.tooLate}</p>
      ) : (
        <div role="radiogroup" aria-label={texts.label} className="flex flex-wrap gap-2">
          <button
            type="button"
            role="radio"
            aria-checked={current == null}
            aria-label={texts.noneLabel}
            disabled={setAnswerBy.isPending}
            onClick={() => choose(null, current == null)}
            className={cn(chip, tone(current == null))}
          >
            {texts.none}
          </button>
          {options.map((option) => {
            const on = !custom && currentDays === option.days;
            const label = texts.option(option.days);
            return (
              <button
                key={option.days}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={texts.optionLabel(label, formatDateTime(option.at))}
                disabled={setAnswerBy.isPending}
                onClick={() => choose(option.at, on)}
                className={cn(chip, tone(on))}
              >
                {label}
              </button>
            );
          })}
          {custom && current && (
            <button type="button" role="radio" aria-checked className={cn(chip, tone(true))} onClick={() => undefined}>
              {formatDateTime(current)}
            </button>
          )}
        </div>
      )}
      {current != null && <p className="mt-3 text-[13px] font-semibold leading-snug text-fg" data-testid="plan-answer-by-current">{texts.current(formatDateTime(current))}</p>}
      {/* P48: Bei einer laufenden Serie bekommt die nächste Runde denselben Abstand zum Beginn. */}
      {current != null && plan.series?.active && (
        <p className="mt-1 text-[13px] leading-snug text-muted" data-testid="plan-answer-by-series">
          {texts.series}
        </p>
      )}
    </section>
  );
}
