import { IconCalendarCheck, IconVote } from "@/components/icons";
import { ButtonLink } from "@/components/ui/Button";
import { loadTexts, t } from "@/i18n";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/time";
import type { BallotOption, SharedPollOutcome } from "./api";

// F7: Die Texte des Ergebnisses liegen nicht im Start-Bundle – sie laden erst, wenn eine geteilte Abstimmung vorbei ist.
await loadTexts("pollOutcome");

/**
 * P28 · „Was draus wurde“: Ergebnis auf dem Abstimm-Link (/v/<token>) für Gäste ohne Konto. Wie die
 * Ergebnis-Karte der Crew: mit Plan ganz in Lime (wie „dabei“), sonst dunkles Glas. Ein Link zum Plan bzw. zur
 * Stichwahl steht nur da, wenn der Server ihn liefert – also für Gäste, die mit diesem Gerät mitgestimmt haben,
 * und nur, wenn die Crew ihn schon geteilt hat. Sonst sagt die Karte ehrlich, wo es den Link gibt.
 */
export function PollOutcomeCard({ outcome, options, voted }: { outcome: SharedPollOutcome; options: BallotOption[]; voted: boolean }) {
  const winner = outcome.winner == null ? null : (options.find((o) => o.key === outcome.winner) ?? null);
  const plan = outcome.plan;
  const runoff = outcome.runoff;
  const live = plan != null && !plan.cancelled;
  const copy = t.pollOutcome;

  let kicker = copy.kicker;
  let heading: string;
  let body: string | null = null;
  let link: { to: string; label: string; icon: "plan" | "vote" } | null = null;
  let hint: string | null = null;

  if (plan) {
    kicker = copy.planKicker;
    heading = plan.title;
    body = plan.cancelled ? copy.planCancelled : formatDateTime(plan.starts_at);
    if (live && plan.token) link = { to: `/s/${plan.token}`, label: copy.toPlan, icon: "plan" };
    else if (live && voted) hint = copy.planNoLink;
  } else if (outcome.tie) {
    heading = runoff ? copy.tie : copy.tieWaiting;
    if (runoff) {
      body = runoff.open ? copy.runoffOpen(formatDateTime(runoff.ends_at)) : copy.runoffClosed;
      if (runoff.open && runoff.token) link = { to: `/v/${runoff.token}`, label: copy.toRunoff, icon: "vote" };
      else if (runoff.open && voted) hint = copy.runoffNoLink;
    }
  } else if (winner) {
    heading = winner.title;
    body = copy.noPlan;
  } else {
    heading = copy.noWinner;
  }

  return (
    <section
      aria-labelledby="poll-outcome-title"
      className="vote-card result-card mb-6 p-5 sm:p-6"
      data-answer={live ? "yes" : undefined}
      data-testid="poll-outcome"
    >
      <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">{kicker}</p>
      <h2 id="poll-outcome-title" className={cn("display mt-1.5 break-words text-[24px] uppercase sm:text-[29px]", live ? "text-fg" : "chrome")}>
        {heading}
      </h2>
      {body && (
        <p className={cn("mt-2 max-w-prose text-[15px] leading-snug", plan && !plan.cancelled ? "font-semibold text-fg" : "text-muted")} data-testid="poll-outcome-body">
          {body}
        </p>
      )}
      {link && (
        <ButtonLink
          to={link.to}
          size="lg"
          block
          className="mt-4"
          icon={link.icon === "plan" ? <IconCalendarCheck className="size-5" aria-hidden /> : <IconVote className="size-5" aria-hidden />}
          data-testid="poll-outcome-link"
        >
          {link.label}
        </ButtonLink>
      )}
      {hint && <p className="mt-3 text-sm text-muted">{hint}</p>}
    </section>
  );
}
