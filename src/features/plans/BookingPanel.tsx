import { useState, type FormEvent } from "react";
import { IconCheck, IconInfo } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { ErrorState, Notice, Skeleton } from "@/components/ui/Feedback";
import { FormMessage, TextAreaField, TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { loadTexts, t } from "@/i18n";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { formatPlainDate, formatPlainTime, today, zonedParts } from "@/lib/time";
import type { Activity, BookingRequest, BookingStatus } from "@/lib/types";
import { goingHeads } from "@/lib/quorum";
import { PANEL_ITEM, StatusPill } from "./PlanPanel";
import { ACTIVE_BOOKING_STATUSES, useBookings, useCancelBooking, useConfirmBooking, useCreateBooking, useRecordBookingOutcome, type PlanWithParticipants } from "./api";

/** F10 · Texte der Planseiten-Karten kommen erst mit der Planseite. */
await loadTexts("planCards");

/** V2 Etappe 3g: Status als Pille – Lime gefüllt erst, wenn die Reservierung ausdrücklich bestätigt ist. */
const TONE: Record<BookingStatus, "glass" | "lime" | "amber" | "danger"> = {
  not_started: "glass",
  in_progress: "amber",
  awaiting_response: "amber",
  confirmed: "lime",
  unavailable: "danger",
  failed: "danger",
  cancelled_by_user: "glass",
};

type Outcome = "confirmed" | "awaiting_response" | "unavailable" | "failed";

function Summary({ booking, activity }: { booking: BookingRequest; activity: Activity | null }) {
  const rows: [string, string][] = [
    [t.planCards.booking.summary.provider, activity?.name ?? t.planCards.booking.summary.noProvider],
    [t.planCards.booking.summary.when, `${formatPlainDate(booking.requested_date, "long")}, ${formatPlainTime(booking.requested_time)}`],
    [t.planCards.booking.summary.partySize, t.people(booking.party_size)],
    [t.planCards.booking.summary.price, t.planCards.booking.summary.priceUnknown],
    [t.planCards.booking.summary.cancellation, t.planCards.booking.summary.cancellationUnknown],
  ];
  if (booking.special_requests) rows.splice(3, 0, [t.planCards.booking.summary.requests, booking.special_requests]);
  if (booking.provider_confirmation_reference) rows.push([t.planCards.booking.summary.reference, booking.provider_confirmation_reference]);
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
  // P51: Begleitung braucht auch einen Platz am Tisch.
  const going = goingHeads(plan.participants);
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
  const saved = () => toast.success(t.planCards.booking.saved);
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
        <p className="text-[15px] text-muted">{canManage ? (plan.status === "proposed" ? t.planCards.booking.needsConfirmedPlan : t.planCards.booking.none) : t.planCards.booking.noneMember}</p>
      ) : (
        <div
          data-testid="booking-card"
          className={cn(PANEL_ITEM, "p-4", latest.status === "confirmed" && "border-lime/50 bg-lime/[0.04]")}
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <StatusPill tone={TONE[latest.status]} testId="booking-status">
              {latest.status === "confirmed" && <IconCheck className="size-3.5" aria-hidden />}
              {t.enums.bookingStatus[latest.status]}
            </StatusPill>
            {latest.is_test && <StatusPill tone="amber">{t.states.demo}</StatusPill>}
            {latest.status === "not_started" && <span className="text-[13px] text-muted">{t.planCards.booking.draftHint}</span>}
          </div>
          <Summary booking={latest} activity={activity} />
          {latest.status === "confirmed" && <p className="mt-3 text-[13px] text-faint">{t.planCards.booking.recordedBy}</p>}

          {canManage && latest.status === "not_started" && (
            <div className="mt-4 flex flex-wrap gap-2.5">
              <Button onClick={() => setConfirmStart(latest)}>{t.planCards.booking.confirmStart}</Button>
              <Button variant="ghost" loading={cancel.isPending} onClick={() => cancel.mutate(latest.id, { onSuccess: saved, onError: failed })}>
                {t.planCards.booking.discard}
              </Button>
            </div>
          )}

          {canManage && (latest.status === "in_progress" || latest.status === "awaiting_response") && (
            <form
              className="mt-4 space-y-3 border-t border-white/10 pt-4"
              onSubmit={(event) => {
                event.preventDefault();
                record.mutate({ bookingId: latest.id, status: outcome, reference: outcome === "confirmed" ? reference : null }, { onSuccess: saved, onError: failed });
              }}
            >
              <fieldset>
                <legend className="mb-2 text-sm font-semibold text-fg">{t.planCards.booking.outcomeTitle}</legend>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ["confirmed", t.planCards.booking.outcomeConfirmed],
                      ["awaiting_response", t.planCards.booking.outcomeAwaiting],
                      ["unavailable", t.planCards.booking.outcomeUnavailable],
                      ["failed", t.planCards.booking.outcomeFailed],
                    ] as [Outcome, string][]
                  ).map(([value, label]) => (
                    // V2: Antworten des Anbieters als Pillen; die gewählte trägt den Lime-Rand.
                    <label key={value} className={cn("flex min-h-11 cursor-pointer items-center gap-2.5 rounded-full border px-3.5 text-sm font-semibold transition-colors", outcome === value ? "border-lime bg-lime/10 text-fg" : "border-white/15 bg-white/[0.04] text-muted hover:border-white/30")}>
                      <input type="radio" name="outcome" value={value} checked={outcome === value} onChange={() => setOutcome(value)} className="size-4 shrink-0 accent-[var(--color-lime)]" />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
              {outcome === "confirmed" && <TextField label={t.planCards.booking.reference} name="reference" value={reference} onChange={(e) => setReference(e.target.value)} hint={t.planCards.booking.referenceHint} maxLength={120} optional />}
              <div className="flex flex-wrap gap-2.5">
                <Button type="submit" loading={record.isPending}>
                  {t.planCards.booking.saveOutcome}
                </Button>
                <Button variant="ghost" loading={cancel.isPending} onClick={() => cancel.mutate(latest.id, { onSuccess: saved, onError: failed })}>
                  {t.planCards.booking.cancelRequest}
                </Button>
              </div>
            </form>
          )}

          {canManage && latest.status === "confirmed" && planOpen && (
            <div className="mt-4 border-t border-white/10 pt-4">
              <Button variant="secondary" size="sm" loading={cancel.isPending} onClick={() => cancel.mutate(latest.id, { onSuccess: saved, onError: failed })}>
                {t.planCards.booking.cancelConfirmed}
              </Button>
              <p className="mt-2 text-[13px] text-faint">{t.planCards.booking.cancelConfirmedHint}</p>
            </div>
          )}
        </div>
      )}

      {canManage && !active && latest?.status !== "confirmed" && (plan.status === "confirmed" || plan.status === "booking_pending") && (
        <Button variant="secondary" onClick={openForm}>
          {latest ? t.planCards.booking.prepareAnother : t.planCards.booking.prepare}
        </Button>
      )}

      {canManage && planOpen && (
        <Notice icon={<IconInfo aria-hidden />} title={t.planCards.booking.manualTitle}>
          {t.planCards.booking.manualBody} <span className="text-faint">{t.planCards.booking.automationNote}</span>
        </Notice>
      )}
      {activity?.is_demo && planOpen && <p className="text-[13px] leading-snug text-amber">{t.planCards.booking.testMode}</p>}

      <Dialog open={formOpen} onClose={() => setFormOpen(false)} title={t.planCards.booking.form.title} description={t.planCards.booking.form.body} size="sm">
        <form onSubmit={submitForm} noValidate className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <TextField label={t.planCards.booking.form.date} name="booking_date" type="date" min={today()} value={date} onChange={(e) => setDate(e.target.value)} required />
            <TextField label={t.planCards.booking.form.time} name="booking_time" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
          </div>
          <TextField label={t.planCards.booking.form.partySize} name="party_size" type="number" inputMode="numeric" min={1} max={100} value={partySize} onChange={(e) => setPartySize(e.target.value)} required />
          <TextAreaField label={t.planCards.booking.form.requests} name="special_requests" value={requests} onChange={(e) => setRequests(e.target.value)} placeholder={t.planCards.booking.form.requestsPlaceholder} maxLength={500} rows={2} optional />
          {formError && <FormMessage>{formError}</FormMessage>}
          <Button type="submit" block loading={create.isPending}>
            {t.planCards.booking.form.submit}
          </Button>
        </form>
      </Dialog>

      <ConfirmDialog
        open={Boolean(confirmStart)}
        onClose={() => setConfirmStart(null)}
        title={t.planCards.booking.confirmStartTitle}
        description={t.planCards.booking.confirmStartBody}
        confirmLabel={t.planCards.booking.confirmStart}
        loading={confirm.isPending}
        error={confirm.isError ? errorMessage(confirm.error) : null}
        onConfirm={() => {
          if (confirmStart) confirm.mutate(confirmStart.id, { onSuccess: () => { setConfirmStart(null); saved(); } });
        }}
      />
    </div>
  );
}
