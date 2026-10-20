import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { t } from "@/i18n";
import { qk } from "@/lib/query";

type Moment = { kind: "plan"; to: string; title: string } | { kind: "runoff"; to: string };

const JUMP_MS = 3200;

/**
 * S5 Etappe 2 · Der Match-Moment: Entscheidet sich die Abstimmung, während die Seite offen ist (klare Mehrheit
 * nach einer Stimme – auch der eigenen im Kartenstapel – oder Fristende), zeigt sie groß „Entschieden“ und
 * springt nach gut drei Sekunden zum Plan; bei Gleichstand „Gleichstand“ und zur Stichwahl, die von selbst
 * gestartet ist. „Hier bleiben“ bricht den Sprung ab. Nur, wenn es in dieser Sitzung passiert – wer eine
 * entschiedene Abstimmung öffnet, sieht wie bisher das Ergebnis.
 */
export function DecidedMoment({
  open,
  auto,
  plan,
  runoffId,
}: {
  /** Abstimmung läuft noch (aus Sicht der Seite). */
  open: boolean;
  /** Entscheidet sich selbst und wurde nicht von Hand beendet. */
  auto: boolean;
  plan: { id: string; title: string } | undefined;
  runoffId: string | undefined;
}) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const wasOpen = useRef(open);
  const shownOnce = useRef(false);
  const [moment, setMoment] = useState<Moment | null>(null);
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current || shownOnce.current || !auto) return;
    if (plan) {
      shownOnce.current = true;
      setMoment({ kind: "plan", to: `/plans/${plan.id}`, title: plan.title });
    } else if (runoffId) {
      shownOnce.current = true;
      setMoment({ kind: "runoff", to: `/polls/${runoffId}` });
    } else {
      // Plan bzw. Stichwahl entstehen auf dem Server im selben Schritt – Listen einmal nachladen.
      void client.invalidateQueries({ queryKey: qk.plans });
      void client.invalidateQueries({ queryKey: qk.polls, exact: true });
    }
  }, [open, auto, plan, runoffId, client]);

  useEffect(() => {
    if (!moment) return;
    box.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const timer = window.setTimeout(() => navigate(moment.to), JUMP_MS);
    return () => window.clearTimeout(timer);
  }, [moment, navigate]);

  if (!moment) return null;
  const isPlan = moment.kind === "plan";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      ref={box}
      data-testid="decided-moment"
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black/70 px-6 text-center backdrop-blur-sm"
      style={{ animation: "fade-in 0.2s ease-out" }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setMoment(null);
      }}
    >
      <p id={titleId} className="display chrome break-words text-[56px] uppercase leading-none sm:text-[76px]" style={{ animation: "pop-in 0.7s var(--ease-out-soft) both" }}>
        {isPlan ? t.polls.swipe.decided : t.polls.swipe.tie}
      </p>
      <p className="mt-4 max-w-md text-lg font-bold text-lime">{isPlan ? t.polls.swipe.decidedBody(moment.title) : t.polls.swipe.tieBody}</p>
      {isPlan && <p className="mt-2 text-[15px] text-muted">{t.polls.swipe.decidedGoing}</p>}
      <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
        <Button size="lg" onClick={() => navigate(moment.to)}>
          {isPlan ? t.polls.swipe.toPlan : t.polls.swipe.toRunoff}
        </Button>
        <Button size="lg" variant="secondary" onClick={() => setMoment(null)}>
          {t.polls.swipe.stay}
        </Button>
      </div>
      <p className="mt-4 text-[13px] text-faint" aria-live="polite">
        {t.polls.swipe.jumping}
      </p>
    </div>
  );
}
