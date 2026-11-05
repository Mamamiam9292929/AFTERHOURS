import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IconCrews, IconInfo } from "@/components/icons";
import { Avatar, type Person } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { loadTexts, t } from "@/i18n";
import { capacityOptions, planWaitlist, spotsLeft, waitingGuests, waitlistPosition } from "@/lib/capacity";
import { cn } from "@/lib/cn";
import { qk } from "@/lib/query";
import { goingWithGuests } from "@/lib/quorum";
import { supabase } from "@/lib/supabase";
import type { PlanWithParticipants } from "./api";
import { StatusPill } from "./PlanPanel";

// F7: Texte der Höchstzahl liegen nicht im Start-Bundle – sie laden erst, wenn ein Plan eine hat oder jemand sie einstellt.
await loadTexts("planCapacity");

function useInvalidatePlan(planId: string) {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: qk.plan(planId) });
    void client.invalidateQueries({ queryKey: qk.plans });
  };
}

function useSetPlanMaxGoing(planId: string) {
  const invalidate = useInvalidatePlan(planId);
  return useMutation({
    mutationFn: async (max: number | null): Promise<number> => {
      const { data, error } = await supabase.rpc("set_plan_max_going", { p_plan_id: planId, p_max: max });
      if (error) throw error;
      return data as number;
    },
    onSuccess: invalidate,
  });
}

function useLeavePlanWaitlist(planId: string) {
  const invalidate = useInvalidatePlan(planId);
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("leave_plan_waitlist", { p_plan_id: planId });
      if (error) throw error;
    },
    onSettled: invalidate,
  });
}

/**
 * P26 · „Höchstens 6 Plätze“ unter „Wer kommt mit?“ – für alle in der Crew: wie viele Plätze noch frei sind
 * (Balken in Lime, „Voll“ in Gelb) und die Nachrückliste in ihrer Reihenfolge.
 */
export function CapacityMeter({ plan, userId, lookup, now }: { plan: PlanWithParticipants; userId: string; lookup: (id: string | null | undefined) => Person | null; now: Date }) {
  const max = plan.max_going ?? null;
  const going = goingWithGuests(plan);
  const left = spotsLeft(plan, going, now);
  if (max == null || left == null) return null;
  // Etappe 3b: Gäste ohne Konto stehen in derselben Reihe.
  const queue = planWaitlist(plan.participants, waitingGuests(plan));
  const texts = t.planCapacity.meter;
  const full = left === 0;
  return (
    <div data-testid="plan-capacity" data-full={full ? "true" : "false"} className="mb-3 rounded-card border border-white/10 bg-white/[0.04] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-fg">{texts.title(max)}</p>
        <StatusPill tone={full ? "amber" : "lime"} testId="plan-capacity-status">
          {full ? texts.full : texts.left(left)}
        </StatusPill>
      </div>
      <div
        className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.min(going, max)}
        aria-label={texts.progress(Math.min(going, max), max)}
      >
        <div className={cn("bar-grow h-full rounded-full", full ? "bg-amber" : "bg-lime")} style={{ width: `${Math.max(Math.min(going / max, 1), 0.04) * 100}%` }} />
      </div>
      <p className="mt-1.5 text-[13px] text-muted">{texts.count(Math.min(going, max), max)}</p>
      {queue.length > 0 && (
        <div className="mt-3 border-t border-white/10 pt-3" data-testid="plan-waitlist">
          <p className="flex items-center gap-2 text-[13px] font-semibold text-muted">
            <span aria-hidden className="size-2 rounded-full bg-amber" />
            {texts.waitlistTitle(queue.length)}
          </p>
          <ol className="mt-2 flex flex-wrap gap-2">
            {queue.map((item, index) => {
              const number = (
                <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-amber/20 text-[11px] font-bold text-amber">
                  {index + 1}
                </span>
              );
              if (item.kind === "guest") {
                return (
                  <li key={`g-${item.key}`} data-testid="plan-waitlist-entry" data-kind="guest" className="who-chip inline-flex h-9 max-w-full items-center gap-2 rounded-full py-0.5 pl-1 pr-3 text-sm text-fg">
                    {number}
                    <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full border border-dashed border-white/30 text-[10px] font-bold uppercase text-muted">
                      {item.entry.display_name.slice(0, 1)}
                    </span>
                    <span className="min-w-0 truncate">{t.plans.detail.attendance.guest(item.entry.display_name)}</span>
                  </li>
                );
              }
              const person = lookup(item.key);
              return (
                <li key={item.key} data-testid="plan-waitlist-entry" data-kind="member" className="who-chip inline-flex h-9 max-w-full items-center gap-2 rounded-full py-0.5 pl-1 pr-3 text-sm text-fg">
                  {number}
                  <Avatar person={person} size="xs" decorative />
                  <span className="min-w-0 truncate">{item.key === userId ? t.states.you : (person?.display_name ?? t.states.formerMember)}</span>
                </li>
              );
            })}
          </ol>
          <p className="mt-2 text-[13px] leading-snug text-faint">{texts.waitlistHint}</p>
        </div>
      )}
    </div>
  );
}

/**
 * P26 · In der eigenen Antwort-Karte: Runde voll und man ist nicht dabei – wo man auf der Liste steht oder wie
 * man draufkommt. „Von der Liste“ lässt die Antwort „Vielleicht“ stehen.
 */
export function WaitlistNote({ plan, userId }: { plan: PlanWithParticipants; userId: string }) {
  const toast = useToast();
  const leave = useLeavePlanWaitlist(plan.id);
  const texts = t.planCapacity.mine;
  const position = waitlistPosition(plan.participants, userId, waitingGuests(plan));
  return (
    <div className="mt-3 rounded-[16px] border border-white/15 bg-black/25 p-3" data-testid="plan-waitlist-mine" aria-live="polite">
      {position != null ? (
        <>
          <p className="text-sm font-bold text-fg">{texts.position(position)}</p>
          <p className="mt-0.5 text-[13px] leading-snug text-muted">{texts.positionBody}</p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-2.5"
            data-testid="plan-waitlist-leave"
            loading={leave.isPending}
            onClick={() => leave.mutate(undefined, { onSuccess: () => toast.success(texts.left), onError: (error) => toast.error(error) })}
          >
            {texts.leave}
          </Button>
        </>
      ) : (
        <p className="flex items-start gap-2 text-[13px] leading-snug text-muted">
          <IconInfo className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <span className="font-semibold text-fg">{texts.full(plan.max_going ?? 0)}</span> {texts.fullBody}
          </span>
        </p>
      )}
    </div>
  );
}

/**
 * P26 · Höchstzahl einstellen (Organisator:in, Owner, Admins; nur vor Beginn). Ein Tipp speichert – wie bei
 * der Mindestzahl. Zahlen unter den Zusagen oder unter der Mindestzahl stehen nicht zur Wahl.
 */
export function CapacityCard({ plan }: { plan: PlanWithParticipants }) {
  const toast = useToast();
  const setMax = useSetPlanMaxGoing(plan.id);
  const texts = t.planCapacity.card;
  const current = plan.max_going ?? null;
  const going = goingWithGuests(plan);
  const options = capacityOptions(going, plan.min_going, current);
  const raised = Math.max(going, plan.min_going ?? 0) > 2;

  function choose(max: number | null) {
    if (max === current || setMax.isPending) return;
    setMax.mutate(max, {
      onSuccess: () => toast.success(max == null ? texts.removed : texts.saved(max)),
      onError: (error) => toast.error(error),
    });
  }

  const chip = "inline-flex h-10 items-center justify-center rounded-full border px-4 text-[14px] font-semibold transition-colors disabled:opacity-50";
  return (
    <section aria-labelledby="capacity-heading" className="mt-4 rounded-card border border-line bg-surface p-4" data-testid="plan-capacity-card">
      <h2 id="capacity-heading" className="mb-1 flex items-center gap-2 text-[17px] font-bold text-fg">
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
              disabled={setMax.isPending}
              onClick={() => choose(value)}
              className={cn(chip, on ? "border-lime bg-lime text-lime-ink" : "border-line-strong text-fg hover:border-white/25")}
            >
              {value == null ? texts.none : value}
            </button>
          );
        })}
      </div>
      {raised && <p className="mt-3 text-[13px] leading-snug text-faint">{texts.floor}</p>}
    </section>
  );
}
