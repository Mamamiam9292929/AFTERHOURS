import { useEffect, useRef, useState, type PointerEvent } from "react";
import { IconCheck, IconClose, IconHelp } from "@/components/icons";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import type { VoteResponse } from "@/lib/types";
import type { OptionTally } from "./logic";

/** Farbwelten der Karten (V2): wechseln von Karte zu Karte, Text ist immer weiß (Kontrast ≥ 4.5:1). */
const DECKS = [
  "linear-gradient(155deg,#5b3fe0,#b81f68)",
  "linear-gradient(155deg,#1d4fd6,#0b7d6c)",
  "linear-gradient(155deg,#b81f68,#b5470a)",
  "linear-gradient(155deg,#0b7d6c,#5b3fe0)",
];

const THRESHOLD = 110;

interface Leaving {
  tally: OptionTally;
  dir: -1 | 0 | 1;
  background: string;
}

/**
 * S6 · Wischen statt Liste. Vorschläge ohne eigene Antwort liegen als Kartenstapel: nach rechts wischen
 * (oder ✓) = dabei, nach links (oder ✕) = eher nicht, ? = vielleicht. Gleiche Stimmen-RPC wie die Liste
 * darunter; dort lässt sich jede Antwort jederzeit ändern. Ziehen ist nur eine Abkürzung – alle drei
 * Antworten sind echte Knöpfe (Tastatur, Screenreader).
 */
export function SwipeDeck({
  tallies,
  onVote,
  when,
  memberCount,
}: {
  tallies: OptionTally[];
  onVote: (optionId: string, response: VoteResponse) => void;
  when: (tally: OptionTally) => string;
  memberCount: number;
}) {
  const open = tallies.filter((tally) => tally.mine === null);
  const [leaving, setLeaving] = useState<Leaving | null>(null);
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  const [started] = useState(() => open.length);
  const deck = open.filter((tally) => tally.option.id !== leaving?.tally.option.id);
  const top = deck[0];
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Match: Ein Vorschlag, bei dem jetzt alle Mitglieder dabei sind – nur, wenn es in dieser Sitzung passiert.
  const matched = useRef(new Set(tallies.filter((tally) => memberCount >= 2 && tally.yes.length >= memberCount).map((tally) => tally.option.id)));
  const [match, setMatch] = useState<string | null>(null);
  useEffect(() => {
    if (memberCount < 2) return;
    const hit = tallies.find((tally) => tally.yes.length >= memberCount && !matched.current.has(tally.option.id));
    if (!hit) return;
    matched.current.add(hit.option.id);
    setMatch(hit.option.title);
    const timer = window.setTimeout(() => setMatch(null), 3200);
    return () => window.clearTimeout(timer);
  }, [tallies, memberCount]);

  function answer(response: VoteResponse, dir: -1 | 0 | 1) {
    // Schnelles Tippen darf keine Antwort verschlucken: eine noch fliegende Karte wird einfach ersetzt.
    if (!top) return;
    setLeaving({ tally: top, dir, background: DECKS[(started - deck.length) % DECKS.length] ?? DECKS[0]! });
    setDrag(0);
    onVote(top.option.id, response);
    const id = top.option.id;
    window.setTimeout(() => setLeaving((current) => (current?.tally.option.id === id ? null : current)), reduced ? 0 : 420);
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    start.current = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (start.current !== null) setDrag(e.clientX - start.current);
  }
  function onPointerUp() {
    if (start.current === null) return;
    start.current = null;
    if (drag > THRESHOLD) answer("yes", 1);
    else if (drag < -THRESHOLD) answer("no", -1);
    else setDrag(0);
  }

  if (started === 0) return null;

  return (
    <section aria-labelledby="swipe-title" className="relative mb-8" data-testid="swipe-deck">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 id="swipe-title" className="display text-[20px] text-fg">
          {t.polls.swipe.title}
        </h2>
        {deck.length > 0 && <span className="text-sm font-semibold text-muted">{t.polls.swipe.left(deck.length)}</span>}
      </div>

      {deck.length === 0 && !leaving ? (
        <p className="rounded-card border border-white/10 bg-white/[0.04] p-5 text-[15px] text-muted">{t.polls.swipe.done}</p>
      ) : (
        <>
          <div className="relative mx-auto h-[300px] max-w-md select-none sm:h-[340px]">
            {deck
              .slice(0, 3)
              .reverse()
              .map((tally) => {
                const depth = deck.indexOf(tally);
                const isTop = depth === 0;
                const tilt = isTop ? drag / 18 : depth % 2 ? 3 : -3;
                const transform = isTop ? `translateX(${drag}px) rotate(${tilt}deg)` : `translateY(${depth * 14}px) scale(${1 - depth * 0.06}) rotate(${tilt}deg)`;
                return (
                  <div
                    key={tally.option.id}
                    aria-hidden={!isTop}
                    onPointerDown={isTop ? onPointerDown : undefined}
                    onPointerMove={isTop ? onPointerMove : undefined}
                    onPointerUp={isTop ? onPointerUp : undefined}
                    onPointerCancel={isTop ? onPointerUp : undefined}
                    className={cn(
                      "absolute inset-0 flex touch-pan-y flex-col justify-between rounded-[32px] border border-white/20 p-6 text-white shadow-[0_30px_60px_-25px_rgb(0_0_0/0.9)]",
                      isTop ? "cursor-grab active:cursor-grabbing" : "pointer-events-none",
                      start.current === null && "transition-transform duration-500 ease-[var(--ease-out-soft)]",
                    )}
                    style={{ transform, zIndex: 10 - depth, background: DECKS[(started - deck.length + depth) % DECKS.length] }}
                  >
                    {isTop && Math.abs(drag) > 30 && (
                      <span
                        aria-hidden
                        className={cn(
                          "absolute top-6 rounded-[10px] border-[3px] px-3 py-1.5 font-display text-[15px] font-black uppercase",
                          drag > 0 ? "left-6 -rotate-12 border-lime text-lime" : "right-6 rotate-12 border-danger text-danger",
                        )}
                      >
                        {drag > 0 ? t.polls.swipe.yes : t.polls.swipe.no}
                      </span>
                    )}
                    <span className="self-end rounded-full bg-black/30 px-3 py-1.5 text-[13px] font-bold">{t.polls.swipe.going(tally.yes.length)}</span>
                    <div>
                      <p className="display break-words text-[34px] uppercase leading-[0.95] sm:text-[40px]">{tally.option.title}</p>
                      <p className="mt-3 text-[16px] font-bold">{when(tally)}</p>
                    </div>
                  </div>
                );
              })}
            {leaving && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-end rounded-[32px] border border-white/20 p-6 text-white"
                style={{
                  background: leaving.background,
                  animation: reduced ? undefined : `${leaving.dir === 1 ? "swipe-right" : leaving.dir === -1 ? "swipe-left" : "swipe-up"} 0.42s var(--ease-out-soft) forwards`,
                }}
              >
                <p className="display break-words text-[34px] uppercase leading-[0.95] sm:text-[40px]">{leaving.tally.option.title}</p>
              </div>
            )}
          </div>
          {top && (
            <div className="mt-6 flex items-center justify-center gap-4" role="group" aria-label={t.polls.swipe.card(top.option.title, when(top))}>
              <button type="button" onClick={() => answer("no", -1)} aria-label={`${t.polls.swipe.no}: ${top.option.title}`} className="flex size-16 items-center justify-center rounded-full border border-white/15 bg-white/[0.07] text-danger transition-transform active:scale-90">
                <IconClose className="size-7" aria-hidden />
              </button>
              <button type="button" onClick={() => answer("maybe", 0)} aria-label={`${t.polls.swipe.maybe}: ${top.option.title}`} className="flex size-13 items-center justify-center rounded-full border border-white/15 bg-white/[0.07] text-amber transition-transform active:scale-90">
                <IconHelp className="size-6" aria-hidden />
              </button>
              <button type="button" onClick={() => answer("yes", 1)} aria-label={`${t.polls.swipe.yes}: ${top.option.title}`} className="flex size-20 items-center justify-center rounded-full bg-lime text-lime-ink shadow-[0_16px_40px_-10px_var(--color-lime)] transition-transform active:scale-90">
                <IconCheck className="size-9" aria-hidden />
              </button>
            </div>
          )}
          <p className="mt-3 text-center text-[13px] text-faint">{t.polls.swipe.hint}</p>
        </>
      )}

      {match && (
        <div role="status" className="pointer-events-none fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black/60 px-6 text-center backdrop-blur-sm" style={{ animation: "fade-in 0.2s ease-out" }}>
          <p className="display chrome text-[76px] uppercase leading-none" style={{ animation: "pop-in 0.7s var(--ease-out-soft) both" }}>
            {t.polls.swipe.match}
          </p>
          <p className="mt-4 text-lg font-bold text-lime">{t.polls.swipe.matchBody(match)}</p>
        </div>
      )}
    </section>
  );
}
