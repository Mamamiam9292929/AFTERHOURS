import { t } from "@/i18n";
import { siteUrl } from "@/lib/supabase";
import { sortStops } from "@/lib/stops";
import { formatTime } from "@/lib/time";
import type { Plan, PlanStop } from "@/lib/types";
import { buildIcs, icsFileName, icsStopLines } from "./icsformat";

export { foldLine, icsDate, icsFileName, icsText } from "./icsformat";

/*
 * P2 Etappe 1 · Plan in den eigenen Kalender. Erzeugt eine iCalendar-Datei (RFC 5545) im Browser –
 * nichts geht an einen Server oder an Dritte. Enthalten sind nur Titel, Beginn, (bekanntes) Ende,
 * Adresse, Treffpunkt, weitere Stationen des Abends (P50 Etappe 2b) und der Link zum Plan; keine Namen, keine
 * Teilnehmerliste, keine E-Mail-Adressen.
 * Gleiche UID für denselben Plan: Ein erneuter Import ersetzt den Termin, SEQUENCE steigt mit jeder Änderung.
 */

type IcsPlan = Pick<Plan, "id" | "title" | "starts_at" | "ends_at" | "address" | "meeting_point" | "status" | "created_at" | "updated_at">;

type IcsPlanStop = Pick<PlanStop, "id" | "title" | "at" | "address" | "created_at">;

export function planToIcs(plan: IcsPlan, stops: readonly IcsPlanStop[] = [], now: Date = new Date()): string {
  const url = `${siteUrl()}/plans/${plan.id}`;
  const description = [
    plan.meeting_point ? t.plans.calendar.meetingPoint(plan.meeting_point) : null,
    ...icsStopLines(sortStops(stops), (stop) => t.plans.calendar.stop(stop.at ? formatTime(stop.at) : null, stop.title, stop.address)),
    t.plans.calendar.link(url),
  ]
    .filter(Boolean)
    .join("\n");
  return buildIcs(
    {
      uid: `plan-${plan.id}@afterhours`,
      title: plan.title,
      startsAt: plan.starts_at,
      endsAt: plan.ends_at,
      location: plan.address,
      description,
      url,
      status: plan.status === "proposed" ? "TENTATIVE" : plan.status === "cancelled" ? "CANCELLED" : "CONFIRMED",
      sequence: (new Date(plan.updated_at).getTime() - new Date(plan.created_at).getTime()) / 1000,
      lastModified: plan.updated_at,
    },
    now,
  );
}

/** Lädt eine Kalenderdatei herunter; Handys bieten danach „Zum Kalender hinzufügen“ an. */
export function downloadIcs(content: string, fileName: string): void {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

export function downloadPlanIcs(plan: IcsPlan, stops: readonly IcsPlanStop[] = []): void {
  downloadIcs(planToIcs(plan, stops), icsFileName(plan.title));
}
