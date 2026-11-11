import { IconHourglass } from "@/components/icons";
import { Section } from "@/components/layout/Page";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { loadTexts, t } from "@/i18n";
import { extendChoices, type ExtendPreset } from "@/lib/pollextend";
import { formatDateTime, zonedToUtc } from "@/lib/time";
import { useState } from "react";
import { useExtendPoll } from "./api";
import type { PollWithDetails } from "./logic";

// P39: Texte kommen parallel zum Seiten-Chunk (Router, F7).
await loadTexts("pollExtend");

/**
 * P39 · „Noch einen Tag?“ – Frist verlängern, für Erstellerin, Owner und Admin, solange die Abstimmung läuft.
 * Drei Tipps ab der aktuellen Frist; was über die Grenzen ginge (14 Tage, 30 Minuten vor dem ersten Termin), ist
 * ausgegraut. In einer laufenden Serie „Jede Woche neu“ steht nur, warum es nicht geht.
 */
export function PollExtend({ poll, now }: { poll: PollWithDetails; now: Date }) {
  const toast = useToast();
  const extend = useExtendPoll();
  const [pending, setPending] = useState<ExtendPreset | null>(null);
  const tx = t.pollExtend;
  const starts = poll.options.map((o) => (o.proposed_date ? (zonedToUtc(o.proposed_date, o.proposed_time ?? "00:00")?.getTime() ?? null) : null));
  const seriesActive = poll.series?.active === true;
  const choices = extendChoices({ status: poll.status, ends_at: poll.ends_at }, starts, now);
  if (!choices) return null;

  function run(key: ExtendPreset, endsAt: Date) {
    setPending(key);
    extend.mutate(
      { pollId: poll.id, endsAt },
      {
        onSuccess: (until) => toast.success(tx.done(formatDateTime(until))),
        onError: (error) => toast.error(error),
        onSettled: () => setPending(null),
      },
    );
  }

  return (
    <Section title={tx.title} className="mt-0">
      <div className="rounded-card border border-line bg-surface p-4" data-testid="poll-extend">
        {seriesActive ? (
          <p className="text-sm leading-snug text-muted">{tx.series}</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {choices.map(({ key, endsAt, allowed }) => (
                <Button
                  key={key}
                  variant="secondary"
                  size="sm"
                  disabled={!allowed || extend.isPending}
                  loading={pending === key}
                  aria-label={tx.presetLabel(tx.presets[key], formatDateTime(endsAt))}
                  onClick={() => run(key, endsAt)}
                  icon={<IconHourglass className="size-4" aria-hidden />}
                >
                  {tx.presets[key]}
                </Button>
              ))}
            </div>
            <p className="mt-3 text-[13px] leading-snug text-faint">{choices.some((c) => c.allowed) ? tx.lead : tx.tooLate}</p>
          </>
        )}
      </div>
    </Section>
  );
}
