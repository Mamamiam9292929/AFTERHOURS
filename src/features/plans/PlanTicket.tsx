import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { IconClock, IconPin, IconRepeat } from "@/components/icons";
import { AvatarStack, type Person } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Feedback";
import { LivePill } from "@/components/ui/Pill";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { formatCountdown, liveCountdown } from "@/lib/quickvote";
import { calendarDaysBetween, formatTime, ticketDate, zonedParts } from "@/lib/time";
import type { AttendanceStatus, Crew, PlanStatus } from "@/lib/types";
import type { PlanWithParticipants } from "./api";
import "@/styles/motion.css";

/** Eigene Antwort auf einem Ticket: offen (`none` = nicht eingeladen) oder `past` bei vergangenen/abgesagten Plänen. */
export type TicketAnswer = AttendanceStatus | "none" | "past";

export function ticketAnswer(plan: { status: PlanStatus; participants: { user_id: string; attendance_status: AttendanceStatus }[] }, userId: string): TicketAnswer {
  if (plan.status === "completed" || plan.status === "cancelled") return "past";
  return plan.participants.find((p) => p.user_id === userId)?.attendance_status ?? "none";
}

/**
 * V2: Die ganze Karte trägt deine Antwort (Benitos Wunsch): grün dabei, gelb vielleicht, rot abgesagt
 * (Farbe kommt aus `.ticket[data-answer]` in index.css). Das Datum steht dann direkt auf der Farbe;
 * ohne Antwort sitzt es auf einer hellen Kachel, bei Vergangenem gedämpft.
 */
const STUB_TONE: Record<TicketAnswer, string> = {
  going: "text-fg",
  maybe: "text-fg",
  declined: "text-fg",
  invited: "bg-white/[0.07] text-fg",
  none: "bg-white/[0.07] text-fg",
  past: "bg-white/[0.04] text-muted",
};

/** Textfarbe für die Antwortzeile und Gruppen – dieselbe Zuordnung wie der Abriss. */
export const ANSWER_TEXT: Record<AttendanceStatus, string> = {
  going: "text-lime",
  maybe: "text-amber",
  declined: "text-danger",
  invited: "text-fg",
};

export function planStatusBadge(status: PlanStatus, skipped = false): ReactNode {
  // P8 Etappe 2: ein ausgesetzter Stammtisch-Termin ist keine Absage der Runde.
  if (status === "cancelled" && skipped) return <Badge tone="neutral">{t.plans.repeat.badge}</Badge>;
  const tone = status === "confirmed" || status === "booked" ? "lime" : status === "booking_pending" ? "amber" : status === "cancelled" ? "danger" : "neutral";
  return <Badge tone={tone}>{t.enums.planStatus[status]}</Badge>;
}

/**
 * P8 Etappe 3: Gehört der Plan zu einem Stammtisch, trägt das Ticket „↻ Stammtisch“ – für Screenreader
 * mit der Regel („Jeden Freitag“), solange die Serie läuft.
 */
function SeriesMark({ plan, className }: { plan: PlanWithParticipants; className?: string }) {
  if (!plan.series_id) return null;
  const rule = plan.series?.active ? t.plans.repeat.rule(plan.series.rule, plan.series.weekday, plan.series.nth) : null;
  return (
    <span className={cn("inline-flex items-center gap-1 font-semibold text-fg", className)} title={rule ?? undefined} data-testid="ticket-series">
      <IconRepeat className="size-3.5 shrink-0" aria-hidden />
      {t.plans.ticket.series}
      {rule && <span className="sr-only">: {rule}</span>}
    </span>
  );
}

const STAMP: Partial<Record<TicketAnswer, string>> = {
  going: t.plans.ticket.stamp.going,
  maybe: t.plans.ticket.stamp.maybe,
  declined: t.plans.ticket.stamp.declined,
};

/**
 * Für den Übergang zur Planseite: Das angetippte Ticket bekommt den View-Transition-Namen, den dort das
 * große Ticket trägt. Nur ein Element darf ihn gleichzeitig haben, deshalb wird ein älteres freigegeben.
 */
let namedTicket: HTMLElement | null = null;
function nameForTransition(event: MouseEvent<HTMLElement>) {
  if (namedTicket) namedTicket.style.viewTransitionName = "";
  const el = event.currentTarget.closest<HTMLElement>(".ticket-feature-wrap") ?? event.currentTarget;
  el.style.viewTransitionName = "plan-ticket";
  namedTicket = el;
}

/** Zählt, wie oft sich ein Wert seit dem Laden geändert hat – 0 heißt: nichts animieren. */
function useChangeCount<T>(value: T): number {
  const previous = useRef(value);
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    setCount((c) => c + 1);
  }, [value]);
  return count;
}

/** D1: Status, mit denen ein Plan „fest“ wird. */
const FIRM: PlanStatus[] = ["confirmed", "booked"];

/**
 * D1 · Der Moment, in dem ein Plan fest wird: Wechselt der Status (während die Karte zu sehen ist) auf
 * bestätigt oder reserviert, liefert der Hook für gut eine Sekunde eine laufende Nummer (Ring, aufgefächerter
 * Stapel), sonst 0. Beim Laden und bei reduzierter Bewegung passiert nichts.
 */
function useConfirmMoment(status: PlanStatus, statusChanges: number): number {
  const [moment, setMoment] = useState(0);
  useEffect(() => {
    if (statusChanges === 0 || !FIRM.includes(status) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setMoment(statusChanges);
    const timer = window.setTimeout(() => setMoment(0), 1400);
    return () => window.clearTimeout(timer);
  }, [status, statusChanges]);
  return moment;
}

const MY_STATUS: Record<AttendanceStatus, string> = {
  invited: t.plans.ticket.yourAnswerOpen,
  going: t.plans.ticket.youGoing,
  maybe: t.plans.ticket.youMaybe,
  declined: t.plans.ticket.youDeclined,
};

interface PlanTicketProps {
  plan: PlanWithParticipants;
  crew?: Crew;
  userId: string;
  lookup: (id: string | null | undefined) => Person | null;
  /** Farbe hinter dem Ticket, damit die Kerben stimmen. */
  cutout?: string;
  className?: string;
}

/**
 * Ein Plan als Ticket: links der Abriss mit dem Datum, rechts was, wann, wo und wer.
 * Der Abriss zeigt deine Antwort in Farbe (grün/gelb/rot); ohne Antwort und bei Vergangenem bleibt er grau.
 */
export function PlanTicket({ plan, crew, userId, lookup, cutout, className }: PlanTicketProps) {
  const date = ticketDate(plan.starts_at);
  const going = plan.participants.filter((p) => p.attendance_status === "going");
  const mine = plan.participants.find((p) => p.user_id === userId)?.attendance_status;
  const active = plan.status !== "completed" && plan.status !== "cancelled";
  const answer = ticketAnswer(plan, userId);

  const body = (
    <>
      <div className={cn("ticket-stub flex flex-col items-center justify-center px-2 py-4 text-center", STUB_TONE[answer])}>
        <span className="text-[13px] font-bold">{date.weekday}</span>
        <span className="font-display text-[35px] font-extrabold leading-[0.9] sm:text-[40px]">{date.day}</span>
        <span className="text-[13px] font-bold">{date.month}</span>
      </div>
      <div className="flex min-w-0 flex-col justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-x-3 gap-y-2">
            <h3 className={cn("min-w-0 break-words text-[17px] font-bold leading-tight text-fg", plan.status === "cancelled" && "line-through")}>{plan.title}</h3>
            <span className="shrink-0">{planStatusBadge(plan.status, Boolean(plan.skipped_at))}</span>
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span className="inline-flex items-center gap-1.5">
              <IconClock className="size-4 shrink-0" aria-hidden />
              {formatTime(plan.starts_at)}
            </span>
            <SeriesMark plan={plan} />
            {crew && (
              <span className="min-w-0 truncate">
                {crew.emoji} {crew.name}
              </span>
            )}
          </p>
          {(plan.address || plan.meeting_point) && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
              <IconPin className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{plan.address ?? plan.meeting_point}</span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <span className="flex items-center gap-2 text-sm font-semibold text-fg">
            <AvatarStack people={going.map((p) => lookup(p.user_id))} max={5} />
            {t.plans.ticket.going(going.length)}
          </span>
          {active && mine && (
            <span className={cn("text-[13px] font-semibold", ANSWER_TEXT[mine])}>{MY_STATUS[mine]}</span>
          )}
        </div>
      </div>
    </>
  );

  const style = cutout ? ({ ["--ticket-cutout" as string]: cutout } as React.CSSProperties) : undefined;
  return (
    <Link
      to={`/plans/${plan.id}`}
      onClick={nameForTransition}
      data-answer={answer}
      className={cn("ticket transition-[filter,transform] duration-200 hover:brightness-110 focus-visible:outline-offset-4 active:scale-[0.985]", className)}
      style={style}
    >
      {body}
    </Link>
  );
}

/**
 * Wie weit ist der Plan weg? „Heute Abend“, „Morgen“, „In 3 Tagen“ – nur für anstehende Pläne in den
 * nächsten 13 Tagen, sonst nichts (das Datum steht ohnehin im Abriss).
 */
export function planCountdown(plan: { starts_at: string; status: PlanStatus }, now: Date): string | null {
  if (plan.status === "completed" || plan.status === "cancelled") return null;
  const days = calendarDaysBetween(now, plan.starts_at);
  if (days < 0 || days > 13) return null;
  if (days === 0) return zonedParts(plan.starts_at).hour >= 17 ? t.plans.ticket.countdown.tonight : t.plans.ticket.countdown.today;
  return days === 1 ? t.plans.ticket.countdown.tomorrow : t.plans.ticket.countdown.days(days);
}

interface FeatureTicketProps extends Omit<PlanTicketProps, "cutout" | "className"> {
  /** Kopf der Planseite (D0 Etappe 5a): ohne Link, Titel als h1, mit Countdown. */
  hero?: boolean;
  now?: Date;
  /** D3 Etappe 1 · Home: in den letzten 12 Stunden zählt das Ticket live herunter („Noch 2:14 h“, „Läuft gerade“). */
  live?: boolean;
}

/**
 * Der Plan als großes Ticket – der eine große Moment auf Home und im Kopf der Planseite (D0).
 * Echte Löcher statt aufgemalter Kerben (CSS-Maske), dadurch passt es auf jeden Hintergrund.
 * Leicht schräg; bei Zeiger oder Fokus richtet es sich auf. Der Strichcode ist reine Dekoration.
 */
export function FeatureTicket({ plan, crew, userId, lookup, hero = false, now, live = false }: FeatureTicketProps) {
  const date = ticketDate(plan.starts_at);
  const going = plan.participants.filter((p) => p.attendance_status === "going");
  const mine = plan.participants.find((p) => p.user_id === userId)?.attendance_status;
  const active = plan.status !== "completed" && plan.status !== "cancelled";
  const place = plan.address ?? plan.meeting_point;
  const countdown = hero && now ? planCountdown(plan, now) : null;
  const running = live && now ? liveCountdown(plan, now) : null;
  const Title = hero ? "h1" : "h2";
  const answer = ticketAnswer(plan, userId);
  const changes = useChangeCount(answer);
  const statusChanges = useChangeCount(plan.status);
  const ticketRef = useRef<HTMLDivElement>(null);
  const moment = useConfirmMoment(plan.status, statusChanges);

  // Ändert sich die Antwort, gibt das Ticket kurz nach – wie beim Abstempeln. Beim Laden passiert nichts.
  useEffect(() => {
    if (changes === 0 || !ticketRef.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    ticketRef.current.animate(
      [{ transform: "translateY(0) scale(1)" }, { transform: "translateY(3px) scale(0.985)", offset: 0.35 }, { transform: "translateY(0) scale(1)" }],
      { duration: 420, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  }, [changes]);

  const stamp = STAMP[answer];
  const body = (
    <>
      <div className={cn("ticket-stub flex flex-col items-center justify-center gap-1 px-2 py-5 text-center", STUB_TONE[answer])}>
        <span className="text-[15px] font-bold uppercase tracking-wide">{date.weekday}</span>
        <span className="font-display text-[55px] font-extrabold leading-[0.85] sm:text-[66px]">{date.day}</span>
        <span className="text-[15px] font-bold uppercase tracking-wide">{date.month}</span>
        {stamp ? (
          <span key={`${answer}-${changes}`} className={cn("ticket-stamp", changes > 0 && "is-new")} aria-hidden>
            {stamp}
          </span>
        ) : (
          <span className="ticket-barcode mt-3" aria-hidden />
        )}
      </div>
      <div className="flex min-w-0 flex-col justify-between gap-4 p-5 sm:p-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {/* D1: Ändert sich der Status, springt die Plakette neu auf (key erzwingt die Animation). */}
            <span key={`${plan.status}-${statusChanges}`} className={cn("inline-flex", statusChanges > 0 && "badge-pop")} data-testid="ticket-status">
              {planStatusBadge(plan.status, Boolean(plan.skipped_at))}
            </span>
            <SeriesMark plan={plan} className="text-[13px]" />
            {countdown && <span className="font-display text-[14px] font-extrabold uppercase leading-none tracking-wide text-lime">{countdown}</span>}
            {running && (
              <LivePill testId="ticket-live" className="h-7 px-3">
                {running.kind === "live" ? t.home.live.now : t.home.live.soon(formatCountdown(running.minutes))}
              </LivePill>
            )}
          </div>
          <Title className={cn("display mt-3 break-words text-[23px] text-fg sm:text-[32px]", plan.status === "cancelled" && "line-through decoration-2")}>{plan.title}</Title>
          <p className="mt-2.5 truncate text-[15px] text-muted">
            <span className="font-semibold text-fg">{formatTime(plan.starts_at)}</span>
            {place && ` · ${place}`}
          </p>
          {crew && !hero && (
            <p className="mt-1 truncate text-[15px] text-muted">
              {crew.emoji} {crew.name}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <AvatarStack people={going.map((p) => lookup(p.user_id))} max={5} size="md" />
          <span className="ml-auto flex items-baseline gap-1.5 text-[15px] font-semibold text-muted">
            <span className="font-display text-[24px] font-extrabold leading-none text-fg">{going.length}</span>
            {t.plans.ticket.goingOf(plan.participants.length)}
          </span>
        </div>
        {active && mine && <span className={cn("text-[13px] font-semibold", mine === "going" ? "sr-only" : ANSWER_TEXT[mine])}>{MY_STATUS[mine]}</span>}
      </div>
    </>
  );

  return (
    <div className={cn("ticket-feature-wrap", hero && !active && "ticket-feature-past", hero && "vt-plan-ticket")} data-answer={answer} data-moment={moment ? "confirmed" : undefined}>
      {moment && <span key={moment} className="ticket-confirm-ring" aria-hidden data-testid="ticket-confirm-ring" />}
      {hero ? (
        <div ref={ticketRef} className="ticket ticket-feature" data-answer={answer}>
          {body}
        </div>
      ) : (
        <Link to={`/plans/${plan.id}`} onClick={nameForTransition} className="ticket ticket-feature" data-answer={answer}>
          {body}
        </Link>
      )}
    </div>
  );
}
