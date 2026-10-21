import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/Page";
import { ButtonLink } from "@/components/ui/Button";
import { DemoBadge, EmptyState, ErrorState, ListSkeleton } from "@/components/ui/Feedback";
import { SelectField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { useCrews } from "@/features/crews/api";
import { ActivityCover } from "@/features/discover/ActivityCard";
import { typicalPriceCents, useActivity } from "@/features/discover/api";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
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
                <div className="flex items-center gap-3.5 rounded-card border border-line bg-surface p-3">
                  <ActivityCover activity={place} className="size-16 shrink-0 rounded-control" />
                  <div className="min-w-0">
                    <p className="text-[13px] text-muted">{t.plans.create.place}</p>
                    <p className="flex items-center gap-2 font-bold text-fg">
                      <span className="truncate">{place.name}</span>
                      {place.is_demo && <DemoBadge />}
                    </p>
                    <p className="truncate text-[13px] text-muted">{place.address ?? place.city}</p>
                  </div>
                </div>
              )}
              {crews.data.length > 1 && (
                <SelectField label={t.plans.create.crew} value={crewId} onChange={(e) => setCrewId(e.target.value)}>
                  {crews.data.map((crew) => (
                    <option key={crew.id} value={crew.id}>
                      {crew.emoji} {crew.name}
                    </option>
                  ))}
                </SelectField>
              )}
            </>
          }
          after={
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-fg">{t.plans.create.mode}</legend>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {[
                  { value: false, title: t.plans.create.modeProposed, hint: t.plans.create.modeProposedHint },
                  { value: true, title: t.plans.create.modeConfirmed, hint: t.plans.create.modeConfirmedHint },
                ].map((option) => (
                  <label key={String(option.value)} className={cn("flex cursor-pointer gap-3 rounded-control border p-3.5 transition-colors", confirmed === option.value ? "border-lime bg-lime/5" : "border-line hover:border-line-strong")}>
                    <input type="radio" name="mode" checked={confirmed === option.value} onChange={() => setConfirmed(option.value)} className="mt-0.5 size-5 shrink-0 accent-[var(--color-lime)]" />
                    <span>
                      <span className="block font-semibold text-fg">{option.title}</span>
                      <span className="mt-0.5 block text-[13px] leading-snug text-muted">{option.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
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
