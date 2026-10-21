import { useState } from "react";
import { IconSpinner } from "@/components/icons";
import { useToast } from "@/components/ui/Toast";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import type { AttendanceStatus, Plan } from "@/lib/types";
import { useSetAttendance } from "./api";

type Answer = Exclude<AttendanceStatus, "invited">;

/** V2: gleiche Farbnamen wie die Pillen der Abstimm- und Planseiten-Karten (`.vote-pill[data-response]`). */
const ANSWERS: { value: Answer; label: string; response: "yes" | "maybe" | "no" }[] = [
  { value: "going", label: t.plans.detail.attendance.going, response: "yes" },
  { value: "maybe", label: t.plans.detail.attendance.maybe, response: "maybe" },
  { value: "declined", label: t.plans.detail.attendance.declined, response: "no" },
];

/**
 * D6 · Zusage direkt auf Home: drei Knöpfe unter dem Ticket eines Plans, auf den deine Antwort fehlt.
 * Gleiche RPC wie auf der Planseite (`set_attendance`); danach rutscht der Plan aus „Deine Antwort fehlt“,
 * und sein Ticket trägt die Farbe deiner Antwort.
 * V2 Etappe 3d: Antworten als Pillen wie auf Planseite und Abstimmung; die angetippte Pille füllt sich
 * sofort in ihrer Antwortfarbe (grün dabei, gelb vielleicht, rot kann nicht), während gespeichert wird.
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
    <div role="group" aria-label={t.plans.quickAnswer(plan.title)} className={cn("quick-answer grid grid-cols-3 gap-2", className)}>
      {ANSWERS.map(({ value, label, response }) => {
        const busy = setAttendance.isPending && chosen === value;
        return (
          <button
            key={value}
            type="button"
            disabled={setAttendance.isPending}
            aria-busy={busy || undefined}
            data-response={response}
            data-chosen={chosen === value || undefined}
            onClick={() => answer(value)}
            className="vote-pill gap-1.5"
          >
            {busy && <IconSpinner className="size-4 shrink-0 animate-spin" aria-hidden />}
            {label}
          </button>
        );
      })}
    </div>
  );
}
