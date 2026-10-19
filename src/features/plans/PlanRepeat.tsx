import { useState } from "react";
import { Link } from "react-router-dom";
import { IconRepeat } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { t } from "@/i18n";
import { latestInSeries, nextOccurrence, repeatAnchor, repeatOptions, type PlanSeries, type RepeatRule } from "@/lib/repeat";
import { formatDateLong, formatPlainDate } from "@/lib/time";
import { useSetPlanRepeat, type PlanWithParticipants } from "./api";

/** „Jeden 1. Freitag im Monat“ – Regel einer aktiven Serie in Worten. */
export function repeatLabel(series: Pick<PlanSeries, "rule" | "weekday" | "nth">): string {
  return t.plans.repeat.rule(series.rule, series.weekday, series.nth);
}

/** P8: Zeile unter „Wann?“ – für alle Mitglieder sichtbar, solange die Serie läuft. */
export function RepeatLine({ series }: { series: PlanSeries | null | undefined }) {
  if (!series?.active) return null;
  return (
    <span className="mt-1.5 flex w-fit items-center gap-1.5 text-sm font-semibold text-lime" data-testid="repeat-line">
      <IconRepeat className="size-4" aria-hidden />
      {repeatLabel(series)}
    </span>
  );
}

/**
 * P8: Wiederholung einstellen (Organisator:in, Owner, Admins). Die Regel richtet sich am letzten Termin der
 * Serie aus; ist er vorbei, legt der Server den nächsten an – mit Titel, Ort und Uhrzeit des letzten.
 */
export function RepeatCard({ plan, plans }: { plan: PlanWithParticipants; plans: readonly PlanWithParticipants[] }) {
  const toast = useToast();
  const setRepeat = useSetPlanRepeat(plan.id);
  const series = plan.series ?? null;
  const latest = (series && latestInSeries(plans, series.id)) ?? plan;
  const anchor = repeatAnchor(latest.starts_at);
  const current: RepeatRule | "none" = series?.active ? series.rule : "none";
  const options = repeatOptions(anchor);
  if (current !== "none" && !options.includes(current)) options.push(current);
  const [choice, setChoice] = useState<RepeatRule | "none">(current);
  const [shownFor, setShownFor] = useState(current);
  // Ändert sich die Serie von außen (andere Person, neu geladen), folgt die Auswahl.
  if (shownFor !== current) {
    setShownFor(current);
    setChoice(current);
  }
  const anchorNth = anchor.nth <= 4 ? anchor.nth : null;
  const next = series?.active ? nextOccurrence(series.rule, series.weekday, series.nth, series.last_on) : null;
  const laterExists = latest.id !== plan.id;

  function save() {
    setRepeat.mutate(choice === "none" ? null : choice, {
      onSuccess: () => toast.success(choice === "none" ? t.plans.repeat.stopped : t.plans.repeat.saved),
      onError: (error) => toast.error(error),
    });
  }

  return (
    <section aria-labelledby="repeat-heading" className="mt-4 rounded-card border border-line bg-surface p-4">
      <h2 id="repeat-heading" className="mb-1 flex items-center gap-2 text-[17px] font-bold text-fg">
        <IconRepeat className="size-[18px] text-muted" aria-hidden />
        {t.plans.repeat.title}
      </h2>
      <p className="mb-3 text-[13px] leading-snug text-muted">{t.plans.repeat.intro}</p>
      <SelectField label={t.plans.repeat.label} value={choice} onChange={(event) => setChoice(event.target.value as RepeatRule | "none")}>
        <option value="none">{t.plans.repeat.none}</option>
        {options.map((rule) => (
          <option key={rule} value={rule}>
            {t.plans.repeat.rule(rule, anchor.weekday, rule === "monthly_nth" ? (series?.rule === "monthly_nth" ? series.nth : anchorNth) : null)}
          </option>
        ))}
      </SelectField>
      <Button className="mt-3" block variant="secondary" disabled={choice === current} loading={setRepeat.isPending} onClick={save}>
        {t.plans.repeat.save}
      </Button>
      {series?.active && next && !laterExists && <p className="mt-3 text-[13px] leading-snug text-muted">{t.plans.repeat.next(formatPlainDate(next, "long"))}</p>}
      {series && laterExists && (
        <p className="mt-3 text-[13px] leading-snug text-muted">
          {t.plans.repeat.hasNext}{" "}
          <Link to={`/plans/${latest.id}`} className="font-semibold text-fg underline decoration-line-strong underline-offset-4 hover:decoration-lime">
            {formatDateLong(latest.starts_at)}
          </Link>
        </p>
      )}
      {series && !series.active && <p className="mt-3 text-[13px] leading-snug text-faint">{t.plans.repeat.stoppedNote}</p>}
    </section>
  );
}
