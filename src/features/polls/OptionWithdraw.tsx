import { IconTrash } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { loadTexts, t } from "@/i18n";
import { useState } from "react";
import { useRemovePollOption } from "./api";

// P42: Texte liegen bei P40 (`pollSlot`) und kommen parallel zum Seiten-Chunk (F7).
await loadTexts("pollSlot");

/**
 * P42 · „Vertippt?“ – unter einem nachgereichten Vorschlag „Zurückziehen“, solange niemand sonst dazu geantwortet hat.
 * Ob der Knopf erscheint, entscheidet die Seite mit `canWithdrawOption`; der Server prüft dasselbe noch einmal.
 * Ein Tipp fragt nach, erst der zweite zieht zurück – die eigene Antwort zum Vorschlag verschwindet mit.
 */
export function OptionWithdraw({ optionId, title }: { optionId: string; title: string }) {
  const toast = useToast();
  const remove = useRemovePollOption();
  const tx = t.pollSlot.withdraw;
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <Button variant="ghost" size="sm" data-testid="poll-option-withdraw" aria-label={tx.openLabel(title)} onClick={() => setAsking(true)} icon={<IconTrash className="size-4" aria-hidden />}>
        {tx.open}
      </Button>
    );
  }

  return (
    <div role="group" aria-label={tx.question} className="w-full rounded-control border border-danger/35 bg-danger/10 p-3" data-testid="poll-option-withdraw-confirm">
      <p className="text-sm font-semibold text-fg">{tx.question}</p>
      <p className="mt-0.5 text-[13px] leading-snug text-fg/85">{tx.body}</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <Button
          variant="danger"
          size="sm"
          autoFocus
          loading={remove.isPending}
          onClick={() =>
            remove.mutate(optionId, {
              onSuccess: () => toast.success(tx.done(title)),
              onError: (err) => {
                toast.error(err);
                setAsking(false);
              },
            })
          }
          icon={<IconTrash className="size-4" aria-hidden />}
        >
          {tx.confirm}
        </Button>
        <Button variant="ghost" size="sm" disabled={remove.isPending} onClick={() => setAsking(false)}>
          {tx.keep}
        </Button>
      </div>
    </div>
  );
}
