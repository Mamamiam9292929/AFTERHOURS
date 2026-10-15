import { ShareButton } from "@/components/ui/ShareButton";
import { pollShare } from "@/lib/share";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { IconBell, IconCalendarPlus, IconCrown, IconHourglass, IconPin, IconVote } from "@/components/icons";
import { PageHeader, PosterTitle, Section } from "@/components/layout/Page";
import { AvatarStack } from "@/components/ui/Avatar";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Chip, SwitchRow } from "@/components/ui/Controls";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { Badge, EmptyState, ErrorState, PageSpinner } from "@/components/ui/Feedback";
import { FormMessage, TextAreaField, TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { useUser } from "@/features/auth/AuthProvider";
import { canManageCrew, myRole, useCrews } from "@/features/crews/api";
import { useActivity } from "@/features/discover/api";
import { useCreatePlanFromPoll, usePlans } from "@/features/plans/api";
import { usePeople } from "@/features/profile/api";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { centsToInput, formatEuro, parseEuroInput } from "@/lib/format";
import { useDocumentTitle, useNow } from "@/lib/hooks";
import { addDays, formatAgo, formatDateTime, formatPlainDate, formatPlainTime, formatRelative, today, zonedToUtc } from "@/lib/time";
import type { PollGuest, PollOption, VoteResponse } from "@/lib/types";
import {
  storedGuestSecret,
  useClaimGuest,
  useClosePoll,
  useGuestClaimPreview,
  usePoll,
  usePollShareToken,
  usePolls,
  useRemindPoll,
  useRemovePollGuest,
  useSetPollGuestJoin,
  useSetPollGuests,
  useStartRunoff,
  useVote,
} from "./api";
import { ParticipationBar } from "./PollCard";
import { GUEST_PREFIX, isGuestId, summarizePoll, type OptionTally, type PollWithDetails } from "./logic";

const RESPONSES: VoteResponse[] = ["yes", "maybe", "no"];

function optionWhen(option: PollOption): string {
  if (!option.proposed_date) return t.polls.detail.dateOpen;
  const date = formatPlainDate(option.proposed_date);
  return option.proposed_time ? `${date}, ${formatPlainTime(option.proposed_time)}` : date;
}

interface OptionCardProps {
  tally: OptionTally;
  poll: PollWithDetails;
  disabled: boolean;
  isWinner: boolean;
  onVote: (response: VoteResponse | null) => void;
  lookup: ReturnType<typeof usePeople>["lookup"];
  action?: React.ReactNode;
}

function OptionCard({ tally, poll, disabled, isWinner, onVote, lookup, action }: OptionCardProps) {
  const { option } = tally;
  const overBudget = poll.budget_cents != null && option.estimated_price_cents != null && option.estimated_price_cents > poll.budget_cents;
  const names = (ids: string[]) =>
    ids.map((id) => (isGuestId(id) ? t.polls.detail.guestLabel(lookup(id)?.display_name ?? "?") : (lookup(id)?.display_name ?? t.states.formerMember))).join(", ");

  // P1: Bei Termin-Abstimmungen ist der Titel schon das Datum – darunter nur die Uhrzeit, kein Preis.
  const isDate = poll.kind === "date";
  const meta = isDate
    ? [option.proposed_time ? formatPlainTime(option.proposed_time) : t.polls.detail.timeOpen]
    : [optionWhen(option), option.estimated_price_cents != null ? t.polls.detail.priceEstimate(formatEuro(option.estimated_price_cents)) : t.polls.detail.priceOpen];
  const leadingOpen = tally.leading && poll.status === "open";

  return (
    <li
      className={cn(
        "poll-option relative overflow-hidden rounded-card border",
        isWinner ? "border-lime bg-lime/10" : leadingOpen ? "poll-option-leading border-lime/45" : "border-line bg-surface",
      )}
    >
      <div className="relative p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="display min-w-0 break-words text-[26px] uppercase text-fg sm:text-[28px]">{option.title}</h3>
          {isWinner ? (
            <Badge tone="lime" icon={<IconCrown className="size-3.5" aria-hidden />}>
              {t.polls.detail.result.title}
            </Badge>
          ) : (
            leadingOpen && (
              <Badge tone="lime" className="mt-0.5 text-[13px]">
                {t.polls.leadingBadge}
              </Badge>
            )
          )}
        </div>
        <p className="mt-1.5 text-sm text-muted">
          {meta.join(" · ")}
          {overBudget && !isDate && <span className="ml-2 font-semibold text-amber">{t.polls.detail.overBudget}</span>}
        </p>

        {/* Stand als Balken: Anteil der Zusagen an der Crew, eigene Zusage mit Lime-Rahmen. */}
        <div className={cn("relative mt-3.5 flex min-h-14 items-center gap-3 overflow-hidden rounded-control border bg-raised/70 py-2 pl-3 pr-4", tally.mine === "yes" ? "border-lime" : "border-transparent")}>
          <div aria-hidden className="poll-bar-fill absolute inset-y-0 left-0" style={{ width: `${tally.yesShare * 100}%` }} />
          <div className="relative flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
            <AvatarStack people={tally.yes.map((id) => lookup(id))} max={5} ringColor="var(--color-raised)" />
            <span className="text-sm font-semibold text-fg">{t.polls.yesCount(tally.yes.length)}</span>
            {/* Auf dem Lime-Verlauf reicht Grau nicht für AA – deshalb Vordergrundfarbe, nur dünner. */}
            {tally.maybe.length > 0 && <span className="text-sm text-fg/90">{t.polls.maybeCount(tally.maybe.length)}</span>}
            {tally.no.length > 0 && <span className="text-sm text-fg/90">{t.polls.noCount(tally.no.length)}</span>}
          </div>
          <span aria-hidden className="display relative text-[30px] leading-none text-fg tabular-nums">
            {tally.yes.length}
          </span>
        </div>
        {tally.yes.length + tally.maybe.length + tally.no.length > 0 && (
          <details className="mt-1.5 text-[13px] text-muted">
            <summary className="inline-flex h-8 cursor-pointer items-center font-semibold underline-offset-4 hover:text-fg hover:underline">{t.polls.detail.whoAnswered}</summary>
            <dl className="space-y-1 pb-1 pt-1">
              {tally.yes.length > 0 && (
                <div>
                  <dt className="inline font-semibold text-fg">{t.polls.detail.whoIsIn}: </dt>
                  <dd className="inline">{names(tally.yes)}</dd>
                </div>
              )}
              {tally.maybe.length > 0 && (
                <div>
                  <dt className="inline font-semibold text-fg">{t.polls.detail.whoMaybe}: </dt>
                  <dd className="inline">{names(tally.maybe)}</dd>
                </div>
              )}
              {tally.no.length > 0 && (
                <div>
                  <dt className="inline font-semibold text-fg">{t.polls.detail.whoIsOut}: </dt>
                  <dd className="inline">{names(tally.no)}</dd>
                </div>
              )}
            </dl>
          </details>
        )}

        {!disabled && (
          <div role="radiogroup" aria-label={t.polls.detail.answerFor(option.title)} className="mt-3 grid grid-cols-3 gap-2">
            {RESPONSES.map((response) => {
              const selected = tally.mine === response;
              return (
                <button
                  key={response}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onVote(selected ? null : response)}
                  className={cn(
                    "inline-flex h-12 items-center justify-center rounded-control border px-1 text-center text-[13px] font-semibold leading-tight transition-colors sm:text-[15px]",
                    !selected && "border-transparent bg-raised text-fg/85 hover:border-line-strong hover:text-fg",
                    selected && response === "yes" && "border-lime bg-lime text-lime-ink",
                    selected && response === "maybe" && "border-lime bg-transparent text-lime",
                    selected && response === "no" && "border-fg/40 bg-raised text-fg",
                  )}
                >
                  {t.enums.vote[response]}
                </button>
              );
            })}
          </div>
        )}
        {disabled && tally.mine && (
          <p className="mt-3 text-sm text-muted">
            {t.polls.detail.yourAnswer}: <span className="font-semibold text-fg">{t.enums.vote[tally.mine]}</span>
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 empty:hidden">
          {option.activity_id && (
            <Link to={`/activities/${option.activity_id}`} className="inline-flex h-9 items-center gap-1.5 text-sm font-semibold text-muted underline-offset-4 hover:text-fg hover:underline">
              <IconPin className="size-4" aria-hidden />
              {t.polls.detail.showPlace}
            </Link>
          )}
          {action}
        </div>
      </div>
    </li>
  );
}

function PlanFromPollDialog({ poll, option, onClose }: { poll: PollWithDetails; option: PollOption | null; onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const create = useCreatePlanFromPoll();
  const activity = useActivity(option?.activity_id);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("19:00");
  const [address, setAddress] = useState("");
  const [meetingPoint, setMeetingPoint] = useState("");
  const [cost, setCost] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const addressTouched = useRef(false);

  useEffect(() => {
    if (!option) return;
    // P1: Ein Plan heißt nicht „Samstag, 17. Oktober“ – bei Termin-Abstimmungen tippt man ein, was ansteht.
    setTitle(poll.kind === "date" ? "" : option.title);
    setDate(option.proposed_date && option.proposed_date >= today() ? option.proposed_date : "");
    setTime(option.proposed_time?.slice(0, 5) ?? "19:00");
    setMeetingPoint(poll.meeting_point ?? "");
    setCost(centsToInput(option.estimated_price_cents));
    setNotes("");
    setAddress("");
    setErrors({});
    addressTouched.current = false;
    create.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [option?.id]);

  useEffect(() => {
    if (!addressTouched.current && activity.data?.address) setAddress(activity.data.address);
  }, [activity.data?.address]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!option) return;
    const startsAt = date && time ? zonedToUtc(date, time) : null;
    const costCents = parseEuroInput(cost);
    const next: Record<string, string | null> = {
      title: title.trim().length < 2 ? t.validation.minLength(2) : null,
      when: !startsAt ? t.validation.dateRequired : startsAt.getTime() <= Date.now() ? t.validation.dateInPast : null,
      cost: costCents === undefined ? t.validation.amount : null,
    };
    setErrors(next);
    if (Object.values(next).some(Boolean) || !startsAt) return;
    create.mutate(
      { pollId: poll.id, optionId: option.id, startsAt, title: title.trim(), address: address.trim() || null, meetingPoint: meetingPoint.trim() || null, notes: notes.trim() || null, costPerPersonCents: costCents ?? null },
      {
        onSuccess: (planId) => {
          toast.success(t.polls.detail.planDialog.created);
          navigate(`/plans/${planId}`);
        },
      },
    );
  }

  return (
    <Dialog open={Boolean(option)} onClose={onClose} title={t.polls.detail.planDialog.title} description={t.polls.detail.planDialog.body}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <TextField
          label={t.polls.detail.planDialog.planTitle}
          name="plan_title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          error={errors.title}
          hint={poll.kind === "date" ? t.polls.detail.planDialog.planTitleDateHint : undefined}
          placeholder={poll.kind === "date" ? t.polls.detail.planDialog.planTitleDatePlaceholder : undefined}
          required
        />
        <div className="grid grid-cols-2 gap-3">
          <TextField label={t.polls.detail.planDialog.date} name="plan_date" type="date" min={today()} max={addDays(today(), 730)} value={date} onChange={(e) => setDate(e.target.value)} error={errors.when} required />
          <TextField label={t.polls.detail.planDialog.time} name="plan_time" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
        </div>
        <TextField
          label={t.polls.detail.planDialog.address}
          name="plan_address"
          value={address}
          onChange={(e) => {
            addressTouched.current = true;
            setAddress(e.target.value);
          }}
          maxLength={200}
          optional
        />
        <TextField label={t.polls.detail.planDialog.meetingPoint} name="plan_meeting_point" value={meetingPoint} onChange={(e) => setMeetingPoint(e.target.value)} maxLength={160} optional />
        <TextField label={t.polls.detail.planDialog.cost} name="plan_cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} error={errors.cost} hint={t.polls.detail.planDialog.costHint} trailing={<span className="pr-3 text-muted">€</span>} optional />
        <TextAreaField label={t.polls.detail.planDialog.notes} name="plan_notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={2} optional />
        {create.isError && <FormMessage>{errorMessage(create.error)}</FormMessage>}
        <Button type="submit" size="lg" block loading={create.isPending}>
          {t.polls.detail.planDialog.submit}
        </Button>
      </form>
    </Dialog>
  );
}

function RunoffDialog({ poll, open, onClose }: { poll: PollWithDetails; open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const runoff = useStartRunoff();
  const [preset, setPreset] = useState<"twoHours" | "tomorrow">("tomorrow");

  function start() {
    const endsAt = preset === "twoHours" ? new Date(Date.now() + 2 * 3600_000) : zonedToUtc(addDays(today(), 1), "12:00");
    if (!endsAt) return;
    runoff.mutate(
      { pollId: poll.id, title: t.polls.detail.manage.runoffDefaultTitle(poll.title).slice(0, 80), endsAt },
      {
        onSuccess: (newId) => {
          toast.success(t.polls.detail.manage.runoffStarted);
          onClose();
          navigate(`/polls/${newId}`);
        },
      },
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t.polls.detail.manage.runoffTitle}
      description={t.polls.detail.manage.runoffBody}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t.actions.cancel}
          </Button>
          <Button onClick={start} loading={runoff.isPending}>
            {t.polls.detail.manage.startRunoff}
          </Button>
        </>
      }
    >
      <p className="mb-2.5 text-sm font-medium text-fg">{t.polls.create.endsTitle}</p>
      <div className="flex flex-wrap gap-2">
        <Chip selected={preset === "twoHours"} onToggle={() => setPreset("twoHours")}>
          {t.polls.create.endsPresets.twoHours}
        </Chip>
        <Chip selected={preset === "tomorrow"} onToggle={() => setPreset("tomorrow")}>
          {t.polls.create.endsPresets.tomorrow}
        </Chip>
      </div>
      {runoff.isError && <p role="alert" className="mt-3 text-sm text-danger">{errorMessage(runoff.error)}</p>}
    </Dialog>
  );
}

/** W3: Schalter „Gäste dürfen mitstimmen“ und die Liste der Gäste – für Ersteller:in und Owner/Admin. */
function GuestSettings({ poll, guests, crewAdmin }: { poll: PollWithDetails; guests: PollGuest[]; crewAdmin: boolean }) {
  const toast = useToast();
  const setGuests = useSetPollGuests(poll.id);
  const setJoin = useSetPollGuestJoin(poll.id);
  const removeGuest = useRemovePollGuest(poll.id);
  const [removing, setRemoving] = useState<PollGuest | null>(null);

  return (
    <Section title={t.polls.detail.guests.title} className="mt-0">
      <div className="rounded-card border border-line bg-surface px-4 py-1.5">
        <SwitchRow
          label={t.polls.detail.guests.toggle}
          description={t.polls.detail.guests.toggleBody}
          checked={poll.guests_allowed}
          disabled={setGuests.isPending}
          onChange={(allowed) =>
            setGuests.mutate(allowed, {
              onSuccess: () => toast.success(allowed ? t.polls.detail.guests.on : t.polls.detail.guests.off),
              onError: (error) => toast.error(error),
            })
          }
        />
        {poll.guests_allowed && crewAdmin && (
          <div className="border-t border-line">
            <SwitchRow
              label={t.polls.detail.guests.joinToggle}
              description={t.polls.detail.guests.joinToggleBody}
              checked={poll.guest_join_by != null}
              disabled={setJoin.isPending}
              onChange={(allowed) =>
                setJoin.mutate(allowed, {
                  onSuccess: () => toast.success(allowed ? t.polls.detail.guests.joinOn : t.polls.detail.guests.joinOff),
                  onError: (error) => toast.error(error),
                })
              }
            />
          </div>
        )}
      </div>
      {poll.guests_allowed && !crewAdmin && poll.guest_join_by == null && (
        <p className="mt-2 text-[13px] leading-snug text-faint">{t.polls.detail.guests.joinAdminOnly}</p>
      )}
      {(poll.guests_allowed || guests.length > 0) && (
        <ul className="mt-3 space-y-1.5 text-[15px]" aria-label={t.polls.detail.guests.title}>
          {guests.length === 0 && <li className="text-sm text-muted">{t.polls.detail.guests.none}</li>}
          {guests.map((guest) => (
            <li key={guest.id} className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-fg">{t.polls.detail.guestLabel(guest.display_name)}</span>
              <Button variant="ghost" size="sm" onClick={() => setRemoving(guest)} aria-label={t.polls.detail.guests.remove(guest.display_name)}>
                {t.polls.detail.guests.removeConfirm}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title={t.polls.detail.guests.removeTitle(removing?.display_name ?? "")}
        description={t.polls.detail.guests.removeBody}
        confirmLabel={t.polls.detail.guests.removeConfirm}
        destructive
        loading={removeGuest.isPending}
        error={removeGuest.isError ? errorMessage(removeGuest.error) : null}
        onConfirm={() =>
          removing &&
          removeGuest.mutate(removing.id, {
            onSuccess: () => {
              setRemoving(null);
              toast.success(t.polls.detail.guests.removed);
            },
          })
        }
      />
    </Section>
  );
}

/**
 * W3 Etappe 2 · Wer hier als Gast abgestimmt hat (Geheimnis noch auf diesem Gerät) und jetzt Mitglied ist,
 * übernimmt die Antworten mit einem Tipp – oder löscht die Gast-Stimme. Ohne Gast-Stimme erscheint nichts.
 */
function GuestClaimCard({ pollId, token }: { pollId: string; token: string }) {
  const toast = useToast();
  const secret = useMemo(() => storedGuestSecret(token), [token]);
  const preview = useGuestClaimPreview(pollId, secret);
  const claim = useClaimGuest(pollId, token, secret);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [done, setDone] = useState(false);
  const found = preview.data?.status === "found" ? preview.data : null;
  if (!secret || !found || done) return null;

  function run(keep: boolean) {
    claim.mutate(keep, {
      onSuccess: (result) => {
        setDone(true);
        setConfirmDiscard(false);
        toast.success(keep ? t.polls.detail.guestClaim.claimed(result.claimed) : t.polls.detail.guestClaim.discarded);
      },
      // Beim Löschen steht der Fehler im Dialog; beim Übernehmen als Meldung (die Karte kann danach verschwinden).
      onError: (error) => {
        if (keep) toast.error(error);
      },
    });
  }

  return (
    <section aria-labelledby="guest-claim-title" className="mb-6 rounded-card border border-lime/60 bg-lime/10 p-5" data-testid="guest-claim">
      <h2 id="guest-claim-title" className="text-[17px] font-bold text-fg">
        {t.polls.detail.guestClaim.title}
      </h2>
      <p className="mt-1.5 max-w-prose text-[15px] leading-snug text-muted">
        {t.polls.detail.guestClaim.body(found.name, found.votes)}
        {found.conflicts > 0 && <span className="mt-1 block">{t.polls.detail.guestClaim.conflicts(found.conflicts)}</span>}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <Button onClick={() => run(true)} loading={claim.isPending && claim.variables === true} disabled={claim.isPending}>
          {t.polls.detail.guestClaim.claim}
        </Button>
        <Button variant="ghost" onClick={() => setConfirmDiscard(true)} disabled={claim.isPending}>
          {t.polls.detail.guestClaim.discard}
        </Button>
      </div>
      <ConfirmDialog
        open={confirmDiscard}
        title={t.polls.detail.guestClaim.discardTitle}
        description={t.polls.detail.guestClaim.discardBody}
        confirmLabel={t.polls.detail.guestClaim.discard}
        destructive
        loading={claim.isPending}
        error={claim.isError ? errorMessage(claim.error) : null}
        onConfirm={() => run(false)}
        onClose={() => setConfirmDiscard(false)}
      />
    </section>
  );
}

export function PollDetailPage() {
  const { pollId } = useParams();
  const user = useUser();
  const toast = useToast();
  const now = useNow(15_000);
  const pollQuery = usePoll(pollId);
  const crews = useCrews();
  const people = usePeople();
  const plans = usePlans();
  const allPolls = usePolls();
  const vote = useVote(pollId ?? "");
  const close = useClosePoll();
  const remind = useRemindPoll();
  const [confirmClose, setConfirmClose] = useState(false);
  const [planOption, setPlanOption] = useState<PollOption | null>(null);
  const [runoffOpen, setRunoffOpen] = useState(false);
  const poll = pollQuery.data;
  // W2 Etappe 2: Teilen-Link vorab holen – das Teilen-Menü muss direkt auf den Tipp hin aufgehen.
  const shareToken = usePollShareToken(poll?.id, poll?.status === "open");
  useDocumentTitle(poll?.title);

  // Läuft die Frist ab, während die Seite offen ist: einmal neu laden – dabei wird das Ergebnis festgestellt.
  const finalizedFor = useRef<string | null>(null);
  useEffect(() => {
    if (poll && poll.status === "open" && new Date(poll.ends_at) <= now && finalizedFor.current !== poll.id) {
      finalizedFor.current = poll.id;
      void pollQuery.refetch();
    }
  }, [poll, now, pollQuery]);

  if (pollQuery.isPending || crews.isPending) return <PageSpinner />;
  if (pollQuery.isError) return <ErrorState error={pollQuery.error} onRetry={() => void pollQuery.refetch()} />;
  if (!poll) {
    return (
      <EmptyState
        title={t.polls.detail.notFoundTitle}
        body={t.polls.detail.notFoundBody}
        action={
          <ButtonLink to="/plans" variant="secondary" size="sm">
            {t.polls.detail.back}
          </ButtonLink>
        }
      />
    );
  }

  const crew = crews.data?.find((c) => c.id === poll.crew_id);
  const memberIds = crew?.members.map((m) => m.user_id) ?? [];
  const summary = summarizePoll(poll, memberIds, user.id, now);
  const canManage = poll.created_by === user.id || canManageCrew(myRole(crew, user.id));
  const closed = poll.status === "closed";
  const winner = closed ? (poll.options.find((o) => o.id === poll.winning_option_id) ?? null) : null;
  const plan = plans.data?.find((p) => p.poll_id === poll.id);
  const runoff = allPolls.data?.find((p) => p.parent_poll_id === poll.id);
  const openMembers = memberIds.filter((id) => !summary.voterIds.includes(id));
  const votedCount = memberIds.length - openMembers.length;
  // W3: Gäste erscheinen in Balken und „Wer hat wie geantwortet?“ unter ihrem Namen mit „(Gast)“.
  const guests = poll.guests ?? [];
  const guestNames = new Map(guests.map((g) => [GUEST_PREFIX + g.id, g.display_name]));
  const lookup = (id: string | null | undefined) =>
    id && isGuestId(id) ? { id, display_name: guestNames.get(id) ?? "?", avatar_url: null } : people.lookup(id);

  function castVote(optionId: string, response: VoteResponse | null) {
    vote.mutate({ optionId, response }, { onError: (error) => toast.error(error) });
  }

  return (
    <>
      <PageHeader
        title={
          <span className="uppercase">
            <PosterTitle text={poll.title} />
          </span>
        }
        back={crew ? { to: `/crews/${crew.id}`, label: t.polls.detail.backToCrew(`${crew.emoji} ${crew.name}`) } : { to: "/plans", label: t.polls.detail.back }}
        actions={!summary.isOver ? <ShareButton label={t.share.poll} content={() => pollShare(poll, shareToken.data)} /> : undefined}
        lead={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {summary.isOver ? (
              <Badge tone="neutral" icon={<IconHourglass className="size-3.5" aria-hidden />}>
                {t.enums.pollStatus.closed}
              </Badge>
            ) : (
              <span className="inline-flex h-8 items-center gap-2 rounded-full bg-lime/15 px-3 text-sm font-semibold text-lime">
                <span aria-hidden className="size-2 rounded-full bg-lime" />
                {t.polls.status.endsIn(formatRelative(poll.ends_at, now))}
              </span>
            )}
            {poll.kind === "date" && <Badge tone="outline">{t.polls.detail.dateBadge}</Badge>}
            {poll.parent_poll_id && <Badge tone="outline">{t.polls.runoffBadge}</Badge>}
            {poll.guests_allowed && !summary.isOver && <Badge tone="outline">{t.polls.detail.guestsBadge}</Badge>}
            <span>{summary.isOver ? t.polls.status.ended(formatAgo(poll.closed_at ?? poll.ends_at, now)) : t.polls.participation(votedCount, memberIds.length)}</span>
          </span>
        }
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          {!summary.isOver && shareToken.data && <GuestClaimCard pollId={poll.id} token={shareToken.data} />}
          {closed && (
            <div className={cn("mb-6 rounded-card border p-5", winner ? "border-lime bg-lime/10" : "border-line bg-surface")}>
              <p className="text-sm font-semibold text-muted">{t.polls.detail.result.title}</p>
              <h2 className="display mt-1.5 text-[34px] text-fg sm:text-[40px]">
                {winner ? t.polls.detail.result.winner(winner.title) : poll.is_tie ? t.polls.detail.result.tie : t.polls.detail.result.none}
              </h2>
              <p className="mt-2 max-w-prose text-[15px] leading-snug text-muted">
                {winner
                  ? t.polls.detail.result.winnerBody(summary.maxYes)
                  : poll.is_tie
                    ? canManage
                      ? t.polls.detail.result.tieBody
                      : t.polls.detail.result.tieBodyMember
                    : t.polls.detail.result.noneBody}
                {winner && summary.missingForMinimum != null && <span className="mt-1 block font-semibold text-amber">{t.polls.detail.result.belowMinimum(summary.missingForMinimum)}</span>}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2.5">
                {plan ? (
                  <>
                    <ButtonLink to={`/plans/${plan.id}`}>{t.polls.detail.result.toPlan}</ButtonLink>
                    <span className="text-sm text-muted">{t.polls.detail.result.planExists}</span>
                  </>
                ) : runoff ? (
                  <>
                    <ButtonLink to={`/polls/${runoff.id}`}>{t.polls.detail.result.toRunoff}</ButtonLink>
                    <span className="text-sm text-muted">{t.polls.detail.result.runoffExists}</span>
                  </>
                ) : winner ? (
                  canManage ? (
                    <Button size="lg" onClick={() => setPlanOption(winner)} icon={<IconCalendarPlus className="size-5" aria-hidden />}>
                      {t.polls.detail.manage.createPlan}
                    </Button>
                  ) : (
                    <span className="text-sm text-muted">{t.polls.detail.result.waitingForOrganizer}</span>
                  )
                ) : poll.is_tie ? (
                  canManage && (
                    <Button onClick={() => setRunoffOpen(true)} icon={<IconVote className="size-4" aria-hidden />}>
                      {t.polls.detail.manage.startRunoff}
                    </Button>
                  )
                ) : (
                  <ButtonLink to={`/polls/new?crew=${poll.crew_id}`} variant="secondary">
                    {t.polls.detail.manage.newPoll}
                  </ButtonLink>
                )}
              </div>
            </div>
          )}

          <ul className="space-y-3">
            {summary.tallies.map((tally) => (
              <OptionCard
                key={tally.option.id}
                tally={tally}
                poll={poll}
                disabled={summary.isOver}
                isWinner={winner?.id === tally.option.id}
                onVote={(response) => castVote(tally.option.id, response)}
                lookup={lookup}
                action={
                  closed && poll.is_tie && canManage && !plan && !runoff && tally.leading ? (
                    <Button variant="secondary" size="sm" onClick={() => setPlanOption(tally.option)}>
                      {t.polls.detail.manage.planWithOption}
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </ul>
          {!summary.isOver && <p className="mt-4 text-[13px] leading-snug text-faint">{t.polls.detail.rule}</p>}
        </div>

        <aside className="space-y-6 lg:sticky lg:top-10 lg:self-start">
          <div className="rounded-card border border-line bg-surface p-4">
            <ParticipationBar voted={votedCount} total={memberIds.length} />
            {summary.guestVoterCount > 0 && <p className="mt-2 text-sm font-semibold text-fg">{t.polls.detail.guestVoters(summary.guestVoterCount)}</p>}
            <p className="mt-3 text-sm text-muted">
              {openMembers.length === 0 ? (
                t.polls.detail.everyoneVoted
              ) : (
                <>
                  <span className="font-semibold text-fg">{t.polls.detail.openMembers}: </span>
                  {openMembers.map((id) => (id === user.id ? t.states.you : (people.lookup(id)?.display_name ?? t.states.formerMember))).join(", ")}
                </>
              )}
            </p>
          </div>

          {(poll.budget_cents != null || poll.meeting_point || poll.min_participants != null || poll.description) && (
            <dl className="space-y-3 text-[15px]">
              {poll.description && <p className="leading-snug text-fg">{poll.description}</p>}
              {poll.budget_cents != null && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">{t.polls.detail.budget}</dt>
                  <dd className="font-semibold text-fg">{formatEuro(poll.budget_cents)}</dd>
                </div>
              )}
              {poll.min_participants != null && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">{t.polls.detail.minParticipants}</dt>
                  <dd className="font-semibold text-fg">{t.polls.detail.minParticipantsValue(poll.min_participants)}</dd>
                </div>
              )}
              {poll.meeting_point && (
                <div className="flex justify-between gap-4">
                  <dt className="shrink-0 text-muted">{t.polls.detail.meetingPoint}</dt>
                  <dd className="text-right font-semibold text-fg">{poll.meeting_point}</dd>
                </div>
              )}
            </dl>
          )}

          {!summary.isOver && <p className="text-[13px] text-faint">{t.polls.status.endsAt(formatDateTime(poll.ends_at))}</p>}
          <p className="text-[13px] text-faint">{poll.created_by === user.id ? t.polls.detail.createdByYou : t.polls.detail.createdBy(people.lookup(poll.created_by)?.display_name ?? t.states.formerMember)}</p>

          {canManage && !summary.isOver && <GuestSettings poll={poll} guests={guests} crewAdmin={canManageCrew(myRole(crew, user.id))} />}

          {canManage && !summary.isOver && (
            <Section title={t.nav.settings} className="mt-0">
              <div className="flex flex-col gap-2.5">
                <Button
                  variant="secondary"
                  block
                  loading={remind.isPending}
                  onClick={() => remind.mutate(poll.id, { onSuccess: (n) => toast.success(t.polls.detail.manage.reminded(n)), onError: (error) => toast.error(error) })}
                  icon={<IconBell className="size-4" aria-hidden />}
                >
                  {t.polls.detail.manage.remind}
                </Button>
                <Button variant="secondary" block onClick={() => setConfirmClose(true)}>
                  {t.polls.detail.manage.close}
                </Button>
              </div>
            </Section>
          )}
        </aside>
      </div>

      <ConfirmDialog
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        title={t.polls.detail.manage.closeTitle}
        description={t.polls.detail.manage.closeBody}
        confirmLabel={t.polls.detail.manage.close}
        loading={close.isPending}
        error={close.isError ? errorMessage(close.error) : null}
        onConfirm={() =>
          close.mutate(poll.id, {
            onSuccess: () => {
              setConfirmClose(false);
              toast.success(t.polls.detail.manage.closed);
            },
          })
        }
      />
      <PlanFromPollDialog poll={poll} option={planOption} onClose={() => setPlanOption(null)} />
      <RunoffDialog poll={poll} open={runoffOpen} onClose={() => setRunoffOpen(false)} />
    </>
  );
}
