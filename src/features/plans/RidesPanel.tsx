import { useState, type FormEvent } from "react";
import { IconCar } from "@/components/icons";
import { Avatar, type Person } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState, Skeleton } from "@/components/ui/Feedback";
import { FormMessage, TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { formatDateTime, fromLocalInputValue, toLocalInputValue } from "@/lib/time";
import { PANEL_ITEM, StatusPill } from "./PlanPanel";
import { useCancelRideOffer, useCancelRideRequest, useOfferRide, useRequestRide, useRespondRide, useRides, type PlanWithParticipants } from "./api";

interface RidesPanelProps {
  plan: PlanWithParticipants;
  userId: string;
  locked: boolean;
  lookup: (id: string | null | undefined) => Person | null;
}

/** Fahrgemeinschaften: freiwilliges Angebot, Anfrage, Zusage durch die fahrende Person. */
export function RidesPanel({ plan, userId, locked, lookup }: RidesPanelProps) {
  const toast = useToast();
  const rides = useRides(plan.id);
  const offer = useOfferRide(plan.id);
  const cancelOffer = useCancelRideOffer(plan.id);
  const request = useRequestRide(plan.id);
  const respond = useRespondRide(plan.id);
  const cancelRequest = useCancelRideRequest(plan.id);
  const [open, setOpen] = useState(false);
  const [area, setArea] = useState("");
  const [departure, setDeparture] = useState(() => toLocalInputValue(new Date(new Date(plan.starts_at).getTime() - 30 * 60_000)));
  const [seats, setSeats] = useState("3");
  const [returnTrip, setReturnTrip] = useState(false);
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const failed = (error: unknown) => toast.error(error);

  if (rides.isPending) return <Skeleton className="h-16" />;
  if (rides.isError) return <ErrorState error={rides.error} onRetry={() => void rides.refetch()} />;

  const offers = rides.data.filter((o) => o.status === "open");
  const mine = offers.find((o) => o.driver_user_id === userId);

  function submit(event: FormEvent) {
    event.preventDefault();
    const departureTime = fromLocalInputValue(departure);
    const seatCount = Number(seats);
    if (area.trim().length < 2 || !departureTime || !Number.isInteger(seatCount) || seatCount < 1 || seatCount > 8) {
      setFormError(t.errors.codes.invalid_ride);
      return;
    }
    offer.mutate(
      { departureArea: area.trim(), departureTime, seats: seatCount, returnTrip, note: note.trim() || null },
      {
        onSuccess: () => {
          setOpen(false);
          toast.success(t.plans.rides.offered);
        },
        onError: (error) => setFormError(errorMessage(error)),
      },
    );
  }

  function openForm() {
    if (mine) {
      setArea(mine.departure_area);
      setDeparture(toLocalInputValue(mine.departure_time));
      setSeats(String(mine.available_seats));
      setReturnTrip(mine.return_trip);
      setNote(mine.note ?? "");
    }
    setFormError(null);
    setOpen(true);
  }

  return (
    <div className="space-y-3">
      {offers.length === 0 ? (
        <p className="text-[15px] text-muted">{t.plans.rides.none}</p>
      ) : (
        <ul className="space-y-3">
          {offers.map((o) => {
            const driver = lookup(o.driver_user_id);
            const isMine = o.driver_user_id === userId;
            const taken = o.requests.filter((r) => r.status === "accepted").reduce((sum, r) => sum + r.seats_requested, 0);
            const free = Math.max(0, o.available_seats - taken);
            const myRequest = o.requests.find((r) => r.passenger_user_id === userId && (r.status === "requested" || r.status === "accepted" || r.status === "declined"));
            const pending = o.requests.filter((r) => r.status === "requested");
            const accepted = o.requests.filter((r) => r.status === "accepted");
            return (
              <li key={o.id} className={cn(PANEL_ITEM, "p-4")} data-testid="ride-card">
                <div className="flex items-start gap-3">
                  <Avatar person={driver} size="md" decorative />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-fg">
                      {isMine ? t.plans.rides.yourOffer : (driver?.display_name ?? t.states.formerMember)} <span className="font-normal text-muted">{t.plans.rides.from(o.departure_area)}</span>
                    </p>
                    <p className="mt-0.5 text-sm text-muted">
                      {formatDateTime(o.departure_time)}
                      {o.return_trip && `, ${t.plans.rides.withReturn}`}
                    </p>
                    {o.note && <p className="mt-1 text-sm text-fg">{o.note}</p>}
                  </div>
                  <StatusPill tone={free > 0 ? "lime" : "glass"} testId="ride-seats">
                    {t.plans.rides.seatsFree(free)}
                  </StatusPill>
                </div>
                {/* V2 Etappe 3g: die Plätze als Punkte – gefüllt, wer schon mitfährt, als Ring, was frei ist. */}
                <p aria-hidden className="mt-3 flex flex-wrap gap-1.5 pl-[52px]" data-testid="ride-seat-dots">
                  {Array.from({ length: o.available_seats }, (_, index) => (
                    <span key={index} className={cn("size-3 rounded-full border-2", index < o.available_seats - free ? "border-pink bg-pink" : "border-white/30")} />
                  ))}
                </p>

                {isMine ? (
                  <div className="mt-3 border-t border-white/10 pt-3">
                    <p className="mb-2 text-[13px] font-semibold text-muted">{t.plans.rides.requests}</p>
                    {pending.length + accepted.length === 0 ? (
                      <p className="text-sm text-muted">{t.plans.rides.noRequests}</p>
                    ) : (
                      <ul className="space-y-2">
                        {[...accepted, ...pending].map((r) => (
                          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                            <span className="flex items-center gap-2 text-sm font-medium text-fg">
                              <Avatar person={lookup(r.passenger_user_id)} size="xs" decorative />
                              {lookup(r.passenger_user_id)?.display_name ?? t.states.formerMember}
                            </span>
                            {r.status === "accepted" ? (
                              <StatusPill tone="lime">{t.enums.rideRequestStatus.accepted}</StatusPill>
                            ) : (
                              <span className="flex gap-2">
                                <Button size="sm" disabled={locked || free < r.seats_requested} onClick={() => respond.mutate({ requestId: r.id, accept: true }, { onError: failed })}>
                                  {t.plans.rides.accept}
                                </Button>
                                <Button size="sm" variant="ghost" disabled={locked} onClick={() => respond.mutate({ requestId: r.id, accept: false }, { onError: failed })}>
                                  {t.plans.rides.decline}
                                </Button>
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {!locked && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" onClick={openForm}>
                          {t.plans.rides.editOffer}
                        </Button>
                        <Button size="sm" variant="ghost" loading={cancelOffer.isPending} onClick={() => cancelOffer.mutate(o.id, { onError: failed })}>
                          {t.plans.rides.withdrawOffer}
                        </Button>
                      </div>
                    )}
                  </div>
                ) : (
                  !locked && (
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      {myRequest && myRequest.status !== "declined" ? (
                        <>
                          <span className="text-sm text-muted">{t.plans.rides.myStatus(t.enums.rideRequestStatus[myRequest.status])}</span>
                          <Button size="sm" variant="ghost" loading={cancelRequest.isPending} onClick={() => cancelRequest.mutate(myRequest.id, { onError: failed })}>
                            {t.plans.rides.withdraw}
                          </Button>
                        </>
                      ) : (
                        <>
                          {myRequest?.status === "declined" && <span className="text-sm text-muted">{t.plans.rides.myStatus(t.enums.rideRequestStatus.declined)}</span>}
                          <Button size="sm" variant="secondary" disabled={free === 0} loading={request.isPending} onClick={() => request.mutate(o.id, { onSuccess: () => toast.success(t.plans.rides.requested), onError: failed })}>
                            {t.plans.rides.request}
                          </Button>
                        </>
                      )}
                    </div>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!locked && !mine && (
        <Button variant="secondary" onClick={openForm} icon={<IconCar className="size-4" aria-hidden />}>
          {t.plans.rides.offer}
        </Button>
      )}
      <p className="text-[13px] leading-snug text-faint">{t.plans.rides.safety}</p>

      <Dialog open={open} onClose={() => setOpen(false)} title={t.plans.rides.offerTitle} description={t.plans.rides.offerBody} size="sm">
        <form onSubmit={submit} noValidate className="space-y-4">
          <TextField label={t.plans.rides.area} name="departure_area" value={area} onChange={(e) => setArea(e.target.value)} placeholder={t.plans.rides.areaPlaceholder} hint={t.plans.rides.areaHint} maxLength={120} required />
          <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-3">
            <TextField label={t.plans.rides.departure} name="departure_time" type="datetime-local" value={departure} onChange={(e) => setDeparture(e.target.value)} required />
            <TextField label={t.plans.rides.seats} name="seats" type="number" inputMode="numeric" min={1} max={8} value={seats} onChange={(e) => setSeats(e.target.value)} required />
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px] text-fg">
            <input type="checkbox" checked={returnTrip} onChange={(e) => setReturnTrip(e.target.checked)} className="size-5 shrink-0 accent-[var(--color-lime)]" />
            {t.plans.rides.returnTrip}
          </label>
          <TextField label={t.plans.rides.note} name="ride_note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.plans.rides.notePlaceholder} maxLength={300} optional />
          {formError && <FormMessage>{formError}</FormMessage>}
          <Button type="submit" block loading={offer.isPending}>
            {t.plans.rides.submitOffer}
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
