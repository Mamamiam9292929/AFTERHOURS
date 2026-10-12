import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { FormMessage, TextAreaField, TextField } from "@/components/ui/Field";
import { t } from "@/i18n";
import { centsToInput, parseEuroInput } from "@/lib/format";
import { addDays, today, zonedParts, zonedToUtc } from "@/lib/time";
import type { PlanFormValues } from "./api";

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
}

/** Gemeinsames Formular für "Plan erstellen" und "Plan bearbeiten". */
export function PlanForm({ initial, submitLabel, pending, error, onSubmit, before, after, allowUnchangedPast = false }: PlanFormProps) {
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

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      {before}
      <TextField label={t.plans.create.planTitle} name="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t.plans.create.planTitlePlaceholder} maxLength={120} error={errors.title} required />
      <div className="grid grid-cols-2 gap-4">
        <TextField label={t.plans.create.date} name="date" type="date" min={allowUnchangedPast ? undefined : today()} max={addDays(today(), 730)} value={date} onChange={(e) => setDate(e.target.value)} error={errors.when} required />
        <TextField label={t.plans.create.time} name="time" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
      </div>
      <TextField label={t.plans.create.address} name="address" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} autoComplete="off" optional />
      <TextField label={t.plans.create.meetingPoint} name="meeting_point" value={meetingPoint} onChange={(e) => setMeetingPoint(e.target.value)} placeholder={t.plans.create.meetingPointPlaceholder} maxLength={160} optional />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={t.plans.create.cost} name="cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} error={errors.cost} hint={t.plans.create.costHint} trailing={<span className="pr-3 text-muted">€</span>} optional />
        <TextField label={t.plans.create.totalCost} name="total_cost" inputMode="decimal" value={totalCost} onChange={(e) => setTotalCost(e.target.value)} error={errors.totalCost} hint={t.plans.create.totalCostHint} trailing={<span className="pr-3 text-muted">€</span>} optional />
      </div>
      <TextAreaField label={t.plans.create.notes} name="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t.plans.create.notesPlaceholder} maxLength={2000} optional />
      {after}
      {error && <FormMessage>{error}</FormMessage>}
      <Button type="submit" size="lg" block loading={pending}>
        {submitLabel}
      </Button>
    </form>
  );
}
