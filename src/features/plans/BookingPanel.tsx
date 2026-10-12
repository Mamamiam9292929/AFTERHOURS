import { useState, type FormEvent } from "react";
import { IconInfo } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { Badge, ErrorState, Notice, Skeleton } from "@/components/ui/Feedback";
import { FormMessage, TextAreaField, TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { formatPlainDate, formatPlainTime, today, zonedParts } from "@/lib/time";
import type { Activity, BookingRequest, BookingStatus } from "@/lib/types";
import { ACTIVE_BOOKING_STATUSES, useBookings, useCancelBooking, useConfirmBooking, useCreateBooking, useRecordBookingOutcome, type PlanWithParticipants } from "./api";

const TONE: Record<BookingStatus, "neutral" | "lime" | "amber" | "danger"> = {
  not_started: "neutral",
  in_progress: "amber",
  awaiting_response: "amber",
  confirmed: "lime",
  unavailable: "danger",
  failed: "danger",
  cancelled_by_user: "neutral",
};

type Outcome = "confirmed" | "awaiting_response" | "unavailable" | "failed";

function Summary({ booking, activity }: { booking: BookingRequest; activity: Activity | null }) {
  const rows: [string, string][] = [
    [t.plans.booking.summary.provider, activity?.name ?? t.plans.booking.summary.noProvider],
    [t.plans.booking.summary.when, `${formatPlainDate(booking.requested_date, "long")}, ${formatPlainTime(booking.requested_time)}`],
    [t.plans.booking.summary.partySize, t.people(booking.party_size)],
    [t.plans.booking.summary.price, t.plans.booking.summary.priceUnknown],
    [t.plans.booking.summary.cancellation, t.plans.booking.summary.cancellationUnknown],
  ];
  if (booking.special_requests) rows.splice(3, 0, [t.plans.booking.summary.requests, booking.special_requests]);
  if (booking.provider_confirmation_reference) rows.push([t.plans.booking.summary.reference, booking.provider_confirmation_reference]);
  return (
    <dl className="space-y-1.5 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4">
          <dt className="shrink-0 text-muted">{label}</dt>
          <dd className="min-w-0 break-words text-right text-fg">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Reservierungs-Workflow des MVP. Die App löst nichts automatisch aus: Die organisierende Person
 * fragt selbst beim Anbieter an und hält den Stand hier fest. "Bestätigt" erscheint nur, wenn sie
 * das ausdrücklich einträgt.
 */
export function BookingPanel({ plan, activity, canManage }: { plan: PlanWithParticipants; activity: Activity | null; canManage: boolean }) {
  const toast = useToast();
  const bookings = useBookings(plan.id);
  const create = useCreateBooking(plan.id);
  const confirm = useConfirmBooking(plan.id);
  const record = useRecordBookingOutcome(plan.id);
  const cancel = useCancelBooking(plan.id);
  const [formOpen, setFormOpen] = useState(false);
  const [confirmStart, setConfirmStart] = useState<BookingRequest | null>(null);
  const [outcome, setOutcome] = useState<Outcome>("confirmed");
  const [reference, setReference] = useState("");

  const start = zonedParts(plan.starts_at);
  const going = plan.participants.filter((p) => p.attendance_status === "going").length;
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  const [partySize, setPartySize] = useState(String(Math.max(going, 1)));
  const [requests, setRequests] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  if (bookings.isPending) return <Skeleton className="h-20" />;
  if (bookings.isError) return <ErrorState error={bookings.error} onRetry={() => void bookings.refetch()} />;

  const latest = bookings.data[0] ?? null;
  const active = latest && ACTIVE_BOOKING_STATUSES.includes(latest.status) ? latest : null;
  const planOpen = plan.status === "confirmed" || plan.status === "booking_pending" || plan.status === "booked";
  const saved = () => toast.success(t.plans.booking.saved);
  const failed = (error: unknown) => toast.error(error);

  function openForm() {
    setDate(start.date >= today() ? start.date : today());
    setTime(start.time);
    setPartySize(String(Math.max(going, 1)));
    setRequests("");
    setFormError(null);
    setFormOpen(true);
  }

  function submitForm(event: FormEvent) {
    event.preventDefault();
    const size = Number(partySize);
    if (!date || !time || !Number.isInteger(size) || size < 1 || size > 100) {
      setFormError(t.errors.codes.invalid_booking);
      return;
    }
    create.mutate(
      { date, time, partySize: size, specialRequests: requests.trim() || null },
      { onSuccess: () => setFormOpen(false), onError: (error) => setFormError(errorMessage(error)) },
    );
  }

  return (
    <div className="space-y-3">
      {!latest ? (
        <p className="text-[15px] text-muted">{canManage ? (plan.status === "proposed" ? t.plans.booking.needsConfirmedPlan : t.plans.booking.none) : t.plans.booking.noneMember}</p>
      ) : (
        <div className={cn("rounded-card border bg-surface p-4", latest.status === "confirmed" ? "border-lime/60" : "border-line")}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge tone={TONE[latest.status]}>{t.enums.bookingStatus[latest.status]}</Badge>
            {latest.is_test && <Badge tone="outline" className="border-amber/50 text-amber">{t.states.demo}</Badge>}
            {latest.status === "not_started" && <span className="text-[13px] text-muted">{t.plans.booking.draftHint}</span>}
          </div>
          <Summary booking={latest} activity={activity} />
          {latest.status === "confirmed" && <p className="mt-3 text-[13px] text-faint">{t.plans.booking.recordedBy}</p>}

          {canManage && latest.status === "not_started" && (
            <div className="mt-4 flex flex-wrap gap-2.5">
              <Button onClick={() => setConfirmStart(latest)}>{t.plans.booking.confirmStart}</Button>
              <Button variant="ghost" loading={cancel.isPending} onClick={() => cancel.mutate(latest.id, { onSuccess: saved, onError: failed })}>
                {t.plans.booking.discard}
              </Button>
            </div>
          )}

          {canManage && (latest.status === "in_progress" || latest.status === "awaiting_response") && (
            <form
              className="mt-4 space-y-3 border-t border-line pt-4"
              onSubmit={(event) => {
                event.preventDefault();
                record.mutate({ bookingId: latest.id, status: outcome, reference: outcome === "confirmed" ? reference : null }, { onSuccess: saved, onError: failed });
              }}
            >
              <fieldset>
                <legend className="mb-2 text-sm font-semibold text-fg">{t.plans.booking.outcomeTitle}</legend>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ["confirmed", t.plans.booking.outcomeConfirmed],
                      ["awaiting_response", t.plans.booking.outcomeAwaiting],
                      ["unavailable", t.plans.booking.outcomeUnavailable],
                      ["failed", t.plans.booking.outcomeFailed],
                    ] as [Outcome, string][]
                  ).map(([value, label]) => (
                    <label key={value} className={cn("flex min-h-11 cursor-pointer items-center gap-2.5 rounded-control border px-3 text-sm font-medium", outcome === value ? "border-lime bg-lime/5 text-fg" : "border-line text-muted")}>
                      <input type="radio" name="outcome" value={value} checked={outcome === value} onChange={() => setOutcome(value)} className="size-4 shrink-0 accent-[var(--color-lime)]" />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
              {outcome === "confirmed" && <TextField label={t.plans.booking.reference} name="reference" value={reference} onChange={(e) => setReference(e.target.value)} hint={t.plans.booking.referenceHint} maxLength={120} optional />}
              <div className="flex flex-wrap gap-2.5">
                <Button type="submit" loading={record.isPending}>
                  {t.plans.booking.saveOutcome}
                </Button>
                <Button variant="ghost" loading={cancel.isPending} onClick={() => cancel.mutate(latest.id, { onSuccess: saved, onError: failed })}>
                  {t.plans.booking.cancelRequest}
                </Button>
              </div>
            </form>
          )}

          {canManage && latest.status === "confirmed" && planOpen && (
            <div className="mt-4 border-t border-line pt-4">
              <Button variant="secondary" size="sm" loading={cancel.isPending} onClick={() => cancel.mutate(latest.id, { onSuccess: saved, onError: failed })}>
                {t.plans.booking.cancelConfirmed}
              </Button>
              <p className="mt-2 text-[13px] text-faint">{t.plans.booking.cancelConfirmedHint}</p>
            </div>
          )}
        </div>
      )}

      {canManage && !active && latest?.status !== "confirmed" && (plan.status === "confirmed" || plan.status === "booking_pending") && (
        <Button variant="secondary" onClick={openForm}>
          {latest ? t.plans.booking.prepareAnother : t.plans.booking.prepare}
        </Button>
      )}

      {canManage && planOpen && (
        <Notice icon={<IconInfo aria-hidden />} title={t.plans.booking.manualTitle}>
          {t.plans.booking.manualBody} <span className="text-faint">{t.plans.booking.automationNote}</span>
        </Notice>
      )}
      {activity?.is_demo && planOpen && <p className="text-[13px] leading-snug text-amber">{t.plans.booking.testMode}</p>}

      <Dialog open={formOpen} onClose={() => setFormOpen(false)} title={t.plans.booking.form.title} description={t.plans.booking.form.body} size="sm">
        <form onSubmit={submitForm} noValidate className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <TextField label={t.plans.booking.form.date} name="booking_date" type="date" min={today()} value={date} onChange={(e) => setDate(e.target.value)} required />
            <TextField label={t.plans.booking.form.time} name="booking_time" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
          </div>
          <TextField label={t.plans.booking.form.partySize} name="party_size" type="number" inputMode="numeric" min={1} max={100} value={partySize} onChange={(e) => setPartySize(e.target.value)} required />
          <TextAreaField label={t.plans.booking.form.requests} name="special_requests" value={requests} onChange={(e) => setRequests(e.target.value)} placeholder={t.plans.booking.form.requestsPlaceholder} maxLength={500} rows={2} optional />
          {formError && <FormMessage>{formError}</FormMessage>}
          <Button type="submit" block loading={create.isPending}>
            {t.plans.booking.form.submit}
          </Button>
        </form>
      </Dialog>

      <ConfirmDialog
        open={Boolean(confirmStart)}
        onClose={() => setConfirmStart(null)}
        title={t.plans.booking.confirmStartTitle}
        description={t.plans.booking.confirmStartBody}
        confirmLabel={t.plans.booking.confirmStart}
        loading={confirm.isPending}
        error={confirm.isError ? errorMessage(confirm.error) : null}
        onConfirm={() => {
          if (confirmStart) confirm.mutate(confirmStart.id, { onSuccess: () => { setConfirmStart(null); saved(); } });
        }}
      />
    </div>
  );
}
