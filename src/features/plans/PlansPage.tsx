import { useMemo, useState } from "react";
import { IconCalendar, IconCalendarPlus, IconPlans, IconVote } from "@/components/icons";
import { PageHeader, PosterLine } from "@/components/layout/Page";
import { ButtonLink } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Controls";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/ui/Feedback";
import { useUser } from "@/features/auth/AuthProvider";
import { useCrews } from "@/features/crews/api";
import { usePolls } from "@/features/polls/api";
import { isPollOver } from "@/features/polls/logic";
import { PollCard } from "@/features/polls/PollCard";
import { usePeople } from "@/features/profile/api";
import { t } from "@/i18n";
import { useDocumentTitle, useNow } from "@/lib/hooks";
import { isUpcoming, usePlans } from "./api";
import { PlanTicket } from "./PlanTicket";

type Tab = "upcoming" | "voting" | "past";

export function PlansPage() {
  useDocumentTitle(t.plans.title);
  const user = useUser();
  const now = useNow(60_000);
  const plans = usePlans();
  const polls = usePolls();
  const crews = useCrews();
  const people = usePeople();
  const [tab, setTab] = useState<Tab>("upcoming");

  const crewById = useMemo(() => new Map((crews.data ?? []).map((c) => [c.id, c])), [crews.data]);
  const upcoming = useMemo(() => (plans.data ?? []).filter((p) => isUpcoming(p, now)), [plans.data, now]);
  const past = useMemo(() => (plans.data ?? []).filter((p) => !isUpcoming(p, now)).reverse(), [plans.data, now]);
  const openPolls = useMemo(() => (polls.data ?? []).filter((p) => !isPollOver(p, now)), [polls.data, now]);
  // Beendete Abstimmungen ohne Plan bleiben sichtbar, bis jemand entscheidet.
  const undecided = useMemo(
    () => (polls.data ?? []).filter((p) => isPollOver(p, now) && !(plans.data ?? []).some((plan) => plan.poll_id === p.id) && !(polls.data ?? []).some((c) => c.parent_poll_id === p.id) && now.getTime() - new Date(p.closed_at ?? p.ends_at).getTime() < 14 * 86400_000),
    [polls.data, plans.data, now],
  );

  const poster = upcoming.length > 0 ? t.plans.poster.upcoming(upcoming.length) : openPolls.length > 0 ? t.plans.poster.voting(openPolls.length) : t.plans.poster.none;

  const loading = plans.isPending || polls.isPending || crews.isPending;
  const failed = plans.isError ? plans : polls.isError ? polls : null;

  return (
    <>
      <PageHeader
        poster
        title={<PosterLine lead={poster.lead} keyword={poster.key} tail={poster.tail} />}
        lead={t.plans.lead}
        actions={
          <>
            <ButtonLink to="/polls/new" icon={<IconVote className="size-4" aria-hidden />}>
              {t.plans.newPoll}
            </ButtonLink>
            <ButtonLink to="/plans/new" variant="secondary" icon={<IconCalendarPlus className="size-4" aria-hidden />}>
              {t.plans.newPlan}
            </ButtonLink>
          </>
        }
      />
      <Segmented<Tab>
        label={t.plans.tabs.label}
        value={tab}
        onChange={setTab}
        options={[
          { value: "upcoming", label: t.plans.tabs.upcoming, count: upcoming.length },
          { value: "voting", label: t.plans.tabs.voting, count: openPolls.length + undecided.length },
          { value: "past", label: t.plans.tabs.past },
        ]}
      />

      <div className="mt-6" role="tabpanel">
        {loading ? (
          <ListSkeleton rows={3} height="h-32" />
        ) : failed ? (
          <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />
        ) : tab === "upcoming" ? (
          upcoming.length === 0 ? (
            <EmptyState art={<IconPlans aria-hidden />} title={t.plans.empty.upcomingTitle} body={t.plans.empty.upcomingBody} action={<ButtonLink to="/polls/new" size="sm">{t.plans.newPoll}</ButtonLink>} />
          ) : (
            <div className="grid gap-5 lg:grid-cols-2">
              {upcoming.map((plan) => (
                <PlanTicket key={plan.id} plan={plan} crew={crewById.get(plan.crew_id)} userId={user.id} lookup={people.lookup} />
              ))}
            </div>
          )
        ) : tab === "voting" ? (
          openPolls.length + undecided.length === 0 ? (
            <EmptyState art={<IconVote aria-hidden />} title={t.plans.empty.votingTitle} body={t.plans.empty.votingBody} action={<ButtonLink to="/polls/new" size="sm">{t.plans.newPoll}</ButtonLink>} />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {[...openPolls, ...undecided].map((poll) => (
                <PollCard key={poll.id} poll={poll} crew={crewById.get(poll.crew_id)} memberIds={crewById.get(poll.crew_id)?.members.map((m) => m.user_id) ?? []} userId={user.id} now={now} />
              ))}
            </div>
          )
        ) : past.length === 0 ? (
          <EmptyState art={<IconCalendar aria-hidden />} title={t.plans.empty.pastTitle} body={t.plans.empty.pastBody} />
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            {past.map((plan) => (
              <PlanTicket key={plan.id} plan={plan} crew={crewById.get(plan.crew_id)} userId={user.id} lookup={people.lookup} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
