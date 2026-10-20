import { useRef, useState, type HTMLAttributes, type PointerEvent } from "react";
import { Link } from "react-router-dom";
import { IconBack, IconCheck, IconForward, IconPlus } from "@/components/icons";
import { Button, ButtonLink, IconButton } from "@/components/ui/Button";
import { DemoBadge } from "@/components/ui/Feedback";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { formatDistance } from "@/lib/format";
import { openStateAt } from "@/lib/hours";
import { rankStage, type Ranked } from "@/lib/stage";
import { ActivityCover, usePollToggle } from "./ActivityCard";
import { openLabel, priceLabel } from "./display";

/** Ab so vielen Pixeln seitlich gilt eine Wischbewegung als Blättern. */
const SWIPE_THRESHOLD = 70;

/**
 * Welche Orte liegen im Stapel? Bevorzugt die, die laut bekannten Öffnungszeiten jetzt offen haben,
 * dann die näheren. Ohne beides bleibt die Reihenfolge der Suche – nichts wird geraten.
 */
export function stageDeck<T extends Ranked>(results: T[], now: Date = new Date()): T[] {
  return rankStage(results, (activity) => openStateAt(activity.opening_hours, now).state === "open");
}

interface StageDeckProps {
  deck: Ranked[];
  index: number;
  onStep: (step: 1 | -1) => void;
  now?: Date;
}

/**
 * V2 Discover: Orte als Kartenstapel. Oben liegt ein Ort groß – Kategorie-Grafik auf ihrer Farbwelt,
 * Name als Plakat, Eckdaten als Pillen, zwei klare Aktionen. Mit den Pfeilen oder per Wischen über das
 * Bild kommt der nächste Ort nach vorn; der vorige wandert zurück in die Liste darunter.
 */
export function StageDeck({ deck, index, onStep, now = new Date() }: StageDeckProps) {
  const [entering, setEntering] = useState<"next" | "prev" | null>(null);
  const [drag, setDrag] = useState(0);
  const startX = useRef<number | null>(null);
  const current = deck[index] ?? deck[0];
  if (!current) return null;
  const many = deck.length > 1;

  function step(dir: 1 | -1) {
    setEntering(dir === 1 ? "next" : "prev");
    onStep(dir);
  }
  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!many || (e.pointerType === "mouse" && e.button !== 0)) return;
    startX.current = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (startX.current != null) setDrag(e.clientX - startX.current);
  }
  function onPointerUp() {
    if (startX.current == null) return;
    const moved = drag;
    startX.current = null;
    setDrag(0);
    if (moved < -SWIPE_THRESHOLD) step(1);
    else if (moved > SWIPE_THRESHOLD) step(-1);
  }

  const position = deck.indexOf(current) + 1;
  return (
    <section aria-label={t.discover.stage.deck}>
      <div className={cn(many && "ticket-feature-wrap")}>
        <StageCard
          key={current.activity.id}
          activity={current.activity}
          distanceKm={current.distanceKm}
          now={now}
          entering={entering}
          drag={drag}
          artHandlers={many ? { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp } : undefined}
        />
      </div>
      {many && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <IconButton label={t.discover.stage.previous} variant="secondary" onClick={() => step(-1)}>
            <IconBack className="size-5" aria-hidden />
          </IconButton>
          <p className="text-center text-[13px] text-muted">
            <span className="font-display text-[15px] font-bold text-fg">{t.discover.stage.position(position, deck.length)}</span>
            <span className="ml-2 hidden sm:inline">{t.discover.stage.swipeHint}</span>
            <span className="sr-only" aria-live="polite">
              {t.discover.stage.positionLabel(position, deck.length, current.activity.name)}
            </span>
          </p>
          <IconButton label={t.discover.stage.next} variant="secondary" onClick={() => step(1)}>
            <IconForward className="size-5" aria-hidden />
          </IconButton>
        </div>
      )}
    </section>
  );
}

interface StageCardProps extends Ranked {
  now: Date;
  entering: "next" | "prev" | null;
  drag: number;
  artHandlers?: Pick<HTMLAttributes<HTMLDivElement>, "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel">;
}

function StageCard({ activity, distanceKm, now, entering, drag, artHandlers }: StageCardProps) {
  const { selected, toggle } = usePollToggle(activity);
  const state = openStateAt(activity.opening_hours, now);
  const isOpen = state.state === "open";
  const meta: { text: string; lime?: boolean }[] = [
    { text: t.enums.category[activity.category] },
    isOpen ? { text: t.discover.stage.openUntil(state.closesAt), lime: true } : { text: openLabel(activity, now).text },
    { text: priceLabel(activity) },
  ];
  // Entfernung nur mit Koordinaten – und ehrlich als Luftlinie ab Stadtmitte, nicht ab deinem Standort.
  if (distanceKm != null) meta.push({ text: t.discover.distanceFromCenter(formatDistance(distanceKm)) });

  return (
    <article
      className={cn(
        "stage-card deck-top relative overflow-hidden border lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]",
        selected ? "border-lime" : "border-white/[0.08]",
        entering && `is-entering-${entering}`,
      )}
      style={drag ? { transform: `translateX(${drag}px) rotate(${drag / 30}deg)` } : undefined}
    >
      <div className={cn("stage-art relative p-2 lg:pr-0", artHandlers && "cursor-grab active:cursor-grabbing")} {...artHandlers}>
        <ActivityCover activity={activity} className="aspect-[16/10] rounded-[24px] lg:aspect-auto lg:h-full lg:min-h-[280px]" />
        {isOpen && (
          <span className="glass absolute left-5 top-5 inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-[13px] font-semibold text-lime">
            <span className="size-2 rounded-full bg-lime" aria-hidden />
            {t.discover.stage.openNow}
          </span>
        )}
        {activity.is_demo && <DemoBadge className="absolute right-5 top-5 bg-nav/85" />}
      </div>
      <div className="flex flex-col p-4 pt-3 sm:p-5 sm:pt-4 lg:justify-end lg:p-7">
        <h2 className="display chrome break-words text-[24px] uppercase sm:text-[30px]">
          <Link to={`/activities/${activity.id}`} className="rounded-sm hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime">
            {activity.name}
          </Link>
        </h2>
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t.discover.stage.facts}>
          {meta.map((item, i) => (
            <li key={i} className={cn("rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[13px]", item.lime ? "text-lime" : "text-muted")}>
              {item.text}
            </li>
          ))}
        </ul>
        <div className="mt-5 grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-2.5">
          <Button
            size="lg"
            variant={selected ? "secondary" : "primary"}
            onClick={toggle}
            aria-pressed={selected}
            aria-label={selected ? t.discover.card.removeFromPoll(activity.name) : `${activity.name}: ${t.discover.card.addToPoll}`}
            icon={selected ? <IconCheck className="size-4" strokeWidth={3} aria-hidden /> : <IconPlus className="size-4" aria-hidden />}
          >
            {selected ? t.discover.stage.addedToPoll : t.discover.stage.addToPoll}
          </Button>
          <ButtonLink to={`/activities/${activity.id}`} size="lg" variant="secondary">
            {t.discover.card.details}
          </ButtonLink>
        </div>
      </div>
    </article>
  );
}
