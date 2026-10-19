import { useMemo } from "react";
import { Section } from "@/components/layout/Page";
import type { PlanWithParticipants } from "@/features/plans/api";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { crewRecap } from "@/lib/recap";
import { formatMonthYear } from "@/lib/time";

const tx = t.crews.recap;
const narrowMonth = new Intl.DateTimeFormat("de-DE", { month: "narrow", timeZone: "UTC" });
const monthDate = (key: string) => new Date(`${key}-15T12:00:00Z`);

/**
 * P9 Etappe 1 · Crew-Rückblick: gemeinsame Abende, seit wann, längste Serie, größte Runde, Lieblingstag,
 * die letzten zwölf Monate als Balken und die Stammorte. Erscheint ab dem ersten abgeschlossenen Plan;
 * gerechnet wird im Browser aus den Plänen, die die Crew ohnehin sieht (src/lib/recap.ts).
 */
export function CrewRecap({ plans }: { plans: readonly PlanWithParticipants[] }) {
  const recap = useMemo(() => crewRecap(plans), [plans]);
  if (recap.evenings === 0) return null;

  const max = Math.max(1, ...recap.months.map((m) => m.count));
  const facts = [
    recap.longestStreak >= 2 ? { label: tx.streak, value: tx.streakValue(recap.longestStreak) } : null,
    recap.biggestRound >= 2 ? { label: tx.biggestRound, value: tx.biggestRoundValue(recap.biggestRound) } : null,
    recap.favoriteWeekday !== null ? { label: tx.favoriteDay, value: tx.weekdays[recap.favoriteWeekday] ?? "" } : null,
  ].filter((f): f is { label: string; value: string } => f !== null);

  return (
    <Section title={tx.title}>
      <div className="max-w-2xl overflow-hidden rounded-card border border-line bg-surface" data-testid="crew-recap">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-4 p-4 sm:p-5">
          <p className="flex items-end gap-3">
            <span className="display text-[64px] leading-[0.85] text-lime sm:text-[76px]">{recap.evenings}</span>
            <span className="pb-1 text-[15px] font-semibold leading-tight text-fg">
              {tx.evenings(recap.evenings)}
              {recap.firstAt && <span className="block text-[13px] font-medium text-muted">{tx.since(formatMonthYear(recap.firstAt))}</span>}
            </span>
          </p>
          {facts.length > 0 && (
            <dl className="flex flex-wrap gap-x-6 gap-y-3 sm:ml-auto">
              {facts.map((fact) => (
                <div key={fact.label}>
                  <dt className="text-[12px] font-medium uppercase tracking-wide text-muted">{fact.label}</dt>
                  <dd className="display mt-0.5 text-[22px] text-fg">{fact.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        {/* Abriss wie beim Ticket, darunter die letzten zwölf Monate als schmale Balken. */}
        <div className="border-t border-dashed border-line-strong p-4 sm:p-5">
          <h3 className="text-[13px] font-medium text-muted">{tx.monthsTitle}</h3>
          <ol className="mt-3 grid h-24 grid-cols-12 items-end gap-[2px]" aria-label={tx.monthsTitle}>
            {recap.months.map((month) => {
              const label = tx.monthBar(formatMonthYear(monthDate(month.key)), month.count);
              return (
                <li key={month.key} className="flex h-full flex-col items-center justify-end gap-1.5" title={label}>
                  <span className="sr-only">{label}</span>
                  <span
                    aria-hidden
                    className={cn("w-full max-w-5 rounded-t-[4px]", month.count > 0 ? "bg-lime" : "bg-line-strong")}
                    style={{ height: month.count > 0 ? `${Math.max(8, Math.round((month.count / max) * 72))}px` : "2px" }}
                  />
                  <span aria-hidden className="text-[11px] font-medium leading-none text-muted">
                    {narrowMonth.format(monthDate(month.key))}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        {recap.places.length > 0 && (
          <div className="border-t border-line p-4 sm:p-5">
            <h3 className="text-[13px] font-medium text-muted">{tx.places}</h3>
            <ol className="mt-2 divide-y divide-line">
              {recap.places.map((place, index) => (
                <li key={place.key} className="flex items-center gap-3 py-2.5">
                  <span aria-hidden className="display w-5 text-[20px] text-faint">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-semibold text-fg">{place.title}</span>
                  <span className="display shrink-0 text-[22px] text-lime">{tx.placeCount(place.count)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
      <p className="mt-2 max-w-2xl text-[13px] leading-snug text-faint">{tx.hint}</p>
    </Section>
  );
}
