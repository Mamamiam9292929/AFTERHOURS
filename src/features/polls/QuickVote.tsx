import { useState } from "react";
import { Link } from "react-router-dom";
import { useToast } from "@/components/ui/Toast";
import { t } from "@/i18n";
import { pendingOptions, type QuickResponse } from "@/lib/quickvote";
import { formatPlainDate, formatPlainTime } from "@/lib/time";
import type { PollOption } from "@/lib/types";
import { useVote } from "./api";
import { summarizePoll, type PollWithDetails } from "./logic";

const ANSWERS: { response: QuickResponse; label: string }[] = [
  { response: "yes", label: t.enums.vote.yes },
  { response: "maybe", label: t.enums.vote.maybe },
  { response: "no", label: t.enums.vote.no },
];

/** Wann der Vorschlag stattfindet – bei „Wann könnt ihr?“ ist der Titel schon das Datum (P1). */
function optionWhen(option: PollOption, isDate: boolean): string | null {
  if (isDate) return option.proposed_time ? formatPlainTime(option.proposed_time) : null;
  if (!option.proposed_date) return null;
  const date = formatPlainDate(option.proposed_date);
  return option.proposed_time ? `${date}, ${formatPlainTime(option.proposed_time)}` : date;
}

interface PollQuickVoteProps {
  poll: PollWithDetails;
  memberIds: string[];
  userId: string;
  now: Date;
  /** Erster Tipp: Home hält die Abstimmung dann unter „Deine Antwort fehlt“, bis du durch bist. */
  onTouched: (pollId: string) => void;
}

/**
 * D3 Etappe 1 · Abstimmen direkt auf Home: Unter der Abstimmung liegt der nächste Vorschlag ohne deine
 * Antwort als Glas-Karte mit „Bin dabei / Vielleicht / Bin nicht dabei“ – ein Tipp speichert (gleiche RPC
 * `cast_vote` wie auf der Abstimmung) und legt sofort den nächsten Vorschlag auf. „Überspringen“ lässt einen
 * Vorschlag ohne Antwort; geändert wird auf der Abstimmung. Schlägt das Speichern fehl, kommt der Vorschlag zurück.
 */
export function PollQuickVote({ poll, memberIds, userId, now, onTouched }: PollQuickVoteProps) {
  const toast = useToast();
  const vote = useVote(poll.id);
  const [answered, setAnswered] = useState<ReadonlyMap<string, QuickResponse>>(new Map());
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const tallies = summarizePoll(poll, memberIds, userId, now).tallies;
  const options = tallies.map((tally) => ({ id: tally.option.id, mine: tally.mine, option: tally.option, going: tally.yes.length }));
  const pending = pendingOptions(options, new Set(answered.keys()), skipped);
  const current = pending[0];
  const isDate = poll.kind === "date";

  async function answer(optionId: string, response: QuickResponse) {
    onTouched(poll.id);
    setAnswered((map) => new Map(map).set(optionId, response));
    try {
      await vote.mutateAsync({ optionId, response });
    } catch (error) {
      setAnswered((map) => {
        const next = new Map(map);
        next.delete(optionId);
        return next;
      });
      toast.error(error);
    }
  }

  function skip(optionId: string) {
    onTouched(poll.id);
    setSkipped((set) => new Set(set).add(optionId));
  }

  if (!current) {
    // Nur erreichbar, wenn du hier angefangen hast – sonst stünde die Abstimmung nicht unter „Deine Antwort fehlt“.
    return (
      <div role="status" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-card border border-lime/40 bg-lime/[0.08] px-4 py-3.5" data-testid="poll-quick-done">
        <p className="text-[15px] font-semibold text-fg">{t.home.quickVote.done}</p>
        <Link to={`/polls/${poll.id}`} className="inline-flex h-9 items-center text-[14px] font-semibold text-lime underline decoration-line-strong underline-offset-4 hover:decoration-lime">
          {t.home.quickVote.open}
        </Link>
      </div>
    );
  }

  const position = options.findIndex((o) => o.id === current.id) + 1;
  const when = optionWhen(current.option, isDate);

  return (
    <section aria-label={t.home.quickVote.label(poll.title)} className="rounded-card border border-white/10 bg-white/[0.04] p-4" data-testid="poll-quick-vote">
      <div className="flex items-center justify-between gap-3 text-[13px] text-muted">
        <span className="font-semibold" data-testid="poll-quick-progress">
          {t.home.quickVote.progress(position, options.length)}
        </span>
        <button
          type="button"
          onClick={() => skip(current.id)}
          className="-mr-2 inline-flex h-9 items-center rounded-full px-2 font-semibold text-muted underline decoration-line-strong underline-offset-4 hover:text-fg"
        >
          {t.home.quickVote.skip}
        </button>
      </div>
      {/* Neuer Schlüssel je Vorschlag: der nächste legt sich von hinten auf (aus bei reduzierter Bewegung). */}
      <div key={current.id} style={{ animation: "deck-in-next 0.35s var(--ease-out-soft) both" }}>
        <p className="display mt-1 break-words text-[22px] uppercase leading-[0.95] text-fg" data-testid="poll-quick-option">
          {current.option.title}
        </p>
        <p className="mt-1.5 text-[14px] text-muted">{[when, t.polls.swipe.going(current.going)].filter(Boolean).join(" · ")}</p>
        <div role="group" aria-label={t.home.quickVote.answer(current.option.title)} className="quick-answer mt-3.5 grid grid-cols-3 gap-2">
          {ANSWERS.map(({ response, label }) => (
            <button key={response} type="button" data-response={response} onClick={() => void answer(current.id, response)} className="vote-pill">
              {label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
