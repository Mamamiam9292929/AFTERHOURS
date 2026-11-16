import { useId } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IconBell, IconCheck, IconTicketCheck } from "@/components/icons";
import type { Person } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { loadTexts, t } from "@/i18n";
import { cn } from "@/lib/cn";
import { qk } from "@/lib/query";
import { supabase } from "@/lib/supabase";
import { canOfferTicket, canTakeTicket, ticketStanding } from "@/lib/tickets";
import type { PlanWithParticipants } from "./api";
import { StatusPill } from "./PlanPanel";

// F7/F10: Texte der Planseiten-Karten – mit der Planseite schon geladen, hier zur Sicherheit.
await loadTexts("planCards");

type Lookup = (id: string | null | undefined) => Person | null;

function useSetMyTicket(planId: string, userId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (has: boolean): Promise<boolean> => {
      const { data, error } = await supabase.rpc("set_my_plan_ticket", { p_plan_id: planId, p_has: has });
      if (error) throw error;
      return Boolean(data);
    },
    onSuccess: (has) => {
      client.setQueryData<PlanWithParticipants | null>(qk.plan(planId), (old) =>
        old ? { ...old, participants: old.participants.map((p) => (p.user_id === userId ? { ...p, has_ticket: has } : p)) } : old,
      );
      void client.invalidateQueries({ queryKey: qk.plan(planId) });
    },
  });
}

/** P53 Etappe 2a: Alle mit Zusage, aber ohne Ticket fragen. Liefert die Zahl der gefragten Personen. */
function useRemindTickets(planId: string) {
  return useMutation({
    mutationFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc("remind_plan_tickets", { p_plan_id: planId });
      if (error) throw error;
      return data as number;
    },
  });
}

/** P54: Übriges Ticket anbieten. Liefert die Zahl der Personen, die Bescheid bekommen haben. */
function useOfferTicket(planId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc("offer_plan_ticket", { p_plan_id: planId });
      if (error) throw error;
      return data as number;
    },
    onSettled: () => void client.invalidateQueries({ queryKey: qk.plan(planId) }),
  });
}

/** P54: Angebotenes Ticket nehmen – wer zuerst tippt, bekommt es. */
function useTakeTicket(planId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (from: string): Promise<boolean> => {
      const { data, error } = await supabase.rpc("take_plan_ticket", { p_plan_id: planId, p_from: from });
      if (error) throw error;
      return Boolean(data);
    },
    // Auch bei „schon weg“ neu laden – dann verschwindet das Angebot.
    onSettled: () => void client.invalidateQueries({ queryKey: qk.plan(planId) }),
  });
}

function useSetTicketsNeeded(planId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (needed: boolean): Promise<boolean> => {
      const { data, error } = await supabase.rpc("set_plan_tickets_needed", { p_plan_id: planId, p_needed: needed });
      if (error) throw error;
      return Boolean(data);
    },
    onSuccess: (needed) => {
      client.setQueryData<PlanWithParticipants | null>(qk.plan(planId), (old) => (old ? { ...old, tickets_needed: needed } : old));
      void client.invalidateQueries({ queryKey: qk.plan(planId) });
      void client.invalidateQueries({ queryKey: qk.plans });
    },
  });
}

/**
 * P53 · „Habt ihr alle Tickets?“ unter „Wer kommt mit?“ – für alle in der Crew, solange der Ticket-Check an ist:
 * wie viele, die dabei sind, schon ein Ticket haben (Balken wie bei der Mindestzahl), wer noch keins hat und wer
 * nach einer Absage eins übrig hat. Etappe 2a: Wer organisiert (oder Owner/Admin ist), fragt vor Beginn mit
 * „Nachfragen“ alle aus „Noch ohne Ticket“ (außer sich selbst) – `canRemind` entscheidet die Planseite.
 * Etappe 2c: Gäste über den Teilen-Link stehen als „Dana (Gast)“ mit drin.
 * P54: Vor Beginn bietet, wer abgesagt hat und ein Ticket hat, es mit „Ticket anbieten“ an; wer zugesagt und noch
 * keins hat, nimmt ein Angebot mit „Nehm ich“. `beforeStart` entscheidet die Planseite.
 */
export function TicketsMeter({
  plan,
  userId,
  lookup,
  canRemind = false,
  beforeStart = false,
}: {
  plan: PlanWithParticipants;
  userId: string;
  lookup: Lookup;
  canRemind?: boolean;
  beforeStart?: boolean;
}) {
  const texts = t.planCards.tickets;
  const toast = useToast();
  const remind = useRemindTickets(plan.id);
  const offer = useOfferTicket(plan.id);
  const take = useTakeTicket(plan.id);
  const mine = plan.participants.find((p) => p.user_id === userId);
  // Etappe 2c: Gäste zählen mit, solange Zusagen über den Link an sind – nur dann können sie ihre Angabe ändern.
  const s = ticketStanding(plan.participants, plan.guests_allowed ? (plan.guests ?? []) : []);
  // Gäste haben kein Postfach – „Nachfragen“ geht nur an Mitglieder (Etappe 2a).
  const askable = canRemind ? s.missing.filter((id) => id !== userId).length : 0;
  const name = (id: string) => (id === userId ? t.states.you : (lookup(id)?.display_name ?? t.states.formerMember));
  const names = (ids: string[], guests: string[] = []) => [...ids.map(name), ...guests.map((g) => t.plans.detail.attendance.guest(g))].join(", ");
  const missingCount = s.missing.length + s.missingGuests.length;
  return (
    <div data-testid="plan-tickets" data-complete={s.complete ? "true" : "false"} className="mb-3 rounded-card border border-white/10 bg-white/[0.04] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-fg">
          <IconTicketCheck className="size-4 text-muted" aria-hidden />
          {texts.meterTitle}
        </p>
        {s.going > 0 && (
          <StatusPill tone={s.complete ? "lime" : "amber"} testId="plan-tickets-status">
            {s.complete && <IconCheck className="size-3.5" aria-hidden />}
            {s.complete ? texts.complete : texts.missingPill(missingCount)}
          </StatusPill>
        )}
      </div>
      {s.going === 0 ? (
        <p className="mt-1.5 text-[13px] text-muted">{texts.nobodyGoing}</p>
      ) : (
        <>
          <div
            className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-white/10"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={s.going}
            aria-valuenow={s.have}
            aria-label={texts.progress(s.have, s.going)}
          >
            <div className={cn("bar-grow h-full rounded-full bg-lime", s.complete && "shadow-[0_0_18px_var(--color-lime)]")} style={{ width: `${Math.max(s.have / s.going, 0.04) * 100}%` }} />
          </div>
          <p className="mt-1.5 text-[13px] text-muted">{texts.count(s.have, s.going)}</p>
          {missingCount > 0 && (
            <p className="mt-1 text-[13px] font-semibold leading-snug text-fg" data-testid="plan-tickets-missing">
              {texts.missing(names(s.missing, s.missingGuests))}
            </p>
          )}
          {askable > 0 && (
            <div className="mt-2.5">
              <Button
                variant="secondary"
                size="sm"
                data-testid="plan-remind-tickets"
                aria-label={texts.remindLabel(askable)}
                loading={remind.isPending}
                onClick={() =>
                  remind.mutate(undefined, {
                    onSuccess: (n) => toast.success(texts.reminded(n)),
                    onError: (error) => toast.error(error),
                  })
                }
                icon={<IconBell className="size-4" aria-hidden />}
              >
                {texts.remind}
              </Button>
            </div>
          )}
        </>
      )}
      {s.spare.length + s.spareGuests.length > 0 && (
        <p className="mt-1 text-[13px] font-semibold leading-snug text-lime" data-testid="plan-tickets-spare">
          {texts.spare(names(s.spare, s.spareGuests))}
        </p>
      )}
      {/* P54: eigenes übriges Ticket anbieten – oder sehen, dass es angeboten ist. */}
      {beforeStart && canOfferTicket(mine) && (
        <div className="mt-2.5">
          <Button
            variant="secondary"
            size="sm"
            data-testid="plan-offer-ticket"
            aria-label={texts.offerLabel}
            loading={offer.isPending}
            onClick={() =>
              offer.mutate(undefined, {
                onSuccess: (n) => toast.success(texts.offered(n)),
                onError: (error) => toast.error(error),
              })
            }
            icon={<IconTicketCheck className="size-4" aria-hidden />}
          >
            {texts.offer}
          </Button>
          <p className="mt-1.5 text-[12px] leading-snug text-muted">{texts.offerHint}</p>
        </div>
      )}
      {beforeStart && s.offered.includes(userId) && (
        <p className="mt-1.5 text-[13px] leading-snug text-muted" data-testid="plan-ticket-offered-mine">
          {texts.offeredMine}
        </p>
      )}
      {/* P54: Angebote der anderen – „Nehm ich“ nur mit eigener Zusage ohne Ticket. */}
      {beforeStart && s.offered.some((id) => id !== userId) && (
        <ul className="mt-2.5 space-y-2" aria-label={texts.meterTitle}>
          {s.offered
            .filter((id) => id !== userId)
            .map((id) => (
              <li
                key={id}
                data-testid="plan-ticket-offer"
                className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-lime/40 bg-lime/[0.08] px-3 py-2"
              >
                <span className="text-[13px] font-semibold leading-snug text-fg">{texts.offerFrom(name(id))}</span>
                {canTakeTicket(mine) && (
                  <button
                    type="button"
                    data-testid="plan-take-ticket"
                    aria-label={texts.takeLabel(name(id))}
                    disabled={take.isPending}
                    onClick={() =>
                      take.mutate(id, {
                        onSuccess: () => toast.success(texts.taken(name(id))),
                        onError: (error) => toast.error(error),
                      })
                    }
                    className="inline-flex h-10 items-center justify-center rounded-full border border-lime bg-lime px-4 text-[14px] font-semibold text-lime-ink transition-opacity disabled:opacity-50"
                  >
                    {texts.take}
                  </button>
                )}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

/**
 * P53 · „Hast du dein Ticket?“ in der Antwortkarte – zwei Pillen wie die Antworten darüber, ein Tipp speichert.
 * Nur bei eingeschaltetem Ticket-Check und offenem Plan; die Planseite entscheidet mit `canSayTicket`, wer sie sieht.
 */
export function MyTicketPicker({ plan, userId }: { plan: PlanWithParticipants; userId: string }) {
  const toast = useToast();
  const headingId = useId();
  const texts = t.planCards.tickets;
  const save = useSetMyTicket(plan.id, userId);
  const mine = Boolean(plan.participants.find((p) => p.user_id === userId)?.has_ticket);
  const options = [
    { value: true, label: texts.yes },
    { value: false, label: texts.no },
  ];
  return (
    <div className="mt-4 border-t border-line pt-4" data-testid="plan-my-ticket">
      <p id={headingId} className="text-[14px] font-semibold text-fg">
        {texts.question}
      </p>
      <div role="radiogroup" aria-labelledby={headingId} className="mt-2.5 grid grid-cols-2 gap-2">
        {options.map((o) => {
          const selected = o.value === mine;
          return (
            <button
              key={String(o.value)}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={save.isPending}
              data-ticket={o.value ? "yes" : "no"}
              onClick={() =>
                !selected && save.mutate(o.value, { onSuccess: (has) => toast.success(has ? texts.savedYes : texts.savedNo), onError: (error) => toast.error(error) })
              }
              className="vote-pill h-10 px-2 text-[14px]"
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[13px] leading-snug text-muted">{texts.hint}</p>
    </div>
  );
}

/** P53 · Ticket-Check ein- oder ausschalten (Organisator:in, Owner, Admins) – unter „Organisieren“, ein Tipp speichert. */
export function TicketsCard({ plan }: { plan: PlanWithParticipants }) {
  const toast = useToast();
  const texts = t.planCards.tickets.card;
  const set = useSetTicketsNeeded(plan.id);
  const current = Boolean(plan.tickets_needed);
  const chip = "inline-flex h-10 items-center justify-center rounded-full border px-4 text-[14px] font-semibold transition-colors disabled:opacity-50";

  function choose(needed: boolean) {
    if (needed === current || set.isPending) return;
    set.mutate(needed, {
      onSuccess: (saved) => toast.success(saved ? texts.savedOn : texts.savedOff),
      onError: (error) => toast.error(error),
    });
  }

  return (
    <section aria-labelledby="tickets-heading" className="mt-4 rounded-card border border-line bg-surface p-4" data-testid="plan-tickets-card">
      <h2 id="tickets-heading" className="mb-1 flex items-center gap-2 text-[17px] font-bold text-fg">
        <IconTicketCheck className="size-[18px] text-muted" aria-hidden />
        {texts.title}
      </h2>
      <p className="mb-3 text-[13px] leading-snug text-muted">{texts.intro}</p>
      <div role="radiogroup" aria-label={texts.label} className="flex flex-wrap gap-2">
        {[false, true].map((value) => {
          const on = value === current;
          return (
            <button
              key={String(value)}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={set.isPending}
              data-tickets-needed={value ? "on" : "off"}
              onClick={() => choose(value)}
              className={cn(chip, on ? "border-lime bg-lime text-lime-ink" : "border-line-strong text-fg hover:border-white/25")}
            >
              {value ? texts.on : texts.off}
            </button>
          );
        })}
      </div>
    </section>
  );
}
