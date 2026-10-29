import { ShareButton } from "@/components/ui/ShareButton";
import { planShare } from "@/lib/share";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { IconBack, IconBasket, IconCalendar, IconCar, IconCalendarCheck, IconCalendarPlus, IconCrews, IconEdit, IconExternal, IconInfo, IconNavigation, IconPin, IconPlans, IconVote, IconWallet } from "@/components/icons";
import { Fact, PosterTitle, Section } from "@/components/layout/Page";
import { Avatar } from "@/components/ui/Avatar";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { EmptyState, ErrorState, Notice, PageSpinner } from "@/components/ui/Feedback";
import { useToast } from "@/components/ui/Toast";
import { useUser } from "@/features/auth/AuthProvider";
import { canManageCrew, myRole, useCrews } from "@/features/crews/api";
import { ActivityCard } from "@/features/discover/ActivityCard";
import { useActivity, useActivitySearch } from "@/features/discover/api";
import { SpotMap } from "@/features/discover/SpotMap";
import { usePeople } from "@/features/profile/api";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { formatEuro } from "@/lib/format";
import { useDocumentTitle, useNow } from "@/lib/hooks";
import { downloadPlanIcs } from "@/lib/ics";
import { mapProvider } from "@/lib/maps";
import { formatAgo, formatDateLong, formatRelative, formatTime } from "@/lib/time";
import type { AttendanceStatus, PlanStatus } from "@/lib/types";
import { estimateCosts, hasStarted, usePlan, usePlans, usePlanShareToken, useSetAttendance, useSetPlanStatus, useUpdatePlan, type PlanWithParticipants } from "./api";
import { BookingPanel } from "./BookingPanel";
import { BringPanel } from "./BringPanel";
import { ExpensesPanel } from "./ExpensesPanel";
import { PlanForm } from "./PlanForm";
import { PlanPanel } from "./PlanPanel";
import { RepeatCard, RepeatLine, SkippedNotice } from "./PlanRepeat";
import { FeatureTicket } from "./PlanTicket";
import { PlanWeather } from "./PlanWeather";
import { RidesPanel } from "./RidesPanel";

const ANSWERS: { value: Exclude<AttendanceStatus, "invited">; label: string }[] = [
  { value: "going", label: t.plans.detail.attendance.going },
  { value: "maybe", label: t.plans.detail.attendance.maybe },
  { value: "declined", label: t.plans.detail.attendance.declined },
];
const GROUPS: AttendanceStatus[] = ["going", "maybe", "invited", "declined"];
const GROUP_DOT: Record<AttendanceStatus, string> = { going: "bg-lime", maybe: "bg-amber", invited: "bg-line-strong", declined: "bg-danger" };
/** V2: Antwort auf der Planseite in den Farbnamen der Abstimm-Karten (`.vote-card[data-answer]`). */
const CARD_ANSWER: Record<Exclude<AttendanceStatus, "invited">, "yes" | "maybe" | "no"> = { going: "yes", maybe: "maybe", declined: "no" };

function FollowUp({ plan, city }: { plan: PlanWithParticipants; city: string | null }) {
  const activities = useActivitySearch(city ? { city, limit: 60 } : null);
  const ideas = useMemo(() => {
    const pool = (activities.data?.items ?? []).filter((a) => a.id !== plan.activity_id);
    const budget = plan.estimated_cost_per_person_cents;
    const affordable = budget != null ? pool.filter((a) => a.price_min_cents == null || a.price_min_cents <= budget * 1.3) : pool;
    const seen = new Set<string>();
    return (affordable.length >= 3 ? affordable : pool).filter((a) => (seen.has(a.category) ? false : (seen.add(a.category), true))).slice(0, 3);
  }, [activities.data, plan.activity_id, plan.estimated_cost_per_person_cents, city]);
  if (ideas.length === 0) return null;
  return (
    <Section
      title={t.plans.detail.followUp.title}
      action={
        <ButtonLink to={`/polls/new?crew=${plan.crew_id}`} size="sm" icon={<IconVote className="size-4" aria-hidden />}>
          {t.plans.detail.followUp.startPoll}
        </ButtonLink>
      }
    >
      <p className="-mt-1 mb-4 text-sm text-muted">{t.plans.detail.followUp.body}</p>
      <div className="grid gap-4 sm:grid-cols-3">
        {ideas.map((activity) => (
          <ActivityCard key={activity.id} activity={activity} compact />
        ))}
      </div>
    </Section>
  );
}

export function PlanDetailPage() {
  const { planId } = useParams();
  const user = useUser();
  const toast = useToast();
  const now = useNow(30_000);
  const planQuery = usePlan(planId);
  // P8: Für wiederkehrende Pläne – welcher Termin der Serie ist der letzte?
  const allPlans = usePlans();
  const crews = useCrews();
  const people = usePeople();
  const plan = planQuery.data;
  const activity = useActivity(plan?.activity_id);
  const setAttendance = useSetAttendance(planId ?? "");
  const setStatus = useSetPlanStatus(planId ?? "");
  const update = useUpdatePlan(planId ?? "");
  // W2: Teilen-Link vorab holen – das Teilen-Menü muss direkt auf den Tipp hin aufgehen.
  const shareToken = usePlanShareToken(plan?.id, Boolean(plan) && plan?.status !== "cancelled");
  const [editOpen, setEditOpen] = useState(false);
  const [confirming, setConfirming] = useState<Extract<PlanStatus, "cancelled" | "completed"> | null>(null);
  useDocumentTitle(plan?.title);

  if (planQuery.isPending || crews.isPending) return <PageSpinner />;
  if (planQuery.isError) return <ErrorState error={planQuery.error} onRetry={() => void planQuery.refetch()} />;
  if (!plan) {
    return (
      <EmptyState
        title={t.plans.detail.notFoundTitle}
        body={t.plans.detail.notFoundBody}
        action={
          <ButtonLink to="/plans" variant="secondary" size="sm">
            {t.plans.detail.back}
          </ButtonLink>
        }
      />
    );
  }

  const crew = crews.data?.find((c) => c.id === plan.crew_id);
  const canManage = plan.created_by === user.id || canManageCrew(myRole(crew, user.id));
  const locked = plan.status === "completed" || plan.status === "cancelled";
  const started = hasStarted(plan, now);
  const mine = plan.participants.find((p) => p.user_id === user.id)?.attendance_status ?? "invited";
  const costs = estimateCosts(plan);
  const place = activity.data ?? null;
  const organizer = plan.created_by === user.id ? t.plans.detail.organizerYou : t.plans.detail.organizer(people.lookup(plan.created_by)?.display_name ?? t.states.formerMember);

  const expensesSection = (
    <PlanPanel id="kosten" title={t.plans.expenses.title} icon={<IconWallet className="size-5" />} tone="lime">
      <ExpensesPanel plan={plan} userId={user.id} memberIds={crew?.members.map((m) => m.user_id) ?? []} canManageCrew={canManageCrew(myRole(crew, user.id))} lookup={people.lookup} />
    </PlanPanel>
  );

  const bringSection = (
    <PlanPanel id="mitbringen" title={t.plans.items.title} icon={<IconBasket className="size-5" />} tone="amber">
      <BringPanel plan={plan} userId={user.id} canManage={canManage} locked={locked} lookup={people.lookup} />
    </PlanPanel>
  );

  function changeStatus(status: PlanStatus, message: string) {
    setStatus.mutate(status, {
      onSuccess: () => {
        setConfirming(null);
        toast.success(message);
      },
      onError: (error) => {
        if (!confirming) toast.error(error);
      },
    });
  }

  return (
    // D0 Etappe 5a: der Plan als großes Ticket auf dem Lichtschein – der eine große Moment der Seite.
    // Der Schein liegt hinter dem gesamten Inhalt (isolate), damit er keine Karte darunter überdeckt.
    <div className="relative isolate">
      {!locked && <div className="home-glow" aria-hidden />}
      <div className="mb-5 flex max-w-3xl items-center justify-between gap-3">
        <Link to={crew ? `/crews/${crew.id}` : "/plans"} className="-ml-1 inline-flex h-9 min-w-0 items-center gap-1.5 rounded-control px-1 text-sm font-semibold text-muted hover:text-fg">
          <IconBack className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{crew ? `${crew.emoji} ${crew.name}` : t.plans.detail.back}</span>
        </Link>
        {/* W8/W2: Plan in den Gruppenchat teilen – mit Vorschau-Link, nicht mehr bei abgesagten Plänen. */}
        {plan.status !== "cancelled" && <ShareButton label={t.share.plan} content={() => planShare(plan, shareToken.data)} className="shrink-0" />}
      </div>
      <div className="max-w-3xl">
        <FeatureTicket plan={plan} crew={crew} userId={user.id} lookup={people.lookup} now={now} hero />
      </div>

      {plan.status === "proposed" && (
        <Notice icon={<IconInfo aria-hidden />} className="mt-5">
          {t.plans.detail.statusNote.proposed}
        </Notice>
      )}
      {plan.status === "cancelled" && plan.skipped_at && <SkippedNotice plan={plan} plans={allPlans.data ?? []} />}

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          {/* Eigene Antwort – V2 Etappe 3c: eine Karte wie die Plan-Karte, ganz in der Farbe deiner Antwort
              (grün dabei, gelb vielleicht, rot abgesagt), ohne Antwort dunkles Glas mit Lime-Rand. */}
          <section
            aria-labelledby="attendance-heading"
            data-answer={mine === "invited" ? undefined : CARD_ANSWER[mine]}
            className={cn("vote-card answer-card p-4 sm:p-5", mine === "invited" && !locked && "answer-open")}
          >
            <h2 id="attendance-heading" className={cn("display text-[22px] uppercase sm:text-[26px]", mine === "invited" ? "chrome" : "text-fg")}>
              <PosterTitle text={t.plans.detail.attendance.question} />
            </h2>
            <div role="radiogroup" aria-labelledby="attendance-heading" className="mt-4 grid grid-cols-3 gap-2">
              {ANSWERS.map(({ value, label }) => {
                const selected = mine === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    data-response={CARD_ANSWER[value]}
                    disabled={locked}
                    onClick={() => !selected && setAttendance.mutate(value, { onSuccess: () => toast.success(t.plans.detail.attendance.saved), onError: (error) => toast.error(error) })}
                    className="vote-pill"
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {locked && <p className="mt-2.5 text-[13px] text-faint">{t.plans.detail.attendance.locked}</p>}
          </section>

          <dl className="plan-facts mt-4 divide-y divide-line rounded-card border border-white/[0.08] px-4 sm:px-5">
            <Fact icon={<IconPlans aria-hidden />} label={t.plans.detail.what}>
              <span className="font-semibold">{plan.title}</span>
              <span className="mt-0.5 block text-sm text-muted">{organizer}</span>
              <span className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                {plan.activity_id && (
                  <Link to={`/activities/${plan.activity_id}`} className="text-sm font-semibold text-fg underline decoration-line-strong underline-offset-4 hover:decoration-lime">
                    {t.plans.detail.showPlace}
                  </Link>
                )}
                {plan.poll_id && (
                  <Link to={`/polls/${plan.poll_id}`} className="text-sm font-semibold text-fg underline decoration-line-strong underline-offset-4 hover:decoration-lime">
                    {t.plans.detail.fromPoll}
                  </Link>
                )}
              </span>
            </Fact>
            <Fact icon={<IconCalendar aria-hidden />} label={t.plans.detail.when}>
              <span className="font-semibold">
                {formatDateLong(plan.starts_at)}, {formatTime(plan.starts_at)}
              </span>
              <RepeatLine series={plan.series} />
              {!locked && <span className="mt-0.5 block text-sm text-muted">{started ? t.plans.detail.started(formatAgo(plan.starts_at, now)) : t.plans.detail.startsIn(formatRelative(plan.starts_at, now))}</span>}
              {/* P2 Etappe 1: Termin als .ics – entsteht im Browser, nur Titel, Zeit, Ort, Treffpunkt und Link. */}
              {!locked && !started && (
                <button
                  type="button"
                  onClick={() => {
                    downloadPlanIcs(plan);
                    toast.success(t.plans.calendar.done);
                  }}
                  className="mt-1.5 flex w-fit items-center gap-1.5 text-sm font-semibold text-fg underline decoration-line-strong underline-offset-4 hover:decoration-lime"
                >
                  <IconCalendarPlus className="size-4" aria-hidden />
                  {t.plans.calendar.add}
                </button>
              )}
              {/* P2 Etappe 2: Wer mehr als einen Plan im Kalender will, abonniert alle. */}
              {!locked && !started && (
                <Link to="/settings#calendar" className="mt-1 block w-fit text-[13px] text-muted underline decoration-line underline-offset-4 hover:text-fg hover:decoration-lime">
                  {t.plans.calendar.subscribe}
                </Link>
              )}
            </Fact>
            <Fact icon={<IconPin aria-hidden />} label={t.plans.detail.where}>
              {plan.address ? <span className="font-semibold">{plan.address}</span> : <span className="text-muted">{t.plans.detail.noAddress}</span>}
              {place?.latitude != null && place.longitude != null && (
                <a href={mapProvider.directionsUrl(place.latitude, place.longitude)} target="_blank" rel="noopener noreferrer" className="mt-1.5 flex w-fit items-center gap-1.5 text-sm font-semibold text-fg underline decoration-line-strong underline-offset-4 hover:decoration-lime">
                  {t.plans.detail.openInMaps}
                  <IconExternal className="size-3.5" aria-hidden />
                </a>
              )}
              {/* P6 Etappe 3: Wo genau – kleiner Stadtplan, erst nach Einwilligung (wie in Discover). */}
              {place?.latitude != null && place.longitude != null && <SpotMap point={{ latitude: place.latitude, longitude: place.longitude }} name={place.name} demo={place.is_demo} />}
            </Fact>
            {/* P5: Vorhersage für Beginn und Ort (Open-Meteo) – nur bei anstehenden Plänen mit Ort. */}
            {!locked && <PlanWeather plan={plan} />}
            <Fact icon={<IconNavigation aria-hidden />} label={t.plans.detail.meetingPoint}>
              {plan.meeting_point ? <span className="font-semibold">{plan.meeting_point}</span> : <span className="text-muted">{t.plans.detail.noMeetingPoint}</span>}
            </Fact>
            <Fact icon={<IconWallet aria-hidden />} label={t.plans.detail.cost}>
              {costs.perPersonCents == null && costs.totalCents == null ? (
                <span className="text-muted">{t.plans.detail.costUnknown}</span>
              ) : (
                <>
                  {costs.perPersonCents != null && <span className="font-semibold">{t.plans.detail.costPerPerson(formatEuro(costs.perPersonCents))}</span>}
                  {costs.totalCents != null && (
                    <span className="block text-sm text-muted">
                      {plan.estimated_total_cost_cents != null ? t.plans.detail.costTotalFixed(formatEuro(costs.totalCents)) : t.plans.detail.costTotal(formatEuro(costs.totalCents), costs.goingCount)}
                    </span>
                  )}
                  <span className="block text-[13px] text-faint">{t.plans.detail.costEstimate}</span>
                </>
              )}
            </Fact>
            <Fact icon={<IconCrews aria-hidden />} label={t.plans.detail.who}>
              <div className="mt-1 space-y-3">
                {GROUPS.map((status) => {
                  const group = plan.participants.filter((p) => p.attendance_status === status);
                  if (group.length === 0) return null;
                  return (
                    <div key={status}>
                      <p className="flex items-center gap-2 text-[13px] font-semibold text-muted">
                        <span aria-hidden className={cn("size-2 rounded-full", GROUP_DOT[status])} />
                        {t.plans.detail.attendance.groups[status]} ({group.length})
                      </p>
                      <ul className="mt-2 flex flex-wrap gap-2">
                        {group.map((p) => {
                          const person = people.lookup(p.user_id);
                          return (
                            <li key={p.user_id} data-status={status} className={cn("who-chip inline-flex h-9 items-center gap-2 rounded-full py-0.5 pl-1 pr-3 text-sm", status === "going" ? "font-semibold text-fg" : status === "maybe" ? "text-fg" : "text-muted")}>
                              <Avatar person={person} size="xs" decorative />
                              {p.user_id === user.id ? t.states.you : (person?.display_name ?? t.states.formerMember)}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </Fact>
          </dl>

          {plan.notes && (
            <Section title={t.plans.detail.notes}>
              <p className="max-w-prose whitespace-pre-line text-[15px] leading-relaxed text-fg">{plan.notes}</p>
            </Section>
          )}

          {/* P3: Nach dem Start steht das Abrechnen oben – davor ist es eher die Ausnahme (z. B. Tickets vorab). */}
          {(started || locked) && expensesSection}

          {/* P14: Wer bringt was? – vor dem Abend als erster Bereich, danach weiter unten zum Nachschauen. */}
          {!(started || locked) && bringSection}

          {/* V2 Etappe 3g: Kosten, Reservierung und Fahrten als Glas-Karten im Deck, je mit eigenem Schein. */}
          <PlanPanel id="reservierung" title={t.plans.detail.booking} icon={<IconCalendarCheck className="size-5" />} tone="violet">
            <BookingPanel plan={plan} activity={place} canManage={canManage && !locked} />
          </PlanPanel>

          <PlanPanel id="fahrten" title={t.plans.detail.rides} icon={<IconCar className="size-5" />} tone="pink">
            <RidesPanel plan={plan} userId={user.id} locked={locked} lookup={people.lookup} />
          </PlanPanel>

          {(started || locked) && bringSection}

          {!(started || locked) && expensesSection}

          {plan.status === "completed" && <FollowUp plan={plan} city={place?.city ?? null} />}
        </div>

        {canManage && !locked && (
          <aside className="lg:sticky lg:top-10 lg:self-start">
            <div className="plan-manage rounded-card border border-white/[0.08] p-4">
              <h2 className="mb-3 text-[17px] font-bold text-fg">{t.plans.detail.manage.title}</h2>
              <div className="flex flex-col gap-2.5">
                {plan.status === "proposed" && (
                  <Button block loading={setStatus.isPending && !confirming} onClick={() => changeStatus("confirmed", t.plans.detail.manage.confirmed)} icon={<IconCalendarCheck className="size-4" aria-hidden />}>
                    {t.plans.detail.manage.confirm}
                  </Button>
                )}
                {plan.status !== "proposed" && started && (
                  <Button block onClick={() => setConfirming("completed")} icon={<IconCalendarCheck className="size-4" aria-hidden />}>
                    {t.plans.detail.manage.complete}
                  </Button>
                )}
                <Button variant="secondary" block onClick={() => setEditOpen(true)} icon={<IconEdit className="size-4" aria-hidden />}>
                  {t.plans.detail.manage.edit}
                </Button>
                <Button variant="danger" block onClick={() => setConfirming("cancelled")}>
                  {t.plans.detail.manage.cancel}
                </Button>
              </div>
              {plan.status !== "proposed" && !started && <p className="mt-3 text-[13px] leading-snug text-faint">{t.plans.detail.manage.completeTooEarly}</p>}
            </div>
            <p className="mt-3 flex items-center gap-2 px-1 text-[13px] text-faint">
              <IconInfo className="size-4 shrink-0" aria-hidden />
              {t.plans.detail.manage.editBody}
            </p>
            {/* P8: Stammtisch – der Plan wiederholt sich von selbst. */}
            <RepeatCard key={plan.id} plan={plan} plans={allPlans.data ?? [plan]} />
          </aside>
        )}
      </div>

      <Dialog open={editOpen} onClose={() => setEditOpen(false)} title={t.plans.detail.manage.editTitle} description={t.plans.detail.manage.editBody}>
        <PlanForm
          key={plan.updated_at}
          initial={{ title: plan.title, startsAt: plan.starts_at, address: plan.address, meetingPoint: plan.meeting_point, notes: plan.notes, costPerPersonCents: plan.estimated_cost_per_person_cents, totalCostCents: plan.estimated_total_cost_cents }}
          submitLabel={t.actions.saveChanges}
          pending={update.isPending}
          error={update.isError ? errorMessage(update.error) : null}
          allowUnchangedPast
          flat
          onSubmit={(values) =>
            update.mutate(values, {
              onSuccess: () => {
                setEditOpen(false);
                toast.success(t.plans.detail.manage.saved);
              },
            })
          }
        />
      </Dialog>

      <ConfirmDialog
        open={confirming === "cancelled"}
        onClose={() => setConfirming(null)}
        title={t.plans.detail.manage.cancelTitle}
        description={t.plans.detail.manage.cancelBody}
        confirmLabel={t.plans.detail.manage.cancel}
        destructive
        loading={setStatus.isPending}
        error={setStatus.isError ? errorMessage(setStatus.error) : null}
        onConfirm={() => changeStatus("cancelled", t.plans.detail.manage.cancelled)}
      />
      <ConfirmDialog
        open={confirming === "completed"}
        onClose={() => setConfirming(null)}
        title={t.plans.detail.manage.completeTitle}
        description={t.plans.detail.manage.completeBody}
        confirmLabel={t.plans.detail.manage.complete}
        loading={setStatus.isPending}
        error={setStatus.isError ? errorMessage(setStatus.error) : null}
        onConfirm={() => changeStatus("completed", t.plans.detail.manage.completed)}
      />
    </div>
  );
}
