import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { IconShare } from "@/components/icons";
import { Section } from "@/components/layout/Page";
import { Button } from "@/components/ui/Button";
import { LivePill } from "@/components/ui/Pill";
import { useToast } from "@/components/ui/Toast";
import type { PlanWithParticipants } from "@/features/plans/api";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { crewRecap, crewYearRecap, recapYearChoice, type CrewRecap as Recap } from "@/lib/recap";
import { recapCardFileName, recapCardModel, type RecapCardFact } from "@/lib/recapcard";
import { APP_LOCALE, formatMonthYear } from "@/lib/time";
import { RECAP_IMAGE_BAR_MAX, renderRecapImage } from "./recapImage";

const tx = t.crews.recap;
const narrowMonth = new Intl.DateTimeFormat(APP_LOCALE, { month: "narrow", timeZone: "UTC" });
const monthDate = (key: string) => new Date(`${key}-15T12:00:00Z`);

type View = "all" | "year";

/**
 * P9 · Crew-Rückblick: gemeinsame Abende, seit wann, längste Serie, größte Runde, Lieblingstag,
 * die Monate als Balken und die Stammorte. Erscheint ab dem ersten abgeschlossenen Plan;
 * gerechnet wird im Browser aus den Plänen, die die Crew ohnehin sieht (src/lib/recap.ts).
 *
 * V2: eine Karte auf dem Stapel (wie Punktestand und Stammkarte) – Zahl in Chrom, Fakten als
 * Glas-Kacheln, Monate als leuchtende Balken, Stammorte als Glas-Zeilen.
 * Etappe 3 · „Euer Jahr“: Hat die Crew Abende im laufenden Jahr, wechselt eine Pille zwischen
 * „Insgesamt“ und dem Jahr (Januar bis Dezember). Im Dezember – und bis zum 15. Januar für das
 * alte Jahr – öffnet der Rückblick gleich als „Euer Jahr“.
 */
export function CrewRecap({ plans }: { plans: readonly PlanWithParticipants[] }) {
  const choice = useMemo(() => recapYearChoice(plans), [plans]);
  const [picked, setPicked] = useState<View | null>(null);
  const view: View = choice ? (picked ?? (choice.highlight ? "year" : "all")) : "all";
  const year = view === "year" && choice ? choice.year : null;
  const recap = useMemo(() => (year === null ? crewRecap(plans) : crewYearRecap(plans, year)), [plans, year]);
  if (recap.evenings === 0) return null;

  const max = Math.max(1, ...recap.months.map((m) => m.count));
  const facts = [
    recap.longestStreak >= 2 ? { label: tx.streak, value: tx.streakValue(recap.longestStreak) } : null,
    recap.biggestRound >= 2 ? { label: tx.biggestRound, value: tx.biggestRoundValue(recap.biggestRound) } : null,
    recap.favoriteWeekday !== null ? { label: tx.favoriteDay, value: tx.weekdays[recap.favoriteWeekday] ?? "" } : null,
  ].filter((f): f is { label: string; value: string } => f !== null);
  const monthsTitle = year === null ? tx.monthsTitle : tx.yearMonthsTitle(year);

  const viewSwitch = choice && (
    <div role="group" aria-label={tx.viewLabel} className="inline-flex shrink-0 rounded-full border border-white/15 bg-white/[0.06] p-1" data-testid="recap-view">
      {(
        [
          ["all", tx.viewAll],
          ["year", String(choice.year)],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          aria-pressed={view === value}
          onClick={() => setPicked(value)}
          className={cn(
            "h-8 rounded-full px-3.5 text-[13px] font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime",
            view === value ? "bg-lime text-lime-ink" : "text-muted hover:text-fg",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <Section title={tx.title} action={viewSwitch}>
      <div className="ticket-feature-wrap max-w-2xl" data-testid="crew-recap" data-view={view}>
        <div className="vote-card overflow-hidden rounded-[32px] p-5 sm:p-7">
          <span aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-lime/15 blur-3xl" />
          <span aria-hidden className="pointer-events-none absolute -bottom-24 -left-16 size-56 rounded-full bg-violet/25 blur-3xl" />
          <div className="relative">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h3 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-faint" data-testid="recap-heading">
                {year === null ? tx.allTitle : tx.yearTitle(year)}
              </h3>
              {year !== null && choice?.highlight && <LivePill className="h-7 px-3 text-[12px]">{tx.yearEnd}</LivePill>}
            </div>
            <p className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-1" data-testid="recap-evenings">
              <span className="display chrome text-[64px] leading-[0.9] sm:text-[84px]">{recap.evenings}</span>
              <span className="pb-1.5 text-[16px] font-semibold leading-tight text-fg">
                {tx.evenings(recap.evenings)}
                <span className="block text-[13px] font-medium text-muted">
                  {year !== null ? tx.inYear(year) : recap.firstAt ? tx.since(formatMonthYear(recap.firstAt)) : null}
                </span>
              </span>
            </p>

            {facts.length > 0 && (
              <dl className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {facts.map((fact) => (
                  <div key={fact.label} className="min-w-0 rounded-[18px] border border-white/[0.12] bg-white/[0.05] px-3.5 py-3">
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{fact.label}</dt>
                    <dd className="display mt-1 break-words text-[15px] text-fg">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            <h4 className="mt-6 text-[13px] font-medium text-muted">{monthsTitle}</h4>
            <ol className="mt-3 grid h-24 grid-cols-12 items-end gap-[3px]" aria-label={monthsTitle}>
              {recap.months.map((month) => {
                const label = tx.monthBar(formatMonthYear(monthDate(month.key)), month.count);
                return (
                  <li key={month.key} className="flex h-full flex-col items-center justify-end gap-1.5" title={label}>
                    <span className="sr-only">{label}</span>
                    <span
                      aria-hidden
                      className={cn("w-full max-w-5 rounded-t-[5px]", month.count > 0 ? "bg-lime shadow-[0_0_14px_color-mix(in_srgb,var(--color-lime)_45%,transparent)]" : "bg-white/15")}
                      style={{ height: month.count > 0 ? `${Math.max(8, Math.round((month.count / max) * 72))}px` : "2px" }}
                    />
                    <span aria-hidden className="text-[11px] font-medium leading-none text-muted">
                      {narrowMonth.format(monthDate(month.key))}
                    </span>
                  </li>
                );
              })}
            </ol>

            {recap.places.length > 0 && (
              <>
                <h4 className="mt-6 text-[13px] font-medium text-muted">{tx.places}</h4>
                <ol className="mt-2 grid gap-1.5">
                  {recap.places.map((place, index) => (
                    <li key={place.key} className="flex items-center gap-3 rounded-[16px] border border-white/[0.1] bg-white/[0.04] px-3.5 py-2.5">
                      <span aria-hidden className="display w-5 text-[14px] text-faint">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-semibold text-fg">{place.title}</span>
                      <span className="display shrink-0 text-[16px] text-lime">{tx.placeCount(place.count)}</span>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="mt-4 flex max-w-2xl flex-wrap items-center gap-x-4 gap-y-2">
        <RecapShareButton recap={recap} year={year} />
        <p className="text-[13px] leading-snug text-faint">{tx.share.privacy}</p>
      </div>
      <p className="mt-2 max-w-2xl text-[13px] leading-snug text-faint">{year === null ? tx.hint : tx.yearHint(year)}</p>
    </Section>
  );
}

function factText(fact: RecapCardFact): { label: string; value: string } {
  if (fact.kind === "streak") return { label: tx.streak, value: tx.streakValue(fact.value) };
  if (fact.kind === "round") return { label: tx.biggestRound, value: tx.biggestRoundValue(fact.value) };
  return { label: tx.favoriteDay, value: tx.weekdays[fact.value] ?? "" };
}

/** Adresse fürs Bild nur, wenn die echte, öffentliche Adresse feststeht. */
function publicHost(): string {
  const configured = import.meta.env.VITE_SITE_URL?.trim();
  if (!configured) return "";
  try {
    const url = new URL(configured);
    // Lokale Test-Adressen gehören nicht auf ein Bild, das in Chats landet.
    return /^(localhost|127\.|\[?::1\]?$)/.test(url.hostname) ? "" : url.host;
  } catch {
    return "";
  }
}

/**
 * P9 Etappe 2 · Rückblick als Bild zum Teilen: entsteht im Browser (Canvas), nur Zahlen – keine Namen,
 * keine Crew-Bezeichnung, keine Orte. Mit Teilen-Menü (Dateien) ins Teilen, sonst als Download.
 * Etappe 3: In der Jahresansicht „Unser Jahr 2026“ mit Januar bis Dezember.
 */
function RecapShareButton({ recap, year }: { recap: Recap; year: number | null }) {
  const toast = useToast();
  const share = useMutation({
    mutationFn: async (): Promise<"shared" | "cancelled" | "downloaded"> => {
      const model = recapCardModel(recap, RECAP_IMAGE_BAR_MAX);
      const blob = await renderRecapImage(model, {
        kicker: year === null ? tx.share.kicker : tx.share.yearKicker(year),
        eveningsLabel: tx.evenings(model.evenings),
        since: year !== null ? tx.inYear(year) : model.firstAt ? tx.since(formatMonthYear(model.firstAt)) : null,
        facts: model.facts.map(factText),
        monthsTitle: year === null ? tx.monthsTitle : tx.yearMonthsTitle(year),
        monthLetters: model.bars.map((bar) => narrowMonth.format(monthDate(bar.key))),
        footer: tx.share.footer,
        host: publicHost(),
      });
      const name = recapCardFileName(new Date(), year ?? undefined);
      const file = new File([blob], name, { type: "image/png" });
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: year === null ? tx.share.kicker : tx.share.yearKicker(year),
            text: year === null ? tx.share.text : tx.share.yearText(year),
          });
          return "shared";
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
          // Teilen gescheitert: dann eben speichern.
        }
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return "downloaded";
    },
    onSuccess: (outcome) => {
      if (outcome === "downloaded") toast.success(tx.share.saved);
    },
    onError: () => toast.error(tx.share.failed),
  });

  return (
    <Button variant="secondary" size="sm" icon={<IconShare className="size-4" aria-hidden />} loading={share.isPending} onClick={() => share.mutate()} data-testid="recap-share">
      {share.isPending ? tx.share.working : tx.share.action}
    </Button>
  );
}
