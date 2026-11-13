import { ShareButton } from "@/components/ui/ShareButton";
import { planShare, shareOrCopy } from "@/lib/share";
import { planStanding, standingText } from "@/lib/standing";
import { lazy, Suspense, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { IconBack, IconBasket, IconBell, IconCalendar, IconCamera, IconCar, IconCalendarCheck, IconCalendarPlus, IconCrews, IconEdit, IconInfo, IconNavigation, IconPin, IconPlans, IconShare, IconUserPlus, IconVote, IconWallet } from "@/components/icons";
import { Fact, PosterTitle, Section } from "@/components/layout/Page";
import { Avatar } from "@/components/ui/Avatar";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { EmptyState, ErrorState, Notice, PageSpinner, Skeleton } from "@/components/ui/Feedback";
import { useToast } from "@/components/ui/Toast";
import { useUser } from "@/features/auth/AuthProvider";
import { canManageCrew, myRole, useCrews } from "@/features/crews/api";
import { ActivityCard } from "@/features/discover/ActivityCard";
import { useActivity, useActivitySearch } from "@/features/discover/api";
import { SpotMap } from "@/features/discover/SpotMap";
import { usePeople } from "@/features/profile/api";
import { loadTexts, t } from "@/i18n";
import { joinsWaitlist } from "@/lib/capacity";
import { answerByState } from "@/lib/answerby";
import { closePromptDue } from "@/lib/closing";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { formatEuro } from "@/lib/format";
import { arrivalOpen } from "@/lib/arrival";
import { homeCheckOpen } from "@/lib/homecheck";
import { retryDue } from "@/lib/retry";
import { useDocumentTitle, useNow } from "@/lib/hooks";
import { downloadPlanIcs } from "@/lib/ics";
import { liveStage } from "@/lib/live";
import { goingWithGuests } from "@/lib/quorum";
import { formatAgo, formatDateLong, formatDateTime, formatRelative, formatTime } from "@/lib/time";
import type { AttendanceStatus, PlanStatus } from "@/lib/types";
import { estimateCosts, hasStarted, useClosePlan, usePlan, usePlans, usePlanShareToken, useJoinPlanWaitlist, useRemindPlan, useRemindPlanMaybe, useSetAttendance, useSetPlanStatus, useUpdatePlan, type PlanWithParticipants } from "./api";
import { AnswerNote } from "./AnswerNote";
import { BookingPanel } from "./BookingPanel";
import { BringPanel } from "./BringPanel";
import { Directions } from "./Directions";
import { ExpensesPanel } from "./ExpensesPanel";
import { storedPlanGuestSecret } from "./guestsApi";
import { LivePanel } from "./LivePanel";
import { AgainCard, RetryCard } from "./PlanAgain";
import { PlanForm } from "./PlanForm";
import { PlanPanel } from "./PlanPanel";
import { RepeatCard, RepeatLine, SkippedNotice } from "./PlanRepeat";
import { FeatureTicket } from "./PlanTicket";
import { PlanWeather } from "./PlanWeather";
import { RidesPanel } from "./RidesPanel";

/** F10 · Texte der Planseiten-Karten kommen erst mit der Planseite. */
await loadTexts("planCards");

// P10: Fotos erst ab Beginn des Plans – Upload-Code nur laden, wenn der Bereich erscheint.
const PhotosPanel = lazy(() => import("./PhotosPanel").then((m) => ({ default: m.PhotosPanel })));
// W10: Schalter und Gäste nur für Organisator:in, Owner und Admins – eigener Chunk.
const PlanGuestsPanel = lazy(() => import("./PlanGuests").then((m) => ({ default: m.PlanGuestsPanel })));
// W10 Etappe 2: nur geladen, wenn auf diesem Gerät ein Gast-Geheimnis zum Teilen-Link liegt.
// P25: „Findet statt ab 4“ – Texte und Bedienung laden erst, wenn ein Plan eine Mindestzahl hat bzw. jemand sie einstellt.
// P46: Antwortfrist – Anzeige bei „Wer kommt mit?“ und Einstellung unter „Organisieren“.
const AnswerByMeter = lazy(() => import("./PlanAnswerBy").then((m) => ({ default: m.AnswerByMeter })));
const AnswerByCard = lazy(() => import("./PlanAnswerBy").then((m) => ({ default: m.AnswerByCard })));
const QuorumMeter = lazy(() => import("./PlanQuorum").then((m) => ({ default: m.QuorumMeter })));
const QuorumCard = lazy(() => import("./PlanQuorum").then((m) => ({ default: m.QuorumCard })));
// P26: „Nur 6 Plätze“ – Anzeige, Nachrückliste und Einstellung laden erst, wenn ein Plan eine Höchstzahl hat bzw. jemand sie einstellt.
const CapacityMeter = lazy(() => import("./PlanCapacity").then((m) => ({ default: m.CapacityMeter })));
const CapacityCard = lazy(() => import("./PlanCapacity").then((m) => ({ default: m.CapacityCard })));
const WaitlistNote = lazy(() => import("./PlanCapacity").then((m) => ({ default: m.WaitlistNote })));
const PlanGuestClaimCard = lazy(() => import("./PlanGuests").then((m) => ({ default: m.PlanGuestClaimCard })));
// P29: „Wie war’s?“ – Karte und Texte erst auf abgeschlossenen Plänen.
const PlanFeedbackCard = lazy(() => import("./PlanFeedback").then((m) => ({ default: m.PlanFeedbackCard })));
const PlanFeedbackAgainPill = lazy(() => import("./PlanFeedback").then((m) => ({ default: m.PlanFeedbackAgainPill })));
// P30: „Fand der Abend statt?“ – gleicher Chunk und Text-Bereich wie „Wie war’s?“, erst wenn der Abend vorbei ist.
const PlanCloseCard = lazy(() => import("./PlanFeedback").then((m) => ({ default: m.PlanCloseCard })));
// P31: „Gut heimgekommen?“ – Karte und Texte nur rund um den Abend (ab Beginn bis 12 h nach dem Ende).
const PlanArrivalCard = lazy(() => import("./PlanArrival").then((m) => ({ default: m.PlanArrivalCard })));
const PlanHomeCard = lazy(() => import("./PlanHome").then((m) => ({ default: m.PlanHomeCard })));
// P50: „Danach noch wohin?“ – Stationen des Abends; Daten und Formular erst mit der Planseite (eigener Chunk).
const PlanStopsFact = lazy(() => import("./PlanStops").then((m) => ({ default: m.PlanStopsFact })));

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
  const joinWaitlist = useJoinPlanWaitlist(planId ?? "");
  const setStatus = useSetPlanStatus(planId ?? "");
  // P30: Abschließen läuft über `close_plan` – dann fragt „Wie war’s?“ sofort alle mit Zusage.
  const closePlan = useClosePlan(planId ?? "");
  const remind = useRemindPlan(planId ?? "");
  const remindMaybe = useRemindPlanMaybe(planId ?? "");
  const update = useUpdatePlan(planId ?? "");
  // W2: Teilen-Link vorab holen – das Teilen-Menü muss direkt auf den Tipp hin aufgehen.
  const shareToken = usePlanShareToken(plan?.id, Boolean(plan) && plan?.status !== "cancelled");
  const guestSecret = useMemo(() => storedPlanGuestSecret(shareToken.data), [shareToken.data]);
  const [editOpen, setEditOpen] = useState(false);
  const [sharingStanding, setSharingStanding] = useState(false);
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
  const myRow = plan.participants.find((p) => p.user_id === user.id);
  const mine = myRow?.attendance_status ?? "invited";
  // P23: Der Plan wurde verschoben und alle neu gefragt – die alte Antwort steht als Hinweis da.
  const previous = mine === "invited" && !locked ? (myRow?.previous_status ?? null) : null;
  // P26: Runde voll – wer nicht dabei ist, stellt sich statt „Bin dabei“ auf die Nachrückliste.
  const full = joinsWaitlist(plan, mine, goingWithGuests(plan), now);
  const waitlisted = Boolean(myRow?.waitlisted_at) && mine !== "going";
  const othersAnswered = plan.participants.filter((p) => p.user_id !== user.id && p.attendance_status !== "invited").length;
  const costs = estimateCosts(plan);
  const place = activity.data ?? null;
  // P37: Zwischenstand für den Gruppenchat – nur vor Beginn, nicht bei abgesagten oder abgeschlossenen Plänen.
  const standing = planStanding(plan, now);
  const organizer = plan.created_by === user.id ? t.plans.detail.organizerYou : t.plans.detail.organizer(people.lookup(plan.created_by)?.display_name ?? t.states.formerMember);

  const expensesSection = (
    <PlanPanel id="kosten" title={t.planCards.expenses.title} icon={<IconWallet className="size-5" />} tone="lime">
      <ExpensesPanel plan={plan} userId={user.id} memberIds={crew?.members.map((m) => m.user_id) ?? []} canManageCrew={canManageCrew(myRole(crew, user.id))} lookup={people.lookup} />
    </PlanPanel>
  );

  const bringSection = (
    <PlanPanel id="mitbringen" title={t.planCards.items.title} icon={<IconBasket className="size-5" />} tone="amber">
      <BringPanel plan={plan} userId={user.id} canManage={canManage} locked={locked} lookup={people.lookup} />
    </PlanPanel>
  );

  async function shareStanding() {
    if (!plan || !standing) return;
    // Gleicher Link wie „Plan teilen“ (W2: /s/<token>); „Antwort mit einem Tipp“ nur, wenn Gäste dort antworten können (W10).
    const { title, url } = planShare(plan, shareToken.data);
    const when = `${formatDateLong(plan.starts_at)}, ${formatTime(plan.starts_at)}`;
    // P46: Die Antwortfrist steht mit drin, solange sie läuft.
    const deadline = answerByState(plan);
    const text = standingText(t.planCards.standing, standing, plan.title, when, Boolean(plan.guests_allowed && shareToken.data), deadline && !deadline.passed ? formatDateTime(deadline.at) : null);
    setSharingStanding(true);
    const outcome = await shareOrCopy({ title, text, url });
    setSharingStanding(false);
    if (outcome === "copied") toast.success(t.share.copied);
    else if (outcome === "failed") toast.error(t.share.failed);
  }

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
        {plan.status !== "cancelled" && <ShareButton label={t.share.plan} content={() => planShare(plan, shareToken.data)} qr={Boolean(shareToken.data)} className="shrink-0" />}
      </div>
      <div className="max-w-3xl">
        <FeatureTicket plan={plan} crew={crew} userId={user.id} lookup={people.lookup} now={now} hero />
      </div>

      {/* P30: Der Abend ist vorbei – wer organisiert, schließt hier mit einem Tipp ab. */}
      {canManage && closePromptDue(plan, now) && (
        <Suspense fallback={null}>
          <PlanCloseCard planId={plan.id} />
        </Suspense>
      )}

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
                // P26: Voll – „Bin dabei“ wird zu „Nachrücken“ (auf der Liste: gesperrt, die Karte darunter sagt den Platz).
                if (value === "going" && (full || waitlisted) && !locked) {
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={false}
                      aria-label={t.plans.detail.attendance.waitlistLabel}
                      data-response={CARD_ANSWER[value]}
                      data-testid="plan-waitlist-join"
                      disabled={waitlisted || joinWaitlist.isPending}
                      onClick={() => joinWaitlist.mutate(undefined, { onSuccess: (n) => toast.success(t.plans.detail.attendance.waitlistJoined(n)), onError: (error) => toast.error(error) })}
                      className="vote-pill"
                    >
                      {t.plans.detail.attendance.waitlist}
                    </button>
                  );
                }
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
            {/* P26: Wo du auf der Nachrückliste stehst – oder wie du draufkommst. */}
            {!locked && !started && (full || waitlisted) && (
              <Suspense fallback={null}>
                <WaitlistNote plan={plan} userId={user.id} />
              </Suspense>
            )}
            {previous && (
              <p className="mt-2.5 flex items-center gap-2 text-[13px] leading-snug text-muted" data-testid="plan-asked-again">
                <IconInfo className="size-4 shrink-0" aria-hidden />
                {t.plans.detail.attendance.askedAgain(ANSWERS.find((a) => a.value === previous)?.label ?? previous)}
              </p>
            )}
            {/* P24: Zusatz zur eigenen Antwort („komme später“) – die Crew sieht ihn bei „Wer kommt mit?“. */}
            {!locked && mine !== "invited" && <AnswerNote key={mine} planId={plan.id} answer={mine} note={myRow?.note ?? null} />}
            {locked && myRow?.note && mine !== "invited" && <p className="mt-2.5 text-sm font-semibold text-fg">{t.plans.detail.attendance.note.quoted(myRow.note)}</p>}
            {locked && <p className="mt-2.5 text-[13px] text-muted">{t.plans.detail.attendance.locked}</p>}
          </section>

          {/* W10 Etappe 2: Hier schon als Gast über den Link geantwortet? Dann mit einem Tipp übernehmen. */}
          {!locked && shareToken.data && guestSecret && (
            <Suspense fallback={null}>
              <PlanGuestClaimCard planId={plan.id} token={shareToken.data} secret={guestSecret} />
            </Suspense>
          )}

          {/* P43: Seid ihr schon da? – ab 1 h vor bis 3 h nach Beginn, direkt unter der eigenen Antwort. */}
          {arrivalOpen(plan, now) && (
            <Suspense fallback={null}>
              <PlanArrivalCard planId={plan.id} userId={user.id} lookup={people.lookup} now={now} />
            </Suspense>
          )}

          {/* P31: Gut heimgekommen? – ab Beginn bis zum nächsten Vormittag, direkt unter der eigenen Antwort. */}
          {homeCheckOpen(plan, now) && (
            <Suspense fallback={null}>
              <PlanHomeCard planId={plan.id} userId={user.id} lookup={people.lookup} />
            </Suspense>
          )}

          {/* P29: Wie war's? – direkt unter der (gesperrten) Antwort, vor „Nochmal?“. */}
          {plan.status === "completed" && (
            <Suspense fallback={null}>
              <PlanFeedbackCard planId={plan.id} />
            </Suspense>
          )}
          {/* P17: Direkt danach – der beste Moment für die nächste Runde. */}
          {plan.status === "completed" && (
            <AgainCard
              plan={plan}
              placeName={place?.name ?? null}
              verdict={
                <Suspense fallback={null}>
                  <PlanFeedbackAgainPill planId={plan.id} />
                </Suspense>
              }
            />
          )}

          {/* P32: Abgesagt – ein Tipp, und die Crew sucht einen neuen Termin. */}
          {retryDue(plan, now) && <RetryCard plan={plan} placeName={place?.name ?? null} />}

          <dl className="plan-facts mt-4 divide-y divide-line rounded-card border border-white/[0.08] px-4 sm:px-5">
            <Fact icon={<IconPlans aria-hidden />} label={t.plans.detail.what}>
              <span className="font-semibold">{plan.title}</span>
              <span className="mt-0.5 block text-sm text-muted">{organizer}</span>
              <span className="mt-0.5 flex flex-wrap gap-x-4">
                {plan.activity_id && (
                  <Link to={`/activities/${plan.activity_id}`} className="inline-block py-1 text-sm font-semibold text-fg underline decoration-line-strong underline-offset-4 hover:decoration-lime">
                    {t.plans.detail.showPlace}
                  </Link>
                )}
                {plan.poll_id && (
                  <Link to={`/polls/${plan.poll_id}`} className="inline-block py-1 text-sm font-semibold text-fg underline decoration-line-strong underline-offset-4 hover:decoration-lime">
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
                  className="mt-0.5 flex w-fit items-center gap-1.5 py-1 text-sm font-semibold text-fg underline decoration-line-strong underline-offset-4 hover:decoration-lime"
                >
                  <IconCalendarPlus className="size-4" aria-hidden />
                  {t.plans.calendar.add}
                </button>
              )}
              {/* P2 Etappe 2: Wer mehr als einen Plan im Kalender will, abonniert alle. */}
              {!locked && !started && (
                <Link to="/settings#calendar" className="block w-fit py-1 text-[13px] text-muted underline decoration-line underline-offset-4 hover:text-fg hover:decoration-lime">
                  {t.plans.calendar.subscribe}
                </Link>
              )}
            </Fact>
            <Fact icon={<IconPin aria-hidden />} label={t.plans.detail.where}>
              {plan.address ? <span className="font-semibold">{plan.address}</span> : <span className="text-muted">{t.plans.detail.noAddress}</span>}
              {/* P41: Route in der Karten-App – mit Punkt aus Discover, sonst über die Adresse. */}
              {!locked && <Directions target={{ latitude: place?.latitude, longitude: place?.longitude, name: place?.name, address: plan.address }} />}
              {/* P6 Etappe 3: Wo genau – kleiner Stadtplan, erst nach Einwilligung (wie in Discover). */}
              {place?.latitude != null && place.longitude != null && <SpotMap point={{ latitude: place.latitude, longitude: place.longitude }} name={place.name} demo={place.is_demo} />}
            </Fact>
            {/* P50: Danach noch wohin? – weitere Stationen in der Reihenfolge des Abends. */}
            <Suspense fallback={null}>
              <PlanStopsFact planId={plan.id} startsAt={plan.starts_at} canManage={canManage} locked={locked} />
            </Suspense>
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
              {/* P46: Antwortfrist – bis wann, wie viele noch fehlen. */}
              {!locked && plan.answer_by && (
                <Suspense fallback={null}>
                  <div className="mt-2">
                    <AnswerByMeter plan={plan} now={now} />
                  </div>
                </Suspense>
              )}
              {/* P25: Mindestzahl – wie viele noch fehlen, bis der Abend stattfindet. */}
              {!locked && plan.min_going != null && (
                <Suspense fallback={null}>
                  <div className="mt-2">
                    <QuorumMeter plan={plan} />
                  </div>
                </Suspense>
              )}
              {/* P26: Höchstzahl – freie Plätze und Nachrückliste. */}
              {!locked && plan.max_going != null && (
                <Suspense fallback={null}>
                  <div className="mt-2">
                    <CapacityMeter plan={plan} userId={user.id} lookup={people.lookup} now={now} />
                  </div>
                </Suspense>
              )}
              <div className="mt-1 space-y-3">
                {GROUPS.map((status) => {
                  // P26: Wer auf der Nachrückliste steht, erscheint dort (in Reihenfolge), nicht bei „Vielleicht“.
                  const group = plan.participants.filter((p) => p.attendance_status === status && !(status === "maybe" && p.waitlisted_at));
                  // W10: Zusagen ohne Konto stehen in derselben Gruppe, gekennzeichnet als Gast. P26 Etappe 3b: Gäste auf
                  // der Nachrückliste stehen dort (solange Zusagen über den Link an sind), nicht bei „Vielleicht“.
                  const guests = (plan.guests ?? []).filter((g) => g.attendance_status === status && !(status === "maybe" && g.waitlisted_at && plan.guests_allowed));
                  if (group.length + guests.length === 0) return null;
                  // P19: Wer organisiert (oder Owner/Admin ist), fragt alle ohne Antwort mit einem Tipp – nur vor Beginn.
                  // P45: Genauso bei „Vielleicht“ (ohne Nachrückliste, die steht nicht in dieser Gruppe).
                  const askable =
                    (status === "invited" || status === "maybe") && canManage && !locked && !started ? group.filter((p) => p.user_id !== user.id).length : 0;
                  const asking = status === "maybe" ? remindMaybe : remind;
                  return (
                    <div key={status}>
                      <div className="flex min-h-9 items-center justify-between gap-3">
                        <p className="flex items-center gap-2 text-[13px] font-semibold text-muted">
                          <span aria-hidden className={cn("size-2 rounded-full", GROUP_DOT[status])} />
                          {t.plans.detail.attendance.groups[status]} ({group.length + guests.length})
                        </p>
                        {askable > 0 && (
                          <Button
                            variant="secondary"
                            size="sm"
                            data-testid={status === "maybe" ? "plan-remind-maybe" : "plan-remind"}
                            aria-label={status === "maybe" ? t.plans.detail.attendance.remindMaybeLabel(askable) : t.plans.detail.attendance.remindLabel(askable)}
                            loading={asking.isPending}
                            onClick={() =>
                              asking.mutate(undefined, {
                                onSuccess: (n) =>
                                  toast.success(status === "maybe" ? t.plans.detail.attendance.remindedMaybe(n) : t.plans.detail.attendance.reminded(n)),
                                onError: (error) => toast.error(error),
                              })
                            }
                            icon={<IconBell className="size-4" aria-hidden />}
                          >
                            {t.plans.detail.attendance.remind}
                          </Button>
                        )}
                      </div>
                      <ul className="mt-2 flex flex-wrap gap-2">
                        {group.map((p) => {
                          const person = people.lookup(p.user_id);
                          return (
                            <li
                              key={p.user_id}
                              data-status={status}
                              className={cn(
                                "who-chip inline-flex max-w-full items-center gap-2 py-0.5 pl-1 pr-3 text-sm",
                                // P24: Mit Zusatz darf die Pille zweizeilig werden (60 Zeichen passen bei 390 px nicht in eine Zeile).
                                p.note && status !== "invited" ? "min-h-9 rounded-[18px] py-1" : "h-9 rounded-full",
                                status === "going" ? "font-semibold text-fg" : status === "maybe" ? "text-fg" : "text-muted",
                              )}
                            >
                              <Avatar person={person} size="xs" decorative />
                              <span className="min-w-0 break-words">
                                {p.user_id === user.id ? t.states.you : (person?.display_name ?? t.states.formerMember)}
                                {p.note && status !== "invited" && (
                                  <span className="font-normal text-muted" data-testid="who-note">
                                    {" · "}
                                    {t.plans.detail.attendance.note.quoted(p.note)}
                                  </span>
                                )}
                              </span>
                            </li>
                          );
                        })}
                        {guests.map((g) => (
                          <li
                            key={g.id}
                            data-status={status}
                            data-testid="who-guest"
                            className={cn(
                              "who-chip inline-flex max-w-full items-center gap-2 py-0.5 pl-1 pr-3 text-sm",
                              g.note ? "min-h-9 rounded-[18px] py-1" : "h-9 rounded-full",
                              status === "going" ? "font-semibold text-fg" : status === "maybe" ? "text-fg" : "text-muted",
                            )}
                          >
                            <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full border border-dashed border-white/30 text-[10px] font-bold uppercase text-muted">
                              {g.display_name.slice(0, 1)}
                            </span>
                            <span className="min-w-0 break-words">
                              {t.plans.detail.attendance.guest(g.display_name)}
                              {/* P24 Etappe 2: Zusatz des Gasts wie bei Mitgliedern. */}
                              {g.note && (
                                <span className="font-normal text-muted" data-testid="who-note">
                                  {" · "}
                                  {t.plans.detail.attendance.note.quoted(g.note)}
                                </span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
              {/* P37: „Wer kommt jetzt eigentlich?“ – der Stand als Text in den Gruppenchat, nur Zahlen, mit Link zum Antworten. */}
              {standing && (
                <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="plan-standing"
                    loading={sharingStanding}
                    onClick={() => void shareStanding()}
                    icon={<IconShare className="size-4" aria-hidden />}
                  >
                    {t.planCards.standing.button}
                  </Button>
                  <span className="text-[13px] leading-snug text-faint">{t.planCards.standing.hint}</span>
                </div>
              )}
            </Fact>
          </dl>

          {/* W10: Freunde ohne Konto sagen über den Teilen-Link zu – Schalter und Gäste für die, die organisieren. */}
          {canManage && !locked && (
            <PlanPanel id="gaeste" title={t.plans.detail.attendance.guestsTitle} icon={<IconUserPlus className="size-5" />} tone="lime">
              <Suspense fallback={<Skeleton className="h-16" />}>
                <PlanGuestsPanel plan={plan} started={started} crewAdmin={canManageCrew(myRole(crew, user.id))} />
              </Suspense>
            </PlanPanel>
          )}

          {/* P13: „Wo seid ihr?“ – Live-Standort nur rund um den Plan (ab 12 h vorher als Hinweis, ab 2 h vorher zum Teilen). */}
          {liveStage(plan, now) !== "hidden" && (
            <PlanPanel id="live" title={t.planCards.live.title} icon={<IconNavigation className="size-5" />} tone="violet">
              <LivePanel
                plan={plan}
                userId={user.id}
                now={now}
                place={place?.latitude != null && place.longitude != null ? { latitude: place.latitude, longitude: place.longitude } : null}
                placeName={place?.name ?? null}
                lookup={people.lookup}
              />
            </PlanPanel>
          )}

          {plan.notes && (
            <Section title={t.plans.detail.notes}>
              <p className="max-w-prose whitespace-pre-line text-[15px] leading-relaxed text-fg">{plan.notes}</p>
            </Section>
          )}

          {/* P10: Fotos vom Abend – ab Beginn des Plans, nicht bei abgesagten. */}
          {(started || locked) && plan.status !== "cancelled" && (
            <PlanPanel id="fotos" title={t.planCards.photos.title} icon={<IconCamera className="size-5" />} tone="pink">
              <Suspense fallback={<Skeleton className="h-28" />}>
                <PhotosPanel plan={plan} userId={user.id} canManage={canManage} lookup={people.lookup} />
              </Suspense>
            </PlanPanel>
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
            {/* P46: Bis wann sollen alle antworten? Nur vor Beginn. */}
            {!started && (
              <Suspense fallback={null}>
                <AnswerByCard plan={plan} now={now} />
              </Suspense>
            )}
            {/* P25: Ab wie vielen Zusagen findet der Abend statt? Nur vor Beginn. */}
            {!started && (
              <Suspense fallback={null}>
                <QuorumCard plan={plan} />
              </Suspense>
            )}
            {/* P26: Wie viele passen rein? Nur vor Beginn. */}
            {!started && (
              <Suspense fallback={null}>
                <CapacityCard plan={plan} />
              </Suspense>
            )}
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
          answers={started ? undefined : { members: othersAnswered, guests: plan.guests?.length ?? 0 }}
          onSubmit={(values) =>
            update.mutate(values, {
              onSuccess: (asked) => {
                setEditOpen(false);
                toast.success(asked === null ? t.plans.detail.manage.saved : t.plans.detail.manage.askedAgain(asked));
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
        loading={closePlan.isPending}
        error={closePlan.isError ? errorMessage(closePlan.error) : null}
        onConfirm={() =>
          closePlan.mutate(true, {
            onSuccess: () => {
              setConfirming(null);
              toast.success(t.plans.detail.manage.completed);
            },
          })
        }
      />
    </div>
  );
}
