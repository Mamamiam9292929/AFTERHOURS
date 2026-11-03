import { IconCalendar, IconRepeat } from "@/components/icons";
import { ButtonLink } from "@/components/ui/Button";
import { PanelCard } from "@/components/ui/PanelCard";
import { GLASS_PILL } from "@/components/ui/Pill";
import { t } from "@/i18n";
import type { PlanWithParticipants } from "./api";

/**
 * P17 · „Nochmal?“ – auf einem abgeschlossenen Plan führt ein Tipp zur Terminsuche („Wann könnt ihr?“) für dieselbe
 * Crew; mit Ort aus Discover gleich mit diesem Ort (`/polls/new?kind=date&place=…`). Keine neue Datenbankfunktion:
 * Die Abstimmung legt wie gewohnt `create_place_date_poll` bzw. `create_date_poll` an, mit allen Prüfungen dort.
 */
export function againLink(plan: Pick<PlanWithParticipants, "crew_id" | "activity_id">) {
  const params = new URLSearchParams({ crew: plan.crew_id, kind: "date" });
  if (plan.activity_id) params.set("place", plan.activity_id);
  return `/polls/new?${params.toString()}`;
}

export function AgainCard({ plan, placeName }: { plan: PlanWithParticipants; placeName: string | null }) {
  const went = plan.participants.filter((p) => p.attendance_status === "going").length;
  const withPlace = Boolean(plan.activity_id);
  return (
    <PanelCard
      id="nochmal"
      testId="plan-again"
      tone="lime"
      icon={<IconRepeat />}
      title={t.plans.detail.again.title}
      status={
        went > 0 ? (
          <span className={GLASS_PILL} data-testid="plan-again-went">
            {t.plans.detail.again.went(went)}
          </span>
        ) : null
      }
      lead={withPlace && placeName ? t.plans.detail.again.leadPlace(placeName) : t.plans.detail.again.lead}
      className="mt-4"
    >
      <ButtonLink to={againLink(plan)} size="lg" className="w-full sm:w-auto" icon={<IconCalendar className="size-5" aria-hidden />}>
        {withPlace ? t.plans.detail.again.findDatePlace : t.plans.detail.again.findDate}
      </ButtonLink>
    </PanelCard>
  );
}
