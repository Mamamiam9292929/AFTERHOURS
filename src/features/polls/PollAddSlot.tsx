import { IconCalendarPlus } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { loadTexts, t } from "@/i18n";
import { canSuggestSlot, slotProblem, slotsFull } from "@/lib/pollslot";
import { addDays, formatPlainDate, formatPlainTime, today, zonedToUtc } from "@/lib/time";
import { useState, type FormEvent } from "react";
import { useAddPollSlot } from "./api";
import type { PollWithDetails } from "./logic";

// P40: Texte kommen parallel zum Seiten-Chunk (Router, F7).
await loadTexts("pollSlot");

/**
 * P40 · „Und Sonntag?“ – unter den Terminen einer laufenden „Wann könnt ihr?“-Abstimmung schlägt jedes Mitglied
 * einen weiteren Termin vor. Erst ein Knopf, nach dem Tipp Tag und (optional) Uhrzeit; geprüft wird wie in
 * `add_poll_slot`, damit der Fehler am Feld steht, bevor der Server gefragt wird.
 */
export function PollAddSlot({ poll, now }: { poll: PollWithDetails; now: Date }) {
  const toast = useToast();
  const add = useAddPollSlot();
  const tx = t.pollSlot;
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!canSuggestSlot(poll, now)) return null;
  if (slotsFull(poll)) return <p className="mt-4 text-[13px] leading-snug text-faint">{tx.full}</p>;

  const day = today();

  function submit(event: FormEvent) {
    event.preventDefault();
    const start = date ? zonedToUtc(date, time || "00:00") : null;
    const problem = slotProblem(poll, { date, time }, day, start ? start.getTime() : null, new Date());
    if (problem) {
      setError(tx.problems[problem]);
      return;
    }
    setError(null);
    const label = time ? `${formatPlainDate(date, "long")}, ${formatPlainTime(time)}` : formatPlainDate(date, "long");
    add.mutate(
      { pollId: poll.id, date, time: time || null },
      {
        onSuccess: () => {
          toast.success(tx.done(label));
          setOpen(false);
          setDate("");
          setTime("");
        },
        onError: (err) => toast.error(err),
      },
    );
  }

  if (!open) {
    return (
      <div className="mt-4">
        <Button variant="secondary" size="sm" data-testid="poll-add-slot" onClick={() => setOpen(true)} icon={<IconCalendarPlus className="size-4" aria-hidden />}>
          {tx.open}
        </Button>
      </div>
    );
  }

  return (
    <form className="mt-4 rounded-card border border-line bg-surface p-4" data-testid="poll-add-slot-form" onSubmit={submit} noValidate>
      <h3 className="text-[15px] font-semibold text-fg">{tx.title}</h3>
      <p className="mt-1 text-[13px] leading-snug text-muted">{tx.lead}</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <TextField
          label={tx.date}
          name="slot-date"
          type="date"
          min={day}
          max={addDays(day, 365)}
          value={date}
          required
          autoFocus
          onChange={(e) => {
            setDate(e.target.value);
            setError(null);
          }}
          error={error ?? undefined}
        />
        <TextField
          label={tx.time}
          name="slot-time"
          type="time"
          value={time}
          optional
          onChange={(e) => {
            setTime(e.target.value);
            setError(null);
          }}
        />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={add.isPending} icon={<IconCalendarPlus className="size-4" aria-hidden />}>
          {tx.submit}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={add.isPending}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          {t.actions.cancel}
        </Button>
      </div>
    </form>
  );
}
