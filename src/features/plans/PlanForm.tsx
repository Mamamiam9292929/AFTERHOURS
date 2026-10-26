import { useState, type FormEvent, type ReactNode } from "react";
import { IconCalendar, IconEdit, IconEuro, IconPin } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { FormMessage, TextAreaField, TextField } from "@/components/ui/Field";
import { FormCard } from "@/components/ui/FormCard";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { centsToInput, parseEuroInput } from "@/lib/format";
import { addDays, formatDateLong, formatTime, ticketDate, today, zonedParts, zonedToUtc } from "@/lib/time";
import type { PlanFormValues } from "./api";
import { planCountdown } from "./PlanTicket";

export interface PlanFormInitial {
  title?: string;
  startsAt?: string | null;
  address?: string | null;
  meetingPoint?: string | null;
  notes?: string | null;
  costPerPersonCents?: number | null;
  totalCostCents?: number | null;
}

interface PlanFormProps {
  initial: PlanFormInitial;
  submitLabel: string;
  pending: boolean;
  error?: string | null;
  onSubmit: (values: PlanFormValues) => void;
  /** Zusätzliche Felder oberhalb (z. B. Crew-Auswahl). */
  before?: ReactNode;
  /** Zusätzliche Felder unterhalb der Notizen. */
  after?: ReactNode;
  /** Beim Bearbeiten darf ein bereits vergangener, unveränderter Beginn stehen bleiben. */
  allowUnchangedPast?: boolean;
  /** Im Dialog: Abschnitte ohne eigene Karte (der Dialog ist schon eine Fläche). */
  flat?: boolean;
}

/**
 * Gemeinsames Formular für "Plan erstellen" und "Plan bearbeiten". Seit V2 Etappe 3m in Abschnitten als
 * Glas-Karten (Was & wann · Wo · Kosten · Noch was?); oben zeigt eine Datumskachel wie auf der Plan-Karte,
 * was gerade eingetragen ist.
 */
export function PlanForm({ initial, submitLabel, pending, error, onSubmit, before, after, allowUnchangedPast = false, flat = false }: PlanFormProps) {
  const start = initial.startsAt ? zonedParts(initial.startsAt) : null;
  const [title, setTitle] = useState(initial.title ?? "");
  const [date, setDate] = useState(start?.date ?? "");
  const [time, setTime] = useState(start?.time ?? "19:00");
  const [address, setAddress] = useState(initial.address ?? "");
  const [meetingPoint, setMeetingPoint] = useState(initial.meetingPoint ?? "");
  const [cost, setCost] = useState(centsToInput(initial.costPerPersonCents));
  const [totalCost, setTotalCost] = useState(centsToInput(initial.totalCostCents));
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  function submit(event: FormEvent) {
    event.preventDefault();
    const startsAt = date && time ? zonedToUtc(date, time) : null;
    const costCents = parseEuroInput(cost);
    const totalCents = parseEuroInput(totalCost);
    const unchanged = allowUnchangedPast && startsAt && initial.startsAt && new Date(initial.startsAt).getTime() === startsAt.getTime();
    const next: Record<string, string | null> = {
      title: title.trim().length < 2 ? t.validation.minLength(2) : null,
      when: !startsAt ? t.validation.dateRequired : startsAt.getTime() <= Date.now() && !unchanged ? t.validation.dateInPast : null,
      cost: costCents === undefined ? t.validation.amount : null,
      totalCost: totalCents === undefined ? t.validation.amount : null,
    };
    setErrors(next);
    if (Object.values(next).some(Boolean) || !startsAt) return;
    onSubmit({
      title: title.trim(),
      startsAt,
      address: address.trim() || null,
      meetingPoint: meetingPoint.trim() || null,
      notes: notes.trim() || null,
      costPerPersonCents: costCents ?? null,
      totalCostCents: totalCents ?? null,
    });
  }

  const preview = date && time ? zonedToUtc(date, time) : null;

  return (
    <form onSubmit={submit} noValidate className={flat ? "space-y-5" : "space-y-4"}>
      {before}
      <FormCard title={t.plans.create.sections.what} icon={<IconCalendar className="size-[18px]" />} tone="lime" flat={flat} testId="plan-form-what">
        <WhenPreview startsAt={preview} />
        <TextField label={t.plans.create.planTitle} name="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t.plans.create.planTitlePlaceholder} maxLength={120} error={errors.title} required />
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <TextField label={t.plans.create.date} name="date" type="date" min={allowUnchangedPast ? undefined : today()} max={addDays(today(), 730)} value={date} onChange={(e) => setDate(e.target.value)} error={errors.when} required />
          <TextField label={t.plans.create.time} name="time" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
        </div>
      </FormCard>
      <FormCard title={t.plans.create.sections.where} icon={<IconPin className="size-[18px]" />} tone="violet" flat={flat} testId="plan-form-where">
        <TextField label={t.plans.create.address} name="address" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} autoComplete="off" optional />
        <TextField label={t.plans.create.meetingPoint} name="meeting_point" value={meetingPoint} onChange={(e) => setMeetingPoint(e.target.value)} placeholder={t.plans.create.meetingPointPlaceholder} maxLength={160} optional />
      </FormCard>
      <FormCard title={t.plans.create.sections.money} icon={<IconEuro className="size-[18px]" />} tone="pink" flat={flat} testId="plan-form-money">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={t.plans.create.cost} name="cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} error={errors.cost} hint={t.plans.create.costHint} trailing={<span className="pr-3 text-muted">€</span>} optional />
          <TextField label={t.plans.create.totalCost} name="total_cost" inputMode="decimal" value={totalCost} onChange={(e) => setTotalCost(e.target.value)} error={errors.totalCost} hint={t.plans.create.totalCostHint} trailing={<span className="pr-3 text-muted">€</span>} optional />
        </div>
      </FormCard>
      <FormCard title={t.plans.create.sections.more} icon={<IconEdit className="size-[18px]" />} tone="violet" flat={flat} testId="plan-form-more">
        <TextAreaField label={t.plans.create.notes} name="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t.plans.create.notesPlaceholder} maxLength={2000} optional />
      </FormCard>
      {after}
      {error && <FormMessage>{error}</FormMessage>}
      <Button type="submit" size="lg" block loading={pending}>
        {submitLabel}
      </Button>
    </form>
  );
}

/**
 * Was gerade eingetragen ist – als Datumskachel wie auf der Plan-Karte („FR / 6 / NOV“), daneben Tag,
 * Uhrzeit und wie weit es weg ist. Ohne Datum steht dort ehrlich, dass es noch fehlt.
 */
function WhenPreview({ startsAt }: { startsAt: Date | null }) {
  const date = startsAt ? ticketDate(startsAt) : null;
  const countdown = startsAt && startsAt.getTime() > Date.now() ? planCountdown({ starts_at: startsAt.toISOString(), status: "proposed" }, new Date()) : null;
  return (
    <div className="flex items-center gap-3.5" data-testid="plan-form-when" data-filled={startsAt ? "true" : "false"}>
      <div aria-hidden className={cn("flex w-[62px] shrink-0 flex-col items-center justify-center rounded-[18px] py-2 text-center", startsAt ? "bg-lime text-lime-ink" : "border border-dashed border-white/25 text-muted")}>
        <span className="text-[11px] font-bold uppercase tracking-wide">{date?.weekday ?? "–"}</span>
        <span className="font-display text-[26px] font-extrabold leading-none">{date?.day ?? "?"}</span>
        <span className="text-[11px] font-bold uppercase tracking-wide">{date?.month ?? "–"}</span>
      </div>
      <div className="min-w-0">
        {startsAt ? (
          <>
            <p className="truncate font-semibold text-fg">{formatDateLong(startsAt)}</p>
            <p className="mt-0.5 text-[14px] text-muted">
              {formatTime(startsAt)}
              {countdown && <span className="ml-2 font-display text-[12px] font-extrabold uppercase tracking-wide text-lime">{countdown}</span>}
            </p>
          </>
        ) : (
          <p className="text-[14px] leading-snug text-muted">{t.plans.create.whenMissing}</p>
        )}
      </div>
    </div>
  );
}
