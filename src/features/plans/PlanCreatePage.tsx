import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { IconCheck, IconCrews, IconSparkles } from "@/components/icons";
import { PageHeader } from "@/components/layout/Page";
import { ButtonLink } from "@/components/ui/Button";
import { DemoBadge, EmptyState, ErrorState, ListSkeleton } from "@/components/ui/Feedback";
import { CHOICE_CARD, CHOICE_CARD_ON, FormCard } from "@/components/ui/FormCard";
import { useToast } from "@/components/ui/Toast";
import { useCrews } from "@/features/crews/api";
import { CrewPicker } from "@/features/crews/CrewPicker";
import { ActivityCover } from "@/features/discover/ActivityCard";
import { typicalPriceCents, useActivity } from "@/features/discover/api";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { categoryWorld } from "@/lib/stage";
import { errorMessage } from "@/lib/errors";
import { useDocumentTitle } from "@/lib/hooks";
import { useCreatePlan } from "./api";
import { PlanForm } from "./PlanForm";

export function PlanCreatePage() {
  useDocumentTitle(t.plans.create.title);
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const activityId = params.get("activity");
  const crews = useCrews();
  const activity = useActivity(activityId);
  const create = useCreatePlan();
  const [crewId, setCrewId] = useState(params.get("crew") ?? "");
  const [confirmed, setConfirmed] = useState(false);
  // S4 Etappe 2: „Plan hier“ aus „Heute noch wer?“ – heute, in einer halben Stunde (auf die Viertelstunde).
  const [soonStart] = useState(() => (params.get("soon") === "1" ? soonStartsAt(new Date()) : null));

  useEffect(() => {
    if (!crews.data || crews.data.length === 0) return;
    if (!crews.data.some((c) => c.id === crewId)) setCrewId(crews.data[0]?.id ?? "");
  }, [crews.data, crewId]);

  if (crews.isPending || (activityId && activity.isPending)) return <ListSkeleton rows={3} />;
  if (crews.isError) return <ErrorState error={crews.error} onRetry={() => void crews.refetch()} />;
  if (crews.data.length === 0) {
    return (
      <>
        <PageHeader title={t.plans.create.title} back={{ to: "/plans", label: t.plans.detail.back }} />
        <EmptyState title={t.polls.create.needCrewTitle} body={t.polls.create.needCrewBody} action={<ButtonLink to="/crews?new=1">{t.polls.create.needCrewAction}</ButtonLink>} />
      </>
    );
  }
  const place = activity.data ?? null;

  return (
    <>
      <PageHeader title={t.plans.create.title} lead={t.plans.create.lead} back={{ to: "/plans", label: t.plans.detail.back }} />
      <div className="max-w-2xl">
        <PlanForm
          // Sobald der Ort geladen ist, das Formular mit dessen Werten neu aufbauen.
          key={place?.id ?? "blank"}
          initial={{ title: place?.name ?? "", address: place?.address ?? "", costPerPersonCents: place ? typicalPriceCents(place) : null, startsAt: soonStart }}
          submitLabel={t.plans.create.submit}
          pending={create.isPending}
          error={create.isError ? errorMessage(create.error) : null}
          onSubmit={(values) =>
            create.mutate(
              { ...values, crewId, activityId: place?.id ?? null, confirmed },
              {
                onSuccess: (planId) => {
                  toast.success(t.plans.create.created);
                  navigate(`/plans/${planId}`, { replace: true });
                },
              },
            )
          }
          before={
            <>
              {place && (
                // V2 Etappe 3m: der Ort als Karte in der Farbwelt seiner Kategorie – wie in Discover.
                <div className="cat-world flex items-center gap-3.5 rounded-[28px] border border-white/[0.08] p-3" data-world={categoryWorld(place.category)} data-testid="plan-form-place">
                  <ActivityCover activity={place} className="size-16 shrink-0 rounded-[18px]" />
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-muted">{t.plans.create.place}</p>
                    <p className="flex items-center gap-2">
                      <span className="display truncate text-[17px] text-fg">{place.name}</span>
                      {place.is_demo && <DemoBadge />}
                    </p>
                    <p className="truncate text-[13px] text-muted">{place.address ?? place.city}</p>
                  </div>
                </div>
              )}
              {crews.data.length > 1 && (
                <FormCard title={t.plans.create.crew} icon={<IconCrews className="size-[18px]" />} tone="pink" testId="plan-form-crew">
                  <CrewPicker crews={crews.data} value={crewId} onChange={setCrewId} label={t.plans.create.crew} />
                </FormCard>
              )}
            </>
          }
          after={
            <FormCard title={t.plans.create.mode} icon={<IconSparkles className="size-[18px]" />} tone="lime" testId="plan-form-mode">
              <div role="radiogroup" aria-label={t.plans.create.mode} className="grid gap-2.5 sm:grid-cols-2">
                {[
                  { value: false, title: t.plans.create.modeProposed, hint: t.plans.create.modeProposedHint },
                  { value: true, title: t.plans.create.modeConfirmed, hint: t.plans.create.modeConfirmedHint },
                ].map((option) => {
                  const on = confirmed === option.value;
                  return (
                    <label key={String(option.value)} className={cn(CHOICE_CARD, "flex cursor-pointer gap-3 p-3.5", on && CHOICE_CARD_ON)}>
                      <input type="radio" name="mode" checked={on} onChange={() => setConfirmed(option.value)} className="peer sr-only" />
                      <span aria-hidden className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-lime", on ? "border-lime bg-lime text-lime-ink" : "border-white/25")}>
                        {on && <IconCheck className="size-3.5" />}
                      </span>
                      <span>
                        <span className="block font-semibold text-fg">{option.title}</span>
                        <span className="mt-0.5 block text-[13px] leading-snug text-muted">{option.hint}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </FormCard>
          }
        />
      </div>
    </>
  );
}

/** In 30 Minuten, aufgerundet auf die nächste Viertelstunde – für einen Plan, der heute noch losgeht. */
function soonStartsAt(now: Date): string {
  const quarter = 15 * 60_000;
  return new Date(Math.ceil((now.getTime() + 30 * 60_000) / quarter) * quarter).toISOString();
}
