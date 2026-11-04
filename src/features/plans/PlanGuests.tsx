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
import { useClaimPlanGuest, usePlanGuestClaimPreview, useRemovePlanGuest, useSetPlanGuests } from "./guestsApi";
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

/**
 * W10 Etappe 2 · Wer über den Teilen-Link als Gast geantwortet hat (Geheimnis noch auf diesem Gerät) und jetzt
 * Mitglied ist, übernimmt die Antwort mit einem Tipp – oder löscht den Gast-Eintrag. Hat die Person schon selbst
 * geantwortet, bleibt ihre Antwort; dann räumt der Tipp nur den Gast weg. Ohne Gast-Antwort erscheint nichts.
 */
export function PlanGuestClaimCard({ planId, token, secret }: { planId: string; token: string; secret: string }) {
  const toast = useToast();
  const preview = usePlanGuestClaimPreview(planId, secret);
  const claim = useClaimPlanGuest(planId, token, secret);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [done, setDone] = useState(false);
  const found = preview.data?.status === "found" ? preview.data : null;
  if (!found || done) return null;
  const texts = t.planGuests.claim;
  const answer = (value: "going" | "maybe" | "declined") => t.plans.detail.attendance[value];

  function run(keep: boolean) {
    claim.mutate(keep, {
      onSuccess: (result) => {
        setDone(true);
        setConfirmDiscard(false);
        toast.success(!keep ? texts.discarded : result.claimed ? texts.claimed : texts.kept);
      },
      // Beim Löschen steht der Fehler im Dialog; beim Übernehmen als Meldung.
      onError: (error) => {
        if (keep) toast.error(error);
      },
    });
  }

  return (
    <section aria-labelledby="plan-guest-claim-title" className="mt-4 rounded-card border border-lime/60 bg-lime/10 p-5" data-testid="plan-guest-claim">
      <h2 id="plan-guest-claim-title" className="text-[17px] font-bold text-fg">
        {texts.title}
      </h2>
      <p className="mt-1.5 max-w-prose text-[15px] leading-snug text-muted">
        {texts.body(found.name, answer(found.answer))}
        {found.own && <span className="mt-1 block">{texts.own(answer(found.own))}</span>}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <Button onClick={() => run(true)} loading={claim.isPending && claim.variables === true} disabled={claim.isPending}>
          {found.own ? texts.tidy : texts.claim}
        </Button>
        {!found.own && (
          <Button variant="ghost" onClick={() => setConfirmDiscard(true)} disabled={claim.isPending}>
            {texts.discard}
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirmDiscard}
        title={texts.discardTitle}
        description={texts.discardBody}
        confirmLabel={texts.discard}
        destructive
        loading={claim.isPending}
        error={claim.isError ? errorMessage(claim.error) : null}
        onConfirm={() => run(false)}
        onClose={() => setConfirmDiscard(false)}
      />
    </section>
  );
}
