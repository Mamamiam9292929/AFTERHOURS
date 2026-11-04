import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { SwitchRow } from "@/components/ui/Controls";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { loadTexts, t } from "@/i18n";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import type { PlanGuest } from "@/lib/types";
import type { PlanWithParticipants } from "./api";
import { useRemovePlanGuest, useSetPlanGuests } from "./guestsApi";
import { PANEL_ITEM, StatusPill } from "./PlanPanel";

// F7: Texte der Zusagen ohne Konto liegen nicht im Start-Bundle.
await loadTexts("planGuests");

const DOT: Record<PlanGuest["attendance_status"], string> = { going: "bg-lime", maybe: "bg-amber", declined: "bg-danger" };

/**
 * W10 · „Freunde ohne Konto“ auf der Planseite – für Organisator:in, Owner und Admins: der Schalter, ob der
 * Teilen-Link eine Zusage mit Namen erlaubt, und die Gäste mit ihrer Antwort zum Entfernen. Eingeschaltet
 * zeigt der Link auch Ort, Adresse und Treffpunkt (wer zusagt, muss wissen, wohin) – das steht im Hinweis.
 */
export function PlanGuestsPanel({ plan, started }: { plan: PlanWithParticipants; started: boolean }) {
  const toast = useToast();
  const setGuests = useSetPlanGuests(plan.id);
  const removeGuest = useRemovePlanGuest(plan.id);
  const [removing, setRemoving] = useState<PlanGuest | null>(null);
  const allowed = plan.guests_allowed === true;
  const guests = plan.guests ?? [];
  // Nach Beginn lässt sich nur noch ausschalten.
  const canToggle = allowed || !started;

  return (
    <div data-testid="plan-guests">
      <div className={cn(PANEL_ITEM, "px-4 py-1.5")}>
        <SwitchRow
          label={t.planGuests.panel.toggle}
          description={started && !allowed ? t.planGuests.panel.toggleStarted : t.planGuests.panel.toggleBody}
          checked={allowed}
          disabled={setGuests.isPending || !canToggle}
          onChange={(next) =>
            setGuests.mutate(next, {
              onSuccess: () => toast.success(next ? t.planGuests.panel.on : t.planGuests.panel.off),
              onError: (error) => toast.error(error),
            })
          }
        />
      </div>
      {allowed && !started && <p className="mt-2 px-1 text-[13px] leading-snug text-faint">{t.planGuests.panel.shareHint}</p>}

      {(allowed || guests.length > 0) && (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-3 px-1">
            <h3 className="text-[13px] font-semibold text-muted">{t.planGuests.panel.listTitle}</h3>
            <StatusPill tone={guests.length > 0 ? "lime" : "glass"} testId="plan-guests-count">
              {t.planGuests.panel.count(guests.length)}
            </StatusPill>
          </div>
          {guests.length === 0 ? (
            <p className="mt-2 px-1 text-sm text-muted">{t.planGuests.panel.none}</p>
          ) : (
            <ul className="mt-2 space-y-2" aria-label={t.planGuests.panel.listTitle}>
              {guests.map((guest) => (
                <li key={guest.id} className={cn(PANEL_ITEM, "flex items-center justify-between gap-3 py-1.5 pl-4 pr-1.5")} data-testid="plan-guest" data-status={guest.attendance_status}>
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT[guest.attendance_status])} />
                    <span className="min-w-0 truncate text-[15px] text-fg">{t.plans.detail.attendance.guest(guest.display_name)}</span>
                    <span className="shrink-0 text-[13px] text-muted">· {t.plans.detail.attendance.groups[guest.attendance_status]}</span>
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => setRemoving(guest)} aria-label={t.planGuests.panel.remove(guest.display_name)}>
                    {t.planGuests.panel.removeConfirm}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title={t.planGuests.panel.removeTitle(removing?.display_name ?? "")}
        description={t.planGuests.panel.removeBody}
        confirmLabel={t.planGuests.panel.removeConfirm}
        destructive
        loading={removeGuest.isPending}
        error={removeGuest.isError ? errorMessage(removeGuest.error) : null}
        onConfirm={() =>
          removing &&
          removeGuest.mutate(removing.id, {
            onSuccess: () => {
              setRemoving(null);
              toast.success(t.planGuests.panel.removed);
            },
          })
        }
      />
    </div>
  );
}
