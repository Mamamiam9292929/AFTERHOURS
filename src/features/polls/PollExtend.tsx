import { IconHourglass } from "@/components/icons";
import { Section } from "@/components/layout/Page";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { loadTexts, t } from "@/i18n";
import { checkCustomEnd, extendChoices, extendLimit, type ExtendPreset } from "@/lib/pollextend";
import { formatDateTime, fromLocalInputValue, toLocalInputValue, zonedToUtc } from "@/lib/time";
import { useState, type FormEvent } from "react";
import { useExtendPoll } from "./api";
import type { PollWithDetails } from "./logic";

// P39: Texte kommen parallel zum Seiten-Chunk (Router, F7).
await loadTexts("pollExtend");

/**
 * P39 · „Noch einen Tag?“ – Frist verlängern, für Erstellerin, Owner und Admin, solange die Abstimmung läuft.
 * Drei Tipps ab der aktuellen Frist; was über die Grenzen ginge (14 Tage, 30 Minuten vor dem ersten Termin), ist
 * ausgegraut. In einer laufenden Serie „Jede Woche neu“ steht nur, warum es nicht geht.
 * Etappe 2: „Bis …“ öffnet ein Feld für einen selbst gewählten Zeitpunkt (Berliner Zeit), mit denselben Grenzen.
 */
export function PollExtend({ poll, now }: { poll: PollWithDetails; now: Date }) {
  const toast = useToast();
  const extend = useExtendPoll();
  const [pending, setPending] = useState<ExtendPreset | "custom" | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);
  const tx = t.pollExtend;
  const starts = poll.options.map((o) => (o.proposed_date ? (zonedToUtc(o.proposed_date, o.proposed_time ?? "00:00")?.getTime() ?? null) : null));
  const seriesActive = poll.series?.active === true;
  const choices = extendChoices({ status: poll.status, ends_at: poll.ends_at }, starts, now);
  if (!choices) return null;

  const limit = extendLimit(starts, now);
  const minValue = toLocalInputValue(new Date(Math.floor(new Date(poll.ends_at).getTime() / 60_000) * 60_000 + 60_000));
  const maxValue = Number.isFinite(limit) ? toLocalInputValue(new Date(limit)) : undefined;

  function run(key: ExtendPreset | "custom", endsAt: Date) {
    setPending(key);
    extend.mutate(
      { pollId: poll.id, endsAt },
      {
        onSuccess: (until) => {
          toast.success(tx.done(formatDateTime(until)));
          if (key === "custom") {
            setCustomOpen(false);
            setCustom("");
          }
        },
        onError: (error) => toast.error(error),
        onSettled: () => setPending(null),
      },
    );
  }

  function openCustom() {
    // Vorschlag: einen Tag nach der Frist, höchstens bis zur Grenze.
    const ends = new Date(poll.ends_at).getTime();
    setCustom(toLocalInputValue(new Date(Math.min(ends + 86_400_000, limit))));
    setCustomError(null);
    setCustomOpen(true);
  }

  function submitCustom(event: FormEvent) {
    event.preventDefault();
    const endsAt = fromLocalInputValue(custom);
    const problem = endsAt ? checkCustomEnd(poll, endsAt, starts, new Date()) : "poll_extend_not_later";
    if (problem || !endsAt) {
      setCustomError(problem ? t.errors.codes[problem] : tx.custom.invalid);
      return;
    }
    setCustomError(null);
    run("custom", endsAt);
  }

  const anyAllowed = choices.some((c) => c.allowed);

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
              {anyAllowed && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={extend.isPending}
                  aria-expanded={customOpen}
                  aria-controls="poll-extend-custom"
                  onClick={() => (customOpen ? setCustomOpen(false) : openCustom())}
                >
                  {tx.custom.open}
                </Button>
              )}
            </div>
            {customOpen && anyAllowed && (
              <form id="poll-extend-custom" className="mt-3 space-y-3" onSubmit={submitCustom} noValidate data-testid="poll-extend-custom">
                <TextField
                  label={tx.custom.label}
                  name="poll_extend_until"
                  type="datetime-local"
                  min={minValue}
                  max={maxValue}
                  value={custom}
                  onChange={(e) => {
                    setCustom(e.target.value);
                    setCustomError(null);
                  }}
                  hint={maxValue ? tx.custom.hint(formatDateTime(new Date(limit))) : undefined}
                  error={customError}
                  required
                />
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" size="sm" loading={pending === "custom"} disabled={extend.isPending && pending !== "custom"} icon={<IconHourglass className="size-4" aria-hidden />}>
                    {tx.custom.submit}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" disabled={extend.isPending} onClick={() => setCustomOpen(false)}>
                    {tx.custom.cancel}
                  </Button>
                </div>
              </form>
            )}
            <p className="mt-3 text-[13px] leading-snug text-faint">{anyAllowed ? tx.lead : tx.tooLate}</p>
          </>
        )}
      </div>
    </Section>
  );
}
