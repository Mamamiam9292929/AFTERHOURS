import { IconCircleCheck } from "@/components/icons";
import { PosterTitle } from "@/components/layout/Page";
import { Avatar, type Person } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Feedback";
import { useToast } from "@/components/ui/Toast";
import { loadTexts, t } from "@/i18n";
import { ARRIVAL_MINUTES, arrivalOrder, arrivalOverdue } from "@/lib/arrival";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { formatTime } from "@/lib/time";
import { usePlanArrival, useSetPlanArrival, type ArrivalChoice } from "./arrivalApi";

// F7: Texte von „Seid ihr schon da?“ laden erst mit der Karte – also nur rund um den Beginn eines Abends.
await loadTexts("planArrival");

/**
 * P43 · „Seid ihr schon da?“ auf der Planseite – ab einer Stunde vor Beginn bis drei Stunden danach (`arrivalOpen`).
 * Wer „Bin dabei“ oder „Vielleicht“ gesagt hat, tippt „Bin da“ (Karte wird grün) oder „Bin da in 10/20/30 Min./1 Std.“
 * (Karte wird gelb, die Uhrzeit rechnet der Server). Die Crew sieht, wer da ist und wer gegen wann kommt; wer nichts
 * sagt, nur als Zahl. Kein Standort – und das steht auch so auf der Karte. Wer schon da ist, bekommt Bescheid, wenn
 * jemand später kommt (Etappe 2b, Trigger in der Datenbank). Mit Live-Standort
 * gibt es „Bin gleich da“ weiterhin unter „Wo seid ihr?“ (P13); diese Karte braucht keinen.
 */
export function PlanArrivalCard({
  planId,
  userId,
  lookup,
  now,
}: {
  planId: string;
  userId: string;
  lookup: (id: string | null | undefined) => Person | null;
  now: Date;
}) {
  const toast = useToast();
  const status = usePlanArrival(planId);
  const setArrival = useSetPlanArrival(planId);
  const copy = t.planArrival;

  if (status.isPending) {
    return (
      <div className="mt-4" data-testid="plan-arrival-loading">
        <Skeleton className="h-36 rounded-[28px]" />
      </div>
    );
  }
  if (status.isError) {
    return (
      <div role="alert" data-testid="plan-arrival-error" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[28px] border border-danger/35 bg-danger/5 px-4 py-3.5 text-sm">
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
  if (!data.open || (!data.can_answer && data.people.length === 0)) return null;
  const mine = data.mine;
  const lead = !data.can_answer
    ? copy.leadOthers
    : mine?.state === "here"
      ? copy.leadHere(formatTime(mine.updated_at))
      : mine?.state === "late" && mine.eta
        ? copy.leadLate(formatTime(mine.eta))
        : copy.lead;
  const people = arrivalOrder(data.people, userId);

  function say(choice: ArrivalChoice) {
    if (setArrival.isPending) return;
    setArrival.mutate(choice, {
      onSuccess: (eta) =>
        toast.success(choice.state === "here" ? copy.savedHere : choice.state === "late" && eta ? copy.savedLate(formatTime(eta)) : copy.removed),
      onError: (error) => toast.error(error),
    });
  }

  return (
    <section
      id="schon-da"
      aria-labelledby="plan-arrival-title"
      data-testid="plan-arrival"
      data-answer={mine?.state === "here" ? "yes" : mine?.state === "late" ? "maybe" : undefined}
      className={cn("vote-card answer-card mt-4 scroll-mt-24 p-4 sm:p-5", !mine && data.can_answer && "answer-open")}
    >
      <h2 id="plan-arrival-title" className={cn("display text-[22px] uppercase sm:text-[26px]", mine ? "text-fg" : "chrome")}>
        <PosterTitle text={copy.title} />
      </h2>
      <p className="mt-1.5 max-w-prose text-sm leading-snug text-muted" data-testid="plan-arrival-lead">
        {lead}
      </p>

      {data.can_answer && mine?.state !== "here" && (
        <div className="mt-4">
          <Button onClick={() => say({ state: "here" })} loading={setArrival.isPending} icon={<IconCircleCheck className="size-4" aria-hidden />} data-testid="plan-arrival-here">
            {copy.here}
          </Button>
          <p className="mt-3 text-[13px] font-semibold text-muted" id="plan-arrival-late-label">
            {copy.lateLabel}
          </p>
          <div className="mt-1.5 grid grid-cols-4 gap-2" role="group" aria-labelledby="plan-arrival-late-label">
            {ARRIVAL_MINUTES.map((minutes) => (
              <button
                key={minutes}
                type="button"
                className="vote-pill"
                data-response="maybe"
                data-testid={`plan-arrival-late-${minutes}`}
                aria-label={copy.minutesAria(minutes)}
                disabled={setArrival.isPending}
                onClick={() => say({ state: "late", minutes })}
              >
                {copy.minutes(minutes)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4" role="group" aria-label={copy.listLabel} data-testid="plan-arrival-list">
        {people.length === 0 ? (
          <p className="text-[13px] text-muted">{copy.none}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {people.map((entry) => {
              const person = lookup(entry.user_id);
              const name = entry.user_id === userId ? t.states.you : (person?.display_name ?? t.states.formerMember);
              const label =
                entry.state === "here"
                  ? copy.personHere(name, formatTime(entry.updated_at))
                  : arrivalOverdue(entry, now)
                    ? copy.personOverdue(name, formatTime(entry.eta ?? entry.updated_at))
                    : copy.personLate(name, formatTime(entry.eta ?? entry.updated_at));
              return (
                <li
                  key={entry.user_id}
                  data-testid="plan-arrival-person"
                  data-state={entry.state}
                  data-status={entry.state === "here" ? "going" : "maybe"}
                  className="who-chip inline-flex h-9 max-w-full items-center gap-2 rounded-full py-0.5 pl-1 pr-3 text-sm font-semibold text-fg"
                >
                  <Avatar person={person} size="xs" decorative />
                  <span className="min-w-0 truncate">{label}</span>
                </li>
              );
            })}
          </ul>
        )}
        {(data.missing > 0 || people.length > 0) && (
          <p className="mt-2.5 text-[13px] text-muted" data-testid="plan-arrival-missing">
            {data.missing > 0 ? copy.missing(data.missing) : copy.allSaid}
          </p>
        )}
      </div>

      {data.can_answer && mine && (
        <button
          type="button"
          data-testid="plan-arrival-undo"
          disabled={setArrival.isPending}
          onClick={() => say({ state: "none" })}
          className="mt-1 inline-flex min-h-11 items-center text-[13px] font-semibold text-muted underline decoration-line-strong underline-offset-4 hover:text-fg"
        >
          {copy.undo}
        </button>
      )}
      <p className="mt-2 text-[13px] leading-snug text-muted" data-testid="plan-arrival-honest">
        {copy.honest}
      </p>
    </section>
  );
}
