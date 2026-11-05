import { useState } from "react";
import { IconInfo, IconSpinner } from "@/components/icons";
import { useToast } from "@/components/ui/Toast";
import { t } from "@/i18n";
import { joinsWaitlist } from "@/lib/capacity";
import { cn } from "@/lib/cn";
import { goingWithGuests } from "@/lib/quorum";
import type { AttendanceStatus } from "@/lib/types";
import { useJoinPlanWaitlist, useSetAttendance, type PlanWithParticipants } from "./api";

type Answer = Exclude<AttendanceStatus, "invited">;

/** V2: gleiche Farbnamen wie die Pillen der Abstimm- und Planseiten-Karten (`.vote-pill[data-response]`). */
/** P23 Etappe 2: Farbe der alten Antwort – inline, damit das Start-CSS nicht wächst. */
const PREVIOUS_COLOR: Record<Answer, string> = { going: "#c8ff2e", maybe: "#ffc93d", declined: "#ff6b5e" };

const ANSWERS: { value: Answer; label: string; response: "yes" | "maybe" | "no" }[] = [
  { value: "going", label: t.plans.detail.attendance.going, response: "yes" },
  { value: "maybe", label: t.plans.detail.attendance.maybe, response: "maybe" },
  { value: "declined", label: t.plans.detail.attendance.declined, response: "no" },
];

type QuickPlan = Pick<PlanWithParticipants, "id" | "title" | "status" | "starts_at" | "max_going" | "participants" | "guests">;

/**
 * D6 · Zusage direkt auf Home: drei Knöpfe unter dem Ticket eines Plans, auf den deine Antwort fehlt.
 * Gleiche RPC wie auf der Planseite (`set_attendance`); danach rutscht der Plan aus „Deine Antwort fehlt“,
 * und sein Ticket trägt die Farbe deiner Antwort.
 * V2 Etappe 3d: Antworten als Pillen wie auf Planseite und Abstimmung; die angetippte Pille füllt sich
 * sofort in ihrer Antwortfarbe (grün dabei, gelb vielleicht, rot kann nicht), während gespeichert wird.
 * P23 Etappe 2: Wurde der Plan verschoben und alle neu gefragt, steht die alte Antwort wie auf der Planseite
 * darunter („Vorher: Bin dabei“), und ihre Pille trägt eine gestrichelte Kante – ein Tipp bestätigt sie neu.
 * P26 Etappe 3a: Ist die Runde voll, wird „Bin dabei“ wie auf der Planseite zu „Nachrücken“ (`join_plan_waitlist`);
 * danach steht man auf der Liste („vielleicht“), der Plan rutscht aus „Deine Antwort fehlt“, das Ticket nennt den Platz.
 */
export function PlanQuickAnswer({ plan, previous, now, className }: { plan: QuickPlan; previous?: Answer | null; now?: Date; className?: string }) {
  const toast = useToast();
  const setAttendance = useSetAttendance(plan.id);
  const joinWaitlist = useJoinPlanWaitlist(plan.id);
  const [chosen, setChosen] = useState<Answer | null>(null);
  // Fällt die Antwort hier an, ist sie offen („invited“) – voll heißt also: „Bin dabei“ geht nur noch über die Liste.
  const full = joinsWaitlist(plan, null, goingWithGuests(plan), now);
  const pending = setAttendance.isPending || joinWaitlist.isPending;

  function waitlist() {
    setChosen("going");
    joinWaitlist.mutate(undefined, {
      onSuccess: (n) => toast.success(t.plans.detail.attendance.waitlistJoined(n)),
      onError: (error) => {
        setChosen(null);
        toast.error(error);
      },
    });
  }

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

  const before = previous ? ANSWERS.find((a) => a.value === previous) : undefined;

  const pills = (
    <div role="group" aria-label={t.plans.quickAnswer(plan.title)} className={cn("quick-answer grid grid-cols-3 gap-2", !before && className)}>
      {ANSWERS.map(({ value, label, response }) => {
        const busy = pending && chosen === value;
        const toList = value === "going" && full;
        return (
          <button
            key={value}
            type="button"
            disabled={pending || joinWaitlist.isSuccess}
            aria-busy={busy || undefined}
            data-response={response}
            data-chosen={chosen === value || undefined}
            data-previous={before?.value === value || undefined}
            style={before?.value === value && chosen === null ? { borderStyle: "dashed", borderColor: PREVIOUS_COLOR[value], color: PREVIOUS_COLOR[value] } : undefined}
            aria-label={toList ? t.plans.detail.attendance.waitlistLabel : undefined}
            data-testid={toList ? "plan-quick-waitlist" : undefined}
            onClick={() => (toList ? waitlist() : answer(value))}
            className="vote-pill gap-1.5"
          >
            {busy && <IconSpinner className="size-4 shrink-0 animate-spin" aria-hidden />}
            {toList ? t.plans.detail.attendance.waitlist : label}
          </button>
        );
      })}
    </div>
  );

  if (!before) return pills;
  return (
    <div className={className}>
      {pills}
      {!chosen && (
        <p className="mt-2 flex items-center gap-2 text-[13px] leading-snug text-muted" data-testid="plan-quick-asked-again">
          <IconInfo className="size-4 shrink-0" aria-hidden />
          {t.plans.detail.attendance.askedAgain(before.label)}
        </p>
      )}
    </div>
  );
}
