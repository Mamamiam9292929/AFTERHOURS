import { useState } from "react";
import { IconSpinner } from "@/components/icons";
import { useToast } from "@/components/ui/Toast";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import type { AttendanceStatus, Plan } from "@/lib/types";
import { useSetAttendance } from "./api";

type Answer = Exclude<AttendanceStatus, "invited">;

const ANSWERS: { value: Answer; label: string; tone: string }[] = [
  { value: "going", label: t.plans.detail.attendance.going, tone: "hover:border-lime hover:text-lime focus-visible:border-lime" },
  { value: "maybe", label: t.plans.detail.attendance.maybe, tone: "hover:border-amber hover:text-amber focus-visible:border-amber" },
  { value: "declined", label: t.plans.detail.attendance.declined, tone: "hover:border-danger hover:text-danger focus-visible:border-danger" },
];

/**
 * D6 · Zusage direkt auf Home: drei Knöpfe unter dem Ticket eines Plans, auf den deine Antwort fehlt.
 * Gleiche RPC wie auf der Planseite (`set_attendance`); danach rutscht der Plan aus „Deine Antwort fehlt“,
 * und sein Ticket trägt die Farbe deiner Antwort.
 */
export function PlanQuickAnswer({ plan, className }: { plan: Pick<Plan, "id" | "title">; className?: string }) {
  const toast = useToast();
  const setAttendance = useSetAttendance(plan.id);
  const [chosen, setChosen] = useState<Answer | null>(null);

  function answer(value: Answer) {
    setChosen(value);
    setAttendance.mutate(value, {
      onSuccess: () => toast.success(t.plans.detail.attendance.saved),
      onError: (error) => {
        setChosen(null);
        toast.error(error);
      },
    });
  }

  return (
    <div role="group" aria-label={t.plans.quickAnswer(plan.title)} className={cn("grid grid-cols-3 gap-2", className)}>
      {ANSWERS.map(({ value, label, tone }) => {
        const busy = setAttendance.isPending && chosen === value;
        return (
          <button
            key={value}
            type="button"
            disabled={setAttendance.isPending}
            aria-busy={busy || undefined}
            onClick={() => answer(value)}
            className={cn(
              "inline-flex h-11 items-center justify-center gap-1.5 rounded-control border border-line-strong px-1 text-center text-sm font-semibold leading-tight text-fg transition-[border-color,color,transform] duration-200 active:scale-[0.96] disabled:opacity-60",
              tone,
            )}
          >
            {busy && <IconSpinner className="size-4 shrink-0 animate-spin" aria-hidden />}
            {label}
          </button>
        );
      })}
    </div>
  );
}
