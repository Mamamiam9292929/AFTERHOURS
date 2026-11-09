import { useMemo } from "react";
import { IconCalendarCheck, IconCheck, IconVote } from "@/components/icons";
import { Button, ButtonLink } from "@/components/ui/Button";
import { FormMessage } from "@/components/ui/Field";
import { planGuestSecret, useGuestRsvp, useSharedPlanRsvp } from "@/features/plans/guestsApi";
import { loadTexts, locale, t } from "@/i18n";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { localizedServerTitle } from "@/lib/servertitle";
import { formatDateTime } from "@/lib/time";
import type { VoteResponse } from "@/lib/types";
import { type BallotOption, rememberGuestName, type SharedPollOutcome } from "./api";

// F7: Die Texte des Ergebnisses liegen nicht im Start-Bundle – sie laden erst, wenn eine geteilte Abstimmung vorbei ist.
await loadTexts("pollOutcome");

/**
 * P28 · „Was draus wurde“: Ergebnis auf dem Abstimm-Link (/v/<token>) für Gäste ohne Konto. Wie die
 * Ergebnis-Karte der Crew: mit Plan ganz in Lime (wie „dabei“), sonst dunkles Glas. Ein Link zum Plan bzw. zur
 * Stichwahl steht nur da, wenn der Server ihn liefert – also für Gäste, die mit diesem Gerät mitgestimmt haben,
 * und nur, wenn die Crew ihn schon geteilt hat. Sonst sagt die Karte ehrlich, wo es den Link gibt.
 */
export function PollOutcomeCard({
  outcome,
  options,
  me,
}: {
  outcome: SharedPollOutcome;
  options: BallotOption[];
  me: { name: string; votes: Record<string, VoteResponse | null> } | null;
}) {
  const voted = me != null;
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

  // P28 Etappe 3: Wer beim Gewinner „Bin dabei“ gesagt hat, sagt zum Plan mit einem Tipp zu – nie automatisch.
  const quick = plan && !plan.cancelled && plan.token && me && outcome.winner != null && me.votes[String(outcome.winner)] === "yes" ? { token: plan.token, name: me.name } : null;

  if (plan) {
    kicker = copy.planKicker;
    heading = localizedServerTitle(plan.title, locale);
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
      {quick && <QuickRsvp token={quick.token} name={quick.name} winner={winner?.title ?? heading} />}
      {link && (
        <ButtonLink
          to={link.to}
          variant={quick ? "secondary" : "primary"}
          size="lg"
          block
          className={quick ? "mt-3" : "mt-4"}
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

/**
 * P28 Etappe 3 · Aus der Stimme wird eine Zusage – mit einem Tipp. Erscheint nur, wenn die Crew Zusagen über den
 * Plan-Link erlaubt (W10) und der Plan noch nicht begonnen hat; Name und Geheimnis wie auf der Plan-Karte, also
 * dieselbe Datenbankfunktion mit denselben Prüfungen (Grenze, volle Runde, Rate Limit). Wer dort schon geantwortet
 * hat, sieht nur seine Antwort. Lädt still: ohne Antwort vom Server bleibt nur der Link zum Plan.
 */
function QuickRsvp({ token, name, winner }: { token: string; name: string; winner: string }) {
  const secret = useMemo(() => planGuestSecret(token), [token]);
  const rsvp = useSharedPlanRsvp(token, secret);
  const answer = useGuestRsvp(token, secret);
  const copy = t.pollOutcome.quick;
  const data = rsvp.data?.status === "valid" ? rsvp.data : null;
  if (!data || !data.plan.open) return null;

  const mine = data.me;
  if (mine && !answer.isPending) {
    return (
      <p className="mt-4 flex items-center gap-2 text-[15px] font-semibold text-fg" role="status" data-testid="poll-outcome-rsvp">
        {mine.status === "going" && <IconCheck className="size-5 shrink-0" aria-hidden />}
        {mine.status === "going" ? copy.going(mine.name) : mine.status === "maybe" ? copy.maybe(mine.name) : copy.declined(mine.name)}
      </p>
    );
  }

  const full = answer.isError && (answer.error as { message?: string }).message === "plan_full";
  return (
    <div className="mt-4 space-y-2" data-testid="poll-outcome-quick">
      <p className="text-[15px] leading-snug text-fg">{copy.prompt(winner)}</p>
      <Button
        size="lg"
        block
        loading={answer.isPending}
        icon={<IconCheck className="size-5" aria-hidden />}
        onClick={() => answer.mutate({ name, status: "going" }, { onSuccess: () => rememberGuestName(name) })}
      >
        {copy.button(name)}
      </Button>
      <p className="text-sm text-muted">{copy.privacy}</p>
      <div aria-live="polite">{answer.isError && <FormMessage>{full ? copy.full : errorMessage(answer.error)}</FormMessage>}</div>
    </div>
  );
}
