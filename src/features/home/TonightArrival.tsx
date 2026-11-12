import { Link } from "react-router-dom";
import { IconCircleCheck, IconClock } from "@/components/icons";
import type { Person } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { usePlanArrival, useSetPlanArrival, type ArrivalChoice } from "@/features/plans/arrivalApi";
import { loadTexts, t } from "@/i18n";
import { ARRIVAL_MINUTES, arrivalOrder, arrivalOverdue } from "@/lib/arrival";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/time";
import { Tile } from "./TonightTile";

// F7: Texte von „Seid ihr schon da?“ laden erst mit der Kachel – also nur rund um den Beginn eines Abends.
await loadTexts("planArrival");

/** So viele Ansagen der anderen zeigt die Leiste; der Rest steht auf der Planseite. */
const PEOPLE_SHOWN = 4;

/**
 * P43 Etappe 2 · „Schon da?“ in der „Heute Abend“-Leiste auf Home – im selben Fenster wie die Karte auf der Planseite
 * (`arrivalOpen`: ab einer Stunde vor Beginn bis drei Stunden danach). Wer zugesagt hat oder „Vielleicht“ sagt, tippt
 * hier direkt „Bin da“ oder „Bin da in 10/20/30 Min./1 Std.“ (gleiche RPC und gleicher Speicher wie die Planseite),
 * darunter steht, wer schon da ist und wer gegen wann kommt; wer nichts gesagt hat, nur als Zahl. Ohne eigene Ansage-
 * möglichkeit und ohne Ansagen der anderen keine Kachel – die Leiste bleibt ruhig. Zurücknehmen geht auf der Planseite.
 */
export function TonightArrival({
  planId,
  userId,
  lookup,
  now,
  wide,
}: {
  planId: string;
  userId: string;
  lookup: (id: string | null | undefined) => Person | null;
  now: Date;
  wide: boolean;
}) {
  const toast = useToast();
  const status = usePlanArrival(planId);
  const setArrival = useSetPlanArrival(planId);
  const copy = t.planArrival;
  const span = wide ? "sm:col-span-2" : undefined;
  const icon = <IconClock aria-hidden />;

  if (status.isPending) {
    return (
      <div className={span}>
        <Tile icon={icon} label={copy.home.label}>
          <span className="block text-sm text-muted" aria-busy="true">
            {copy.home.loading}
          </span>
        </Tile>
      </div>
    );
  }
  if (status.isError) {
    return (
      <div className={span}>
        <Tile icon={icon} label={copy.home.label}>
          <span className="block text-sm text-muted" role="status" data-testid="tonight-arrival-error">
            {copy.home.error}
          </span>
          <button
            type="button"
            onClick={() => void status.refetch()}
            className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-fg underline decoration-line-strong underline-offset-4 hover:decoration-lime"
          >
            {copy.retry}
          </button>
        </Tile>
      </div>
    );
  }

  const data = status.data;
  if (!data.open || (!data.can_answer && data.people.length === 0)) return null;
  const mine = data.mine;
  const others = arrivalOrder(data.people, userId).filter((entry) => entry.user_id !== userId);
  const shown = others.slice(0, PEOPLE_SHOWN);
  const hidden = others.length - shown.length;

  function say(choice: ArrivalChoice) {
    if (setArrival.isPending) return;
    setArrival.mutate(choice, {
      onSuccess: (eta) => toast.success(choice.state === "here" ? copy.savedHere : eta ? copy.savedLate(formatTime(eta)) : copy.removed),
      onError: (error) => toast.error(error),
    });
  }

  return (
    <div className={span} data-testid="tonight-arrival" data-answer={mine?.state === "here" ? "yes" : mine?.state === "late" ? "maybe" : undefined}>
      <Tile icon={icon} label={copy.home.label}>
        {mine && (
          <span
            data-testid="tonight-arrival-mine"
            className={cn("flex items-start gap-1.5 break-words text-[17px] font-semibold leading-snug", mine.state === "here" ? "text-lime" : "text-amber")}
          >
            {mine.state === "here" && <IconCircleCheck className="mt-1 size-4 shrink-0" aria-hidden />}
            {mine.state === "here" ? copy.home.mineHere(formatTime(mine.updated_at)) : copy.home.mineLate(formatTime(mine.eta ?? mine.updated_at))}
          </span>
        )}
        {/* P44: Wer da ist, sagt auf der Planseite, wo – hier steht es bzw. der Weg dorthin. */}
        {mine?.state === "here" &&
          (mine.spot ? (
            <span className="mt-1 block break-words text-sm text-fg" data-testid="tonight-arrival-mine-spot">
              {copy.home.mineSpot(mine.spot)}
            </span>
          ) : (
            data.can_answer && (
              <Link
                to={`/plans/${planId}#schon-da`}
                data-testid="tonight-arrival-ask-spot"
                className="mt-0.5 inline-flex min-h-11 items-center text-[13px] font-semibold text-muted underline decoration-line-strong underline-offset-4 hover:text-fg hover:decoration-lime"
              >
                {copy.home.askSpot}
              </Link>
            )
          ))}

        {data.can_answer && mine?.state !== "here" && (
          <div className={cn("flex flex-wrap items-center gap-2", mine && "mt-2")}>
            <Button
              size="sm"
              className="h-10"
              data-testid="tonight-arrival-here"
              loading={setArrival.isPending && setArrival.variables?.state === "here"}
              disabled={setArrival.isPending}
              onClick={() => say({ state: "here" })}
              icon={<IconCircleCheck className="size-4" aria-hidden />}
            >
              {copy.here}
            </Button>
            <div className="grid w-full grid-cols-4 gap-1.5 sm:flex sm:w-auto sm:flex-wrap sm:items-center" role="group" aria-label={copy.lateLabel}>
              {ARRIVAL_MINUTES.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  data-testid={`tonight-arrival-late-${minutes}`}
                  aria-label={copy.minutesAria(minutes)}
                  disabled={setArrival.isPending}
                  onClick={() => say({ state: "late", minutes })}
                  className="inline-flex h-10 min-w-0 items-center justify-center whitespace-nowrap rounded-full border border-amber/45 bg-amber/[0.08] px-1 text-[13px] font-semibold tabular-nums text-fg sm:min-w-11 sm:px-3 sm:text-sm transition-colors hover:border-amber hover:text-amber disabled:cursor-wait disabled:opacity-60"
                >
                  {copy.minutes(minutes)}
                </button>
              ))}
            </div>
          </div>
        )}

        {shown.length > 0 ? (
          <ul className={cn("space-y-0.5", (mine || data.can_answer) && "mt-2.5")} aria-label={copy.listLabel}>
            {shown.map((entry) => {
              const name = lookup(entry.user_id)?.display_name ?? t.states.formerMember;
              const time = formatTime(entry.state === "here" ? entry.updated_at : (entry.eta ?? entry.updated_at));
              const base =
                entry.state === "here" ? copy.personHere(name, time) : arrivalOverdue(entry, now) ? copy.personOverdue(name, time) : copy.personLate(name, time);
              // P44: „Wo sitzt ihr?“ gleich mit dazu – genau das will wissen, wer noch unterwegs ist.
              const label = entry.state === "here" && entry.spot ? copy.home.withSpot(base, entry.spot) : base;
              return (
                <li key={entry.user_id} data-testid="tonight-arrival-person" data-state={entry.state} className="flex items-center gap-2 break-words text-sm leading-snug text-fg">
                  <span aria-hidden className={cn("size-2 shrink-0 rounded-full", entry.state === "here" ? "bg-lime" : "bg-amber")} />
                  <span className="min-w-0">{label}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          !mine && <p className={cn("text-sm text-muted", data.can_answer && "mt-2.5")}>{copy.none}</p>
        )}
        {hidden > 0 && (
          <Link
            to={`/plans/${planId}#schon-da`}
            data-testid="tonight-arrival-more"
            className="mt-1 inline-flex min-h-11 items-center text-[13px] font-semibold text-muted underline decoration-line-strong underline-offset-4 hover:text-fg hover:decoration-lime"
          >
            {copy.home.more(hidden)}
          </Link>
        )}
        {(data.missing > 0 || data.people.length > 0) && (
          <p className="mt-1.5 text-[13px] text-muted" data-testid="tonight-arrival-missing">
            {data.missing > 0 ? copy.missing(data.missing) : copy.allSaid}
          </p>
        )}
      </Tile>
    </div>
  );
}
