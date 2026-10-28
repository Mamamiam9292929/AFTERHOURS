import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { isQuickPollHandoff } from "@/app/ShareTarget";
import { IconCalendarPlus, IconPinOff, IconPlans, IconSpinner, IconVote } from "@/components/icons";
import { Section, SectionLink } from "@/components/layout/Page";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState, ErrorState, ListSkeleton, Notice, Skeleton } from "@/components/ui/Feedback";
import { useUser } from "@/features/auth/AuthProvider";
import { useCrews } from "@/features/crews/api";
import { CrewRow } from "@/features/crews/CrewsPage";
import { ActivityCard } from "@/features/discover/ActivityCard";
import { isUpcoming, usePlans } from "@/features/plans/api";
import { FeatureTicket, PlanTicket } from "@/features/plans/PlanTicket";
import { PlanQuickAnswer } from "@/features/plans/QuickAnswer";
import { useIdeas } from "./ideas";
import { InstallCard } from "./InstallCard";
import { SpontaneousCard, SpontaneousLauncher, useSpontaneousAsks } from "./Spontaneous";
import { usePolls } from "@/features/polls/api";
import { isPollOver } from "@/features/polls/logic";
import { QuickPollLauncher } from "@/features/polls/QuickPoll";
import { PollCard } from "@/features/polls/PollCard";
import { PollQuickVote } from "@/features/polls/QuickVote";
import { usePeople, useProfile, useSettings } from "@/features/profile/api";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { needsQuickVote } from "@/lib/quickvote";
import { openAsks } from "@/lib/spontaneous";
import { useDocumentTitle, useNow } from "@/lib/hooks";
import { calendarDaysBetween, dayPhase, zonedParts } from "@/lib/time";

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

export function HomePage() {
  useDocumentTitle(null);
  const user = useUser();
  // D3: Das große Ticket zählt in den letzten Stunden minutengenau herunter.
  const now = useNow(30_000);
  const profile = useProfile();
  const settings = useSettings();
  const crews = useCrews();
  const polls = usePolls();
  const plans = usePlans();
  const people = usePeople();
  const { ideas, isPending: ideasPending, city: ideasCity, importing: ideasImporting } = useIdeas();
  const location = useLocation();
  const navigate = useNavigate();
  // S3: Satz aus dem Teilen-Menü (`/share-target`). Einmal übernehmen und aus dem Verlauf löschen –
  // sonst ginge das Sheet beim Neuladen oder Zurück wieder auf.
  const [shared] = useState<string | null>(() => (isQuickPollHandoff(location.state) ? location.state.quickPollText : null));
  useEffect(() => {
    if (shared !== null) navigate(location.pathname, { replace: true, state: null });
    // nur beim ersten Rendern
  }, []);
  const spontaneous = useSpontaneousAsks(Boolean(crews.data && crews.data.length > 0));
  // S4 Etappe 2: App-Kurzbefehl „Heute noch wer?“ (Manifest) öffnet das Sheet direkt.
  const [params, setParams] = useSearchParams();
  const askFromShortcut = params.get("frage") === "heute";
  const clearShortcut = useCallback(
    () =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete("frage");
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  const crewById = useMemo(() => new Map((crews.data ?? []).map((c) => [c.id, c])), [crews.data]);
  const membersOf = (crewId: string) => crewById.get(crewId)?.members.map((m) => m.user_id) ?? [];

  const openPolls = (polls.data ?? []).filter((p) => !isPollOver(p, now));
  // D3 Etappe 1: Wer auf Home angefangen hat abzustimmen, behält die Abstimmung hier, bis er durch ist.
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const touch = useCallback((pollId: string) => setTouched((set) => (set.has(pollId) ? set : new Set(set).add(pollId))), []);
  const pollsNeedingMe = openPolls.filter((p) =>
    needsQuickVote(
      p.options.map((o) => ({ id: o.id, mine: p.votes.find((v) => v.poll_option_id === o.id && v.user_id === user.id)?.response ?? null })),
      touched.has(p.id),
    ),
  );
  const otherPolls = openPolls.filter((p) => !pollsNeedingMe.includes(p));
  const upcoming = (plans.data ?? []).filter((p) => isUpcoming(p, now));
  const plansNeedingMe = upcoming.filter((p) => p.participants.some((pp) => pp.user_id === user.id && pp.attendance_status === "invited"));
  // Das große Ticket: der nächste Plan, bei dem die eigene Antwort nicht fehlt und der nicht abgesagt wurde.
  const featured = upcoming.find(
    (p) => !plansNeedingMe.includes(p) && p.status !== "cancelled" && p.participants.find((pp) => pp.user_id === user.id)?.attendance_status !== "declined",
  );
  const asks = openAsks(spontaneous.data ?? [], now);
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
        <h1 className={cn("display chrome mt-2 break-words uppercase", long ? "text-[32px] sm:text-[48px]" : "text-[42px] sm:text-[60px]")}>
          {title.lead}
          <span className="text-lime">{title.key}</span>
          {title.tail}
        </h1>
        {/* S4: Eine laufende „Heute noch wer?“-Frage ist das Dringendste – sie verfällt nach 2 Stunden. */}
        {asks.length > 0 && (
          <div className="mt-7 max-w-2xl space-y-4">
            {asks.map((ask) => (
              <SpontaneousCard key={ask.id} ask={ask} crew={crewById.get(ask.crew_id)} userId={user.id} lookup={people.lookup} now={now} />
            ))}
          </div>
        )}
        {spontaneous.isError && (
          <div className="mt-7 max-w-2xl">
            <ErrorState error={spontaneous.error} onRetry={() => void spontaneous.refetch()} />
          </div>
        )}
        {featured && !loading && !failed && (
          <div className="mt-7 max-w-2xl lg:mt-9">
            <FeatureTicket plan={featured} crew={crewById.get(featured.crew_id)} userId={user.id} lookup={people.lookup} now={now} live />
          </div>
        )}
        {crews.data && crews.data.length > 0 ? (
          // V2 + S1: ein Lime-Knopf, der zur Ein-Satz-Abstimmung aufgeht; die ausführlichen Wege bleiben daneben.
          <div className="mt-7 flex max-w-2xl flex-col gap-3">
            <QuickPollLauncher crews={crews.data} shared={shared} />
            <div className="flex flex-wrap gap-2">
              {spontaneous.data && <SpontaneousLauncher crews={crews.data} asks={spontaneous.data} now={now} autoOpen={askFromShortcut} onAutoOpened={clearShortcut} />}
              <ButtonLink to="/polls/new" size="sm" variant="secondary" icon={<IconVote className="size-4" aria-hidden />}>
                {t.home.startPoll}
              </ButtonLink>
              <ButtonLink to="/plans/new" size="sm" variant="secondary" icon={<IconCalendarPlus className="size-4" aria-hidden />}>
                {t.home.createPlan}
              </ButtonLink>
            </div>
          </div>
        ) : (
          <>
          {shared !== null && crews.data && (
            <Notice tone="amber" className="mt-7 max-w-2xl" title={t.polls.quick.launcher}>
              <span data-testid="quickpoll-shared-no-crew">{t.polls.quick.sharedNoCrew}</span>
            </Notice>
          )}
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <ButtonLink to="/polls/new" size="lg" icon={<IconVote className="size-5" aria-hidden />}>
              {t.home.startPoll}
            </ButtonLink>
            <ButtonLink to="/plans/new" size="lg" variant="secondary" icon={<IconCalendarPlus className="size-5" aria-hidden />}>
              {t.home.createPlan}
            </ButtonLink>
          </div>
          </>
        )}
      </header>

      <div className="grid gap-x-10 gap-y-9 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          {loading ? (
            <ListSkeleton rows={2} height="h-36" />
          ) : failed ? (
            <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />
          ) : noCrews ? (
            <section className="rounded-card border border-line bg-surface p-5 sm:p-6">
              <h2 className="display text-[22px] text-fg">{t.home.start.title}</h2>
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
              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
                <ButtonLink to="/start" size="lg" icon={<IconPlans className="size-5" aria-hidden />}>
                  {t.home.start.action}
                </ButtonLink>
                <ButtonLink to="/crews?new=1" size="lg" variant="ghost">
                  {t.home.start.crewOnly}
                </ButtonLink>
              </div>
              <p className="mt-4 text-[13px] text-faint">{t.home.start.haveInvite}</p>
            </section>
          ) : (
            <>
              {needsAnswer > 0 && (
                <Section title={t.home.needsAnswer}>
                  <div className="space-y-4">
                    {pollsNeedingMe.map((poll) => (
                      // D3 Etappe 1: direkt unter der Abstimmung antworten – Vorschlag für Vorschlag, ein Tipp je Vorschlag.
                      <div key={poll.id}>
                        <PollCard poll={poll} crew={crewById.get(poll.crew_id)} memberIds={membersOf(poll.crew_id)} userId={user.id} now={now} />
                        <div className="mt-2.5">
                          <PollQuickVote poll={poll} memberIds={membersOf(poll.crew_id)} userId={user.id} now={now} onTouched={touch} />
                        </div>
                      </div>
                    ))}
                    {plansNeedingMe.map((plan) => (
                      // D6: direkt unter dem Ticket antworten – ohne erst die Planseite zu öffnen.
                      <div key={plan.id}>
                        <PlanTicket plan={plan} crew={crewById.get(plan.crew_id)} userId={user.id} lookup={people.lookup} />
                        <PlanQuickAnswer plan={plan} className="mt-2.5" />
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              <InstallCard className="mt-9 first:mt-0" />

              {(nextPlans.length > 0 || (plansNeedingMe.length === 0 && !featured)) && (
                <Section title={t.home.nextUp} action={upcoming.length > 0 ? <SectionLink to="/plans">{t.home.allPlans}</SectionLink> : undefined}>
                  {nextPlans.length > 0 ? (
                    <div className="space-y-5">
                      {nextPlans.map((plan) => (
                        <PlanTicket key={plan.id} plan={plan} crew={crewById.get(plan.crew_id)} userId={user.id} lookup={people.lookup} />
                      ))}
                    </div>
                  ) : (
                    <EmptyState art={<IconPlans aria-hidden />} title={t.home.nothingPlanned.title} body={t.home.nothingPlanned.body} />
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
