import { useMutation } from "@tanstack/react-query";
import { useMemo } from "react";
import { IconShare } from "@/components/icons";
import { Section } from "@/components/layout/Page";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import type { PlanWithParticipants } from "@/features/plans/api";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { crewRecap, type CrewRecap as Recap } from "@/lib/recap";
import { recapCardFileName, recapCardModel, type RecapCardFact } from "@/lib/recapcard";
import { formatMonthYear } from "@/lib/time";
import { RECAP_IMAGE_BAR_MAX, renderRecapImage } from "./recapImage";

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
            <span className="display text-[46px] leading-[0.85] text-lime sm:text-[55px]">{recap.evenings}</span>
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
                  <dd className="display mt-0.5 text-[16px] text-fg">{fact.value}</dd>
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
                  <span aria-hidden className="display w-5 text-[14px] text-faint">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-semibold text-fg">{place.title}</span>
                  <span className="display shrink-0 text-[16px] text-lime">{tx.placeCount(place.count)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
      <div className="mt-3 flex max-w-2xl flex-wrap items-center gap-x-4 gap-y-2">
        <RecapShareButton recap={recap} />
        <p className="text-[13px] leading-snug text-faint">{tx.share.privacy}</p>
      </div>
      <p className="mt-2 max-w-2xl text-[13px] leading-snug text-faint">{tx.hint}</p>
    </Section>
  );
}

function factText(fact: RecapCardFact): { label: string; value: string } {
  if (fact.kind === "streak") return { label: tx.streak, value: tx.streakValue(fact.value) };
  if (fact.kind === "round") return { label: tx.biggestRound, value: tx.biggestRoundValue(fact.value) };
  return { label: tx.favoriteDay, value: tx.weekdays[fact.value] ?? "" };
}

/** Adresse fürs Bild nur, wenn die echte Adresse feststeht (sonst stünde dort „127.0.0.1“). */
function publicHost(): string {
  const configured = import.meta.env.VITE_SITE_URL?.trim();
  if (!configured) return "";
  try {
    return new URL(configured).host;
  } catch {
    return "";
  }
}

/**
 * P9 Etappe 2 · Rückblick als Bild zum Teilen: entsteht im Browser (Canvas), nur Zahlen – keine Namen,
 * keine Crew-Bezeichnung, keine Orte. Mit Teilen-Menü (Dateien) ins Teilen, sonst als Download.
 */
function RecapShareButton({ recap }: { recap: Recap }) {
  const toast = useToast();
  const share = useMutation({
    mutationFn: async (): Promise<"shared" | "cancelled" | "downloaded"> => {
      const model = recapCardModel(recap, RECAP_IMAGE_BAR_MAX);
      const blob = await renderRecapImage(model, {
        kicker: tx.share.kicker,
        eveningsLabel: tx.evenings(model.evenings),
        since: model.firstAt ? tx.since(formatMonthYear(model.firstAt)) : null,
        facts: model.facts.map(factText),
        monthsTitle: tx.monthsTitle,
        monthLetters: model.bars.map((bar) => narrowMonth.format(monthDate(bar.key))),
        footer: tx.share.footer,
        host: publicHost(),
      });
      const name = recapCardFileName(new Date());
      const file = new File([blob], name, { type: "image/png" });
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: tx.share.kicker, text: tx.share.text });
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
