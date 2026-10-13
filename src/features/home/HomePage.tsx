import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { IconCalendarPlus, IconPinOff, IconSpinner, IconVote } from "@/components/icons";
import { Section, SectionLink } from "@/components/layout/Page";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState, ErrorState, ListSkeleton, Notice, Skeleton } from "@/components/ui/Feedback";
import { cityCenter } from "@/data/cities";
import { CATEGORIES, INTEREST_CATEGORIES } from "@/data/options";
import { useUser } from "@/features/auth/AuthProvider";
import { useCrews } from "@/features/crews/api";
import { CrewRow } from "@/features/crews/CrewsPage";
import { ActivityCard } from "@/features/discover/ActivityCard";
import { useActivitySearch, usePlaceRegion } from "@/features/discover/api";
import { placesProvider } from "@/features/discover/provider";
import { isUpcoming, usePlans } from "@/features/plans/api";
import { FeatureTicket, PlanTicket } from "@/features/plans/PlanTicket";
import { usePolls } from "@/features/polls/api";
import { isPollOver } from "@/features/polls/logic";
import { PollCard } from "@/features/polls/PollCard";
import { usePeople, useProfile, useSettings } from "@/features/profile/api";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { formatEuro } from "@/lib/format";
import { distanceKm } from "@/lib/geo";
import { useDocumentTitle, useNow } from "@/lib/hooks";
import { qk } from "@/lib/query";
import { dayPhase, zonedParts } from "@/lib/time";
import type { Activity, ActivityCategory } from "@/lib/types";

interface Headline {
  lead: string;
  key: string;
  tail: string;
}

/** Die Leitfrage der App – je nach Wochentag und Tageszeit in Berlin. */
function leadQuestion(now: Date): Headline {
  const phase = dayPhase(now);
  const { weekday } = zonedParts(now);
  if ((weekday === "thu" || weekday === "fri") && (phase === "morning" || phase === "day")) return t.home.question.weekend;
  if (phase === "morning") return t.home.question.today;
  if (phase === "day") return t.home.question.tonight;
  if (phase === "evening") return t.home.question.later;
  return t.home.question.tomorrow;
}

/** Kalendertage zwischen zwei Zeitpunkten in Berliner Zeit (heute = 0, morgen = 1). */
function calendarDaysBetween(from: Date, to: Date | string): number {
  const day = (v: Date | string) => {
    const p = zonedParts(v);
    return Date.UTC(p.year, p.month - 1, p.day) / 86_400_000;
  };
  return Math.round(day(to) - day(from));
}

/**
 * Plakat-Überschrift aus echten Daten: Steht der nächste Plan in den kommenden 13 Tagen fest,
 * zählt sie herunter („Noch 3 Tage bis Bowling“), sonst stellt sie die Leitfrage.
 */
function headline(now: Date, plan: { title: string; starts_at: string } | undefined): Headline {
  if (plan) {
    const days = calendarDaysBetween(now, plan.starts_at);
    const evening = zonedParts(plan.starts_at).hour >= 17;
    const lead = days <= 0 ? (evening ? t.home.countdown.tonight : t.home.countdown.today) : days === 1 ? t.home.countdown.tomorrow : days <= 13 ? t.home.countdown.days(days) : null;
    if (lead) return { lead: `${lead} `, key: plan.title, tail: "" };
  }
  return leadQuestion(now);
}

interface Ideas {
  activities: { activity: Activity; distanceKm: number | null }[];
  reasons: string[];
}

/**
 * Vorschläge: je ein Ort aus bis zu drei Kategorien in der eigenen Stadt – bevorzugt passend zu
 * Interessen und Budget. Fehlen Angaben, wird der jeweilige Filter weggelassen, und die Begründung
 * nennt nur, was wirklich berücksichtigt wurde. Innerhalb einer Kategorie wechselt der Vorschlag täglich.
 */
function useIdeas(): { ideas: Ideas | null; isPending: boolean; city: string | null; importing: boolean } {
  const profile = useProfile();
  const settings = useSettings();
  const city = profile.data?.city?.trim() || null;
  const places = usePlaceRegion(city);
  const overview = useActivitySearch(city ? { city, limit: 1 } : null);

  const wanted = useMemo(
    () => new Set<ActivityCategory>([...(profile.data?.favorite_categories ?? []), ...(profile.data?.interests ?? []).flatMap((i) => INTEREST_CATEGORIES[i])]),
    [profile.data],
  );
  const counts = overview.data?.categories;
  const { chosen, usedInterests } = useMemo(() => {
    const available = CATEGORIES.filter((c) => (counts?.[c] ?? 0) > 0);
    const preferred = available.filter((c) => wanted.has(c));
    const usedInterests = preferred.length > 0;
    const rest = available.filter((c) => !wanted.has(c)).sort((a, b) => (counts?.[b] ?? 0) - (counts?.[a] ?? 0));
    return { chosen: [...preferred, ...rest].slice(0, 3), usedInterests };
  }, [counts, wanted]);

  const perCategory = useQueries({
    queries: chosen.map((category) => ({
      queryKey: qk.activitySearch(city ?? "", category, "", 30),
      enabled: Boolean(city),
      staleTime: 5 * 60_000,
      queryFn: () => placesProvider.search({ city: city ?? "", category, limit: 30 }),
    })),
  });

  const loaded = perCategory.every((q) => q.data);
  const ideas = useMemo<Ideas | null>(() => {
    if (!city || !overview.data || !loaded) return null;
    const reasons = [t.home.ideasReason.city(city)];
    if (usedInterests) reasons.push(t.home.ideasReason.interests);
    const budget = settings.data?.typical_budget_cents;
    let budgetUsed = false;
    const day = Math.floor(Date.now() / 86_400_000);
    const origin = cityCenter(city);
    const picked = perCategory.flatMap((q) => {
      let pool: Activity[] = q.data?.items ?? [];
      if (budget != null) {
        const affordable = pool.filter((a) => a.price_min_cents != null && a.price_min_cents <= budget);
        if (affordable.length > 0) {
          pool = affordable;
          budgetUsed = true;
        }
      }
      // Die vollständigsten Einträge stehen vorn; daraus täglich ein anderer.
      const top = pool.slice(0, 10);
      const activity = top[day % Math.max(top.length, 1)];
      if (!activity) return [];
      const distance = origin && activity.latitude != null && activity.longitude != null ? distanceKm(origin, { latitude: activity.latitude, longitude: activity.longitude }) : null;
      return [{ activity, distanceKm: distance }];
    });
    if (budgetUsed && budget != null) reasons.push(t.home.ideasReason.budget(formatEuro(budget)));
    return { activities: picked, reasons };
    // perCategory ändert bei jedem Render die Identität; loaded + Daten genügen als Auslöser.
  }, [city, overview.data, loaded, usedInterests, settings.data, perCategory.map((q) => q.dataUpdatedAt).join()]);

  const isPending = profile.isPending || (Boolean(city) && (overview.isPending || !loaded) && !(overview.data && chosen.length === 0));
  return { ideas, isPending: isPending && !places.importing, city, importing: places.importing };
}

export function HomePage() {
  useDocumentTitle(null);
  const user = useUser();
  const now = useNow(60_000);
  const profile = useProfile();
  const settings = useSettings();
  const crews = useCrews();
  const polls = usePolls();
  const plans = usePlans();
  const people = usePeople();
  const { ideas, isPending: ideasPending, city: ideasCity, importing: ideasImporting } = useIdeas();

  const crewById = useMemo(() => new Map((crews.data ?? []).map((c) => [c.id, c])), [crews.data]);
  const membersOf = (crewId: string) => crewById.get(crewId)?.members.map((m) => m.user_id) ?? [];

  const openPolls = (polls.data ?? []).filter((p) => !isPollOver(p, now));
  const pollsNeedingMe = openPolls.filter((p) => !p.votes.some((v) => v.user_id === user.id));
  const otherPolls = openPolls.filter((p) => !pollsNeedingMe.includes(p));
  const upcoming = (plans.data ?? []).filter((p) => isUpcoming(p, now));
  const plansNeedingMe = upcoming.filter((p) => p.participants.some((pp) => pp.user_id === user.id && pp.attendance_status === "invited"));
  // Das große Ticket: der nächste Plan, bei dem die eigene Antwort nicht fehlt und der nicht abgesagt wurde.
  const featured = upcoming.find(
    (p) => !plansNeedingMe.includes(p) && p.status !== "cancelled" && p.participants.find((pp) => pp.user_id === user.id)?.attendance_status !== "declined",
  );
  const nextPlans = upcoming.filter((p) => !plansNeedingMe.includes(p) && p !== featured).slice(0, 2);
  const needsAnswer = pollsNeedingMe.length + plansNeedingMe.length;

  const loading = crews.isPending || polls.isPending || plans.isPending;
  const failed = crews.isError ? crews : polls.isError ? polls : plans.isError ? plans : null;
  const noCrews = crews.data?.length === 0;
  const phase = dayPhase(now);
  const title = headline(now, loading || failed ? undefined : featured);
  const long = title.lead.length + title.key.length > 30;

  return (
    <div className="relative isolate">
      <div className="home-glow" aria-hidden />
      <header className="mb-8 lg:mb-10">
        <p className="text-[15px] font-medium text-muted">
          {t.home.greeting[phase]}, {profile.data?.display_name ?? ""}
        </p>
        <h1 className={cn("display mt-2 break-words uppercase text-fg", long ? "text-[40px] sm:text-[60px]" : "text-[52px] sm:text-[76px]")}>
          {title.lead}
          <span className="text-lime">{title.key}</span>
          {title.tail}
        </h1>
        {featured && !loading && !failed && (
          <div className="mt-7 max-w-2xl lg:mt-9">
            <FeatureTicket plan={featured} crew={crewById.get(featured.crew_id)} userId={user.id} lookup={people.lookup} />
          </div>
        )}
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <ButtonLink to="/polls/new" size="lg" icon={<IconVote className="size-5" aria-hidden />}>
            {t.home.startPoll}
          </ButtonLink>
          <ButtonLink to="/plans/new" size="lg" variant="secondary" icon={<IconCalendarPlus className="size-5" aria-hidden />}>
            {t.home.createPlan}
          </ButtonLink>
        </div>
      </header>

      <div className="grid gap-x-10 gap-y-9 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          {loading ? (
            <ListSkeleton rows={2} height="h-36" />
          ) : failed ? (
            <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />
          ) : noCrews ? (
            <section className="rounded-card border border-line bg-surface p-5 sm:p-6">
              <h2 className="display text-[30px] text-fg">{t.home.start.title}</h2>
              <ol className="mt-5 space-y-4">
                {t.home.start.steps.map((step, index) => (
                  <li key={step.title} className="flex gap-4">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-raised font-display text-xl font-extrabold text-lime" aria-hidden>
                      {index + 1}
                    </span>
                    <span>
                      <span className="block font-semibold text-fg">{step.title}</span>
                      <span className="block text-sm text-muted">{step.body}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <ButtonLink to="/crews?new=1" size="lg" className="mt-6">
                {t.home.start.action}
              </ButtonLink>
              <p className="mt-4 text-[13px] text-faint">{t.home.start.haveInvite}</p>
            </section>
          ) : (
            <>
              {needsAnswer > 0 && (
                <Section title={t.home.needsAnswer}>
                  <div className="space-y-4">
                    {pollsNeedingMe.map((poll) => (
                      <PollCard key={poll.id} poll={poll} crew={crewById.get(poll.crew_id)} memberIds={membersOf(poll.crew_id)} userId={user.id} now={now} />
                    ))}
                    {plansNeedingMe.map((plan) => (
                      <PlanTicket key={plan.id} plan={plan} crew={crewById.get(plan.crew_id)} userId={user.id} lookup={people.lookup} />
                    ))}
                  </div>
                </Section>
              )}

              {(nextPlans.length > 0 || (plansNeedingMe.length === 0 && !featured)) && (
                <Section title={t.home.nextUp} action={upcoming.length > 0 ? <SectionLink to="/plans">{t.home.allPlans}</SectionLink> : undefined}>
                  {nextPlans.length > 0 ? (
                    <div className="space-y-5">
                      {nextPlans.map((plan) => (
                        <PlanTicket key={plan.id} plan={plan} crew={crewById.get(plan.crew_id)} userId={user.id} lookup={people.lookup} />
                      ))}
                    </div>
                  ) : (
                    <EmptyState title={t.home.nothingPlanned.title} body={t.home.nothingPlanned.body} />
                  )}
                </Section>
              )}

              {otherPolls.length > 0 && (
                <Section title={t.home.runningPolls}>
                  <div className="space-y-4">
                    {otherPolls.map((poll) => (
                      <PollCard key={poll.id} poll={poll} crew={crewById.get(poll.crew_id)} memberIds={membersOf(poll.crew_id)} userId={user.id} now={now} />
                    ))}
                  </div>
                </Section>
              )}
            </>
          )}

          <Section title={t.home.ideas} action={<SectionLink to="/discover">{t.home.ideasMore}</SectionLink>}>
            {ideasPending ? (
              <div className="grid gap-4 sm:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-64 rounded-card" />
                ))}
              </div>
            ) : ideas && ideas.activities.length > 0 ? (
              <>
                <p className="-mt-1 mb-4 text-sm text-muted first-letter:uppercase">{ideas.reasons.join(", ")}</p>
                <div className="grid gap-4 sm:grid-cols-3">
                  {ideas.activities.map(({ activity, distanceKm: distance }) => (
                    <ActivityCard key={activity.id} activity={activity} distanceKm={distance} compact />
                  ))}
                </div>
              </>
            ) : ideasImporting && ideasCity ? (
              <Notice tone="lime" icon={<IconSpinner className="animate-spin" aria-hidden />} title={t.discover.sync.loading(ideasCity)}>
                {t.discover.sync.loadingBody}
              </Notice>
            ) : !ideasCity ? (
              <EmptyState
                title={t.home.ideasNoCity.title}
                body={t.home.ideasNoCity.body}
                action={
                  <ButtonLink to="/discover" variant="secondary" size="sm">
                    {t.home.ideasNoCity.action}
                  </ButtonLink>
                }
              />
            ) : (
              <EmptyState title={t.discover.empty.noData} body={t.discover.empty.noDataBody} />
            )}
          </Section>
        </div>

        <aside className="min-w-0 space-y-9">
          {!loading && !failed && !noCrews && (
            <Section title={t.home.yourCrews} action={<SectionLink to="/crews">{t.home.allCrews}</SectionLink>}>
              <div className="space-y-3">
                {(crews.data ?? []).slice(0, 4).map((crew) => (
                  <CrewRow key={crew.id} crew={crew} />
                ))}
              </div>
            </Section>
          )}
          <Section title={t.home.location.title}>
            <div className="rounded-card border border-line bg-surface p-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-raised text-muted">
                  <IconPinOff className="size-[18px]" aria-hidden />
                </span>
                <div className="min-w-0 text-sm leading-snug">
                  <p className="font-semibold text-fg">{settings.data && settings.data.location_sharing_mode !== "off" ? t.home.location.on : t.home.location.off}</p>
                  <p className="mt-1 text-muted">{t.home.location.unavailable}</p>
                  <Link to="/settings#location" className="mt-2 inline-flex h-9 items-center font-semibold text-fg underline decoration-line-strong underline-offset-4 hover:decoration-lime">
                    {t.home.location.settings}
                  </Link>
                </div>
              </div>
            </div>
          </Section>
        </aside>
      </div>
    </div>
  );
}
