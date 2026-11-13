import { useId } from "react";
import { useToast } from "@/components/ui/Toast";
import { loadTexts, t } from "@/i18n";
import { spotsLeft } from "@/lib/capacity";
import { goingWithGuests } from "@/lib/quorum";
import { useSetPlanPlusOnes, type PlanWithParticipants } from "./api";

// F7/F10: Texte der Planseiten-Karten – mit der Planseite schon geladen, hier zur Sicherheit.
await loadTexts("planCards");

const OPTIONS = [0, 1, 2, 3] as const;

/**
 * P51 · „Ich bring wen mit“. Sitzt in der Antwortkarte der Planseite, nur bei „Bin dabei“ und vor Beginn.
 * Vier Pillen wie die Antworten darüber: „Nur ich“, „+1“, „+2“, „+3“ – ein Tipp speichert. Bei einer Höchstzahl
 * (P26) sind Pillen gesperrt, für die kein Platz mehr frei ist; der Server prüft dasselbe (`plan_full`).
 * Ändert sich die Antwort, setzt der Server die Begleitung zurück (Trigger) – hier reicht es, den Stand anzuzeigen.
 */
export function PlusOnesPicker({ plan, userId, now }: { plan: PlanWithParticipants; userId: string; now: Date }) {
  const toast = useToast();
  const headingId = useId();
  const save = useSetPlanPlusOnes(plan.id);
  const texts = t.planCards.plusOnes;
  const mine = plan.participants.find((p) => p.user_id === userId)?.plus_ones ?? 0;
  const left = spotsLeft(plan, goingWithGuests(plan), now);
  const full = left === 0 && mine < 3;

  return (
    <div className="mt-4 border-t border-line pt-4" data-testid="plan-plus-ones">
      <p id={headingId} className="text-[14px] font-semibold text-fg">
        {texts.question}
      </p>
      <div role="radiogroup" aria-labelledby={headingId} className="mt-2.5 grid grid-cols-4 gap-2">
        {OPTIONS.map((n) => {
          const selected = n === mine;
          // Mehr Begleitung nur, solange Plätze frei sind; weniger geht immer.
          const blocked = left != null && n > mine + left;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={texts.option(n)}
              disabled={save.isPending || blocked}
              data-plus-ones={n}
              onClick={() => !selected && save.mutate(n, { onSuccess: (saved) => toast.success(texts.saved(saved)), onError: (error) => toast.error(error) })}
              className="vote-pill h-10 px-2 text-[14px]"
            >
              {n === 0 ? texts.none : texts.chip(n)}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[13px] leading-snug text-muted">{full ? texts.full : texts.hint}</p>
    </div>
  );
}
