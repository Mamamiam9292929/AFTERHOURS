import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { IconClock, IconPin } from "@/components/icons";
import { AvatarStack, type Person } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Feedback";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { formatTime, ticketDate } from "@/lib/time";
import type { AttendanceStatus, Crew, PlanStatus } from "@/lib/types";
import type { PlanWithParticipants } from "./api";

const STUB_TONE: Record<PlanStatus, string> = {
  proposed: "bg-raised text-fg",
  confirmed: "bg-lime text-lime-ink",
  booking_pending: "bg-lime text-lime-ink",
  booked: "bg-lime text-lime-ink",
  completed: "bg-raised text-muted",
  cancelled: "bg-raised text-faint",
};

export function planStatusBadge(status: PlanStatus): ReactNode {
  const tone = status === "confirmed" || status === "booked" ? "lime" : status === "booking_pending" ? "amber" : status === "cancelled" ? "danger" : "neutral";
  return <Badge tone={tone}>{t.enums.planStatus[status]}</Badge>;
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
  /** Ohne Link – für den Kopf der Detailseite. */
  hero?: boolean;
  /** Farbe hinter dem Ticket, damit die Kerben stimmen. */
  cutout?: string;
  className?: string;
}

/**
 * Ein Plan als Ticket: links der Abriss mit dem Datum, rechts was, wann, wo und wer.
 * Lime bedeutet "steht fest"; Vorschläge und Vergangenes bleiben grau.
 */
export function PlanTicket({ plan, crew, userId, lookup, hero = false, cutout, className }: PlanTicketProps) {
  const date = ticketDate(plan.starts_at);
  const going = plan.participants.filter((p) => p.attendance_status === "going");
  const mine = plan.participants.find((p) => p.user_id === userId)?.attendance_status;
  const active = plan.status !== "completed" && plan.status !== "cancelled";

  const body = (
    <>
      <div className={cn("ticket-stub flex flex-col items-center justify-center px-2 py-4 text-center", STUB_TONE[plan.status])}>
        <span className="text-[13px] font-bold">{date.weekday}</span>
        <span className={cn("font-display font-extrabold leading-[0.9]", hero ? "text-[60px] sm:text-[72px]" : "text-[48px] sm:text-[56px]")}>{date.day}</span>
        <span className="text-[13px] font-bold">{date.month}</span>
      </div>
      <div className={cn("flex min-w-0 flex-col justify-between gap-3", hero ? "p-5 sm:p-6" : "p-4")}>
        <div className="min-w-0">
          <div className={cn("flex justify-between gap-x-3 gap-y-2", hero ? "flex-col-reverse items-start sm:flex-row" : "items-start")}>
            {hero ? (
              <h1 className={cn("display min-w-0 break-words text-[36px] text-fg sm:text-[44px]", plan.status === "cancelled" && "line-through decoration-2")}>{plan.title}</h1>
            ) : (
              <h3 className={cn("min-w-0 break-words text-[17px] font-bold leading-tight text-fg", plan.status === "cancelled" && "line-through")}>{plan.title}</h3>
            )}
            <span className="shrink-0">{planStatusBadge(plan.status)}</span>
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span className="inline-flex items-center gap-1.5">
              <IconClock className="size-4 shrink-0" aria-hidden />
              {formatTime(plan.starts_at)}
            </span>
            {crew && !hero && (
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
            <span className={cn("text-[13px] font-semibold", mine === "invited" ? "text-amber" : mine === "going" ? "text-lime" : "text-muted")}>{MY_STATUS[mine]}</span>
          )}
        </div>
      </div>
    </>
  );

  const style = cutout ? ({ ["--ticket-cutout" as string]: cutout } as React.CSSProperties) : undefined;
  if (hero) {
    return (
      <div className={cn("ticket", className)} style={style}>
        {body}
      </div>
    );
  }
  return (
    <Link to={`/plans/${plan.id}`} className={cn("ticket transition-[filter] hover:brightness-110 focus-visible:outline-offset-4", className)} style={style}>
      {body}
    </Link>
  );
}

/**
 * Der nächste Plan als großes Ticket – der eine große Moment auf Home (D0).
 * Echte Löcher statt aufgemalter Kerben (CSS-Maske), dadurch passt es auf jeden Hintergrund.
 * Leicht schräg; bei Zeiger oder Fokus richtet es sich auf. Der Strichcode ist reine Dekoration.
 */
export function FeatureTicket({ plan, crew, userId, lookup }: Omit<PlanTicketProps, "hero" | "cutout" | "className">) {
  const date = ticketDate(plan.starts_at);
  const going = plan.participants.filter((p) => p.attendance_status === "going");
  const mine = plan.participants.find((p) => p.user_id === userId)?.attendance_status;
  const meta = [crew ? `${crew.emoji} ${crew.name}`.trim() : null, plan.address ?? plan.meeting_point].filter(Boolean).join(" · ");

  return (
    <div className="ticket-feature-wrap">
      <Link to={`/plans/${plan.id}`} className="ticket ticket-feature">
        <div className={cn("ticket-stub flex flex-col items-center justify-center gap-1 px-2 py-5 text-center", STUB_TONE[plan.status])}>
          <span className="text-[15px] font-bold uppercase tracking-wide">{date.weekday}</span>
          <span className="font-display text-[76px] font-extrabold leading-[0.85] sm:text-[92px]">{date.day}</span>
          <span className="text-[15px] font-bold uppercase tracking-wide">{date.month}</span>
          <span className="ticket-barcode mt-3" aria-hidden />
        </div>
        <div className="flex min-w-0 flex-col justify-between gap-4 p-5 sm:p-6">
          <div className="min-w-0">
            {planStatusBadge(plan.status)}
            <h2 className={cn("display mt-3 break-words text-[32px] text-fg sm:text-[44px]", plan.status === "cancelled" && "line-through decoration-2")}>{plan.title}</h2>
            <p className="mt-2.5 text-[15px] text-muted">
              <span className="font-semibold text-fg">{formatTime(plan.starts_at)}</span>
              {meta && <span className="break-words"> · {meta}</span>}
            </p>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <AvatarStack people={going.map((p) => lookup(p.user_id))} max={5} size="md" />
            <span className="ml-auto flex items-baseline gap-1.5 text-[15px] font-semibold text-muted">
              <span className="font-display text-[34px] font-extrabold leading-none text-fg">{going.length}</span>
              {t.plans.ticket.goingOf(plan.participants.length)}
            </span>
          </div>
          {mine && mine !== "going" && (
            <span className={cn("text-[13px] font-semibold", mine === "invited" ? "text-amber" : "text-muted")}>{MY_STATUS[mine]}</span>
          )}
        </div>
      </Link>
    </div>
  );
}
