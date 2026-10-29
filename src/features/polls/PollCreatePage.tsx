import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { IconCalendar, IconCrews, IconEdit, IconHourglass, IconPin, IconPlus, IconSparkles, IconTrash, IconVote } from "@/components/icons";
import { PageHeader } from "@/components/layout/Page";
import { Button, ButtonLink, IconButton } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Controls";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/ui/Feedback";
import { FormMessage, TextAreaField, TextField } from "@/components/ui/Field";
import { CHOICE_CARD, CHOICE_CARD_ON, DateTile, FormCard } from "@/components/ui/FormCard";
import { GLASS_PILL, LivePill } from "@/components/ui/Pill";
import { useToast } from "@/components/ui/Toast";
import { useCrews } from "@/features/crews/api";
import { CrewPicker } from "@/features/crews/CrewPicker";
import { typicalPriceCents, useActivity } from "@/features/discover/api";
import { usePlans } from "@/features/plans/api";
import { planCountdown } from "@/features/plans/PlanTicket";
import { locale, t } from "@/i18n";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { centsToInput, parseEuroInput } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { suggestDateSlots, type SuggestedSlot } from "@/lib/slots";
import { categoryWorld } from "@/lib/stage";
import { addDays, calendarDaysBetween, formatDateLong, formatTime, fromLocalInputValue, nextWeekday, today, toLocalInputValue, zonedParts, zonedToUtc } from "@/lib/time";
import type { Activity, ActivityCategory, PollKind } from "@/lib/types";
import { ActivityPicker } from "./ActivityPicker";
import { useCreateDatePoll, useCreatePoll, useCreateWherePoll, usePoll, type PollOptionInput } from "./api";
import { MAX_POLL_OPTIONS, usePollDraft } from "./draft";
import { dateOptionLabel, upcomingDateWinner } from "./logic";

interface OptionRow {
  key: string;
  activityId: string | null;
  /** Kategorie des Orts (nur bei Orten aus der Auswahl; aus Discover vorgemerkte haben keine) – für die Farbwelt. */
  category: ActivityCategory | null;
  title: string;
  price: string;
  ownWhen: boolean;
  date: string;
  time: string;
}

type EndPreset = "twoHours" | "tonight" | "tomorrow" | "custom";

/** P1: ein Termin der Termin-Abstimmung (Uhrzeit optional). */
interface SlotRow {
  key: string;
  date: string;
  time: string;
}
const MIN_DATE_SLOTS = 2;
const MAX_DATE_SLOTS = 10;

/** Datum aus dem Link nur, wenn es gültig ist und nicht in der Vergangenheit liegt. */
function linkedDate(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !zonedToUtc(value, "12:00")) return null;
  return value >= today() ? value : null;
}

/** Uhrzeit aus dem Link; fehlt sie (Termin ohne Uhrzeit), bleibt sie offen statt erfunden. */
function linkedTime(value: string | null): string {
  return value && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : "";
}

/** P5 Etappe 3: Ort aus dem Link (`?place=<id>`) nur, wenn es eine gültige ID ist. */
function linkedPlace(value: string | null): string | null {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

/** „Wann könnt ihr zu Strike?“ – nur, wenn es in die 80 Zeichen des Titels passt. */
function placeTitle(name: string): string {
  const title = t.polls.create.dates.place.defaultTitle(name);
  return title.length <= 80 ? title : t.polls.create.dates.defaultTitle;
}

let rowCounter = 0;
const newKey = () => `opt-${++rowCounter}`;

/** Vorschlag ohne Daten der Crew: nächstes Wochenende (Fr, Sa) und der Freitag danach, jeweils 19 Uhr. */
function defaultSlots(): SlotRow[] {
  const friday = nextWeekday("fri", true);
  return [friday, nextWeekday("sat", true), addDays(friday, 7)].map((date) => ({ key: newKey(), date, time: "19:00" }));
}

const sameSlot = (row: SlotRow, slot: SuggestedSlot) => row.date === slot.date && row.time === slot.time;
const bySlot = (a: SlotRow, b: SlotRow) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time);

export function PollCreatePage() {
  useDocumentTitle(t.polls.create.title);
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const crews = useCrews();
  const draft = usePollDraft();
  const createPoll = useCreatePoll();
  const createDatePoll = useCreateDatePoll();
  const createWherePoll = useCreateWherePoll();
  // P1 Etappe 3a: „Und wo?“ verknüpft die Orts- mit der Termin-Abstimmung (?where=<id>). Ist sie nicht
  // (mehr) entschieden oder nicht sichtbar, bleibt es eine normale Abstimmung mit dem Datum aus dem Link.
  const whereId = params.get("where");
  const datePoll = usePoll(whereId ?? undefined);
  const linkedWinner = upcomingDateWinner(datePoll.data);
  // P5 Etappe 3: „Termin finden“ in Discover bringt den Ort mit (?kind=date&place=<id>).
  const [placeId, setPlaceId] = useState<string | null>(() => linkedPlace(params.get("place")));
  const [kind, setKind] = useState<PollKind>(params.get("kind") === "date" || placeId ? "date" : "place");
  const placeQuery = useActivity(kind === "date" ? placeId : null);
  const [pickedPlace, setPickedPlace] = useState<Activity | null>(null);
  const fixedPlace = kind === "date" && placeId ? (pickedPlace?.id === placeId ? pickedPlace : (placeQuery.data ?? null)) : null;
  const placeMissing = kind === "date" && Boolean(placeId) && !fixedPlace && (placeQuery.isError || (placeQuery.isSuccess && !placeQuery.data));
  const [slots, setSlots] = useState<SlotRow[]>(defaultSlots);
  const [crewId, setCrewId] = useState(params.get("crew") ?? "");
  // P1 Etappe 3b: Hat die Crew eine Gewohnheit (Lieblingstag, übliche Uhrzeit), stehen deren nächste Termine
  // statt des Wochenendes drin – aber nur, solange niemand die Termine selbst angefasst hat.
  const plans = usePlans();
  const suggestion = useMemo(
    () => (plans.data && crewId ? suggestDateSlots(plans.data.filter((p) => p.crew_id === crewId)) : null),
    [plans.data, crewId],
  );
  const suggestionKey = suggestion ? suggestion.slots.map((s) => `${s.date} ${s.time}`).join("|") : "";
  const slotsTouched = useRef(false);
  const [prefilled, setPrefilled] = useState(false);
  useEffect(() => {
    if (slotsTouched.current) return;
    if (suggestion && suggestion.slots.length >= MIN_DATE_SLOTS) {
      setSlots(suggestion.slots.map((slot) => ({ key: newKey(), date: slot.date, time: slot.time })));
      setPrefilled(true);
    } else if (prefilled) {
      setSlots(defaultSlots());
      setPrefilled(false);
    }
    // Nur neu vorbelegen, wenn sich die Vorschläge selbst ändern (andere Crew, Daten geladen).
  }, [suggestionKey]);
  // P1 Etappe 2: „Und wo?“ nach einer Termin-Abstimmung bringt den Gewinner-Termin mit (?date=…&time=…).
  const [sharedDate, setSharedDate] = useState(() => linkedDate(params.get("date")) ?? nextWeekday("sat", true));
  const [sharedTime, setSharedTime] = useState(() => (linkedDate(params.get("date")) ? linkedTime(params.get("time")) : "19:00"));
  const [title, setTitle] = useState("");
  const titleTouched = useRef(false);
  const [options, setOptions] = useState<OptionRow[]>(() =>
    draft.items.map((item) => ({ key: newKey(), activityId: item.activityId, category: null, title: item.title, price: centsToInput(item.priceCents), ownWhen: false, date: "", time: "" })),
  );
  const [endPreset, setEndPreset] = useState<EndPreset>("tomorrow");
  const [endCustom, setEndCustom] = useState(() => toLocalInputValue(new Date(Date.now() + 24 * 3600_000)));
  const [meetingPoint, setMeetingPoint] = useState("");
  const [budget, setBudget] = useState("");
  const [minParticipants, setMinParticipants] = useState("");
  const [description, setDescription] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [formError, setFormError] = useState<string | null>(null);

  // Vorauswahl: einzige Crew bzw. Crew aus dem Link.
  useEffect(() => {
    if (!crews.data || crews.data.length === 0) return;
    if (!crews.data.some((c) => c.id === crewId)) setCrewId(crews.data[0]?.id ?? "");
  }, [crews.data, crewId]);

  // Titelvorschlag folgt dem Datum, bis jemand selbst tippt.
  const suggestedTitle = useMemo(() => {
    const at = sharedDate ? zonedToUtc(sharedDate, "12:00") : null;
    return at ? t.polls.create.defaultTitle(t.weekdays[zonedParts(at).weekday]) : t.polls.create.pollTitlePlaceholder;
  }, [sharedDate]);
  const dateTitle = fixedPlace ? placeTitle(fixedPlace.name) : t.polls.create.dates.defaultTitle;
  useEffect(() => {
    if (!titleTouched.current) setTitle(kind === "date" ? dateTitle : suggestedTitle);
  }, [suggestedTitle, kind, dateTitle]);

  const tonight = zonedToUtc(today(), "20:00");
  const tonightAvailable = Boolean(tonight && tonight.getTime() > Date.now() + 15 * 60_000);

  function resolveEnd(): Date | null {
    if (endPreset === "twoHours") return new Date(Date.now() + 2 * 3600_000);
    if (endPreset === "tonight") return tonight;
    if (endPreset === "tomorrow") return zonedToUtc(addDays(today(), 1), "12:00");
    return fromLocalInputValue(endCustom);
  }

  const selectedActivityIds = useMemo(() => new Set(options.map((o) => o.activityId).filter((id): id is string => Boolean(id))), [options]);
  const full = options.length >= MAX_POLL_OPTIONS;

  function toggleActivity(activity: Activity) {
    setOptions((rows) => {
      if (rows.some((r) => r.activityId === activity.id)) return rows.filter((r) => r.activityId !== activity.id);
      if (rows.length >= MAX_POLL_OPTIONS) return rows;
      return [...rows, { key: newKey(), activityId: activity.id, category: activity.category, title: activity.name, price: centsToInput(typicalPriceCents(activity)), ownWhen: false, date: "", time: "" }];
    });
  }
  const patchOption = (key: string, update: Partial<OptionRow>) => setOptions((rows) => rows.map((r) => (r.key === key ? { ...r, ...update } : r)));

  const patchSlot = (key: string, update: Partial<SlotRow>) => {
    slotsTouched.current = true;
    setSlots((rows) => rows.map((r) => (r.key === key ? { ...r, ...update } : r)));
  };
  function removeSlot(key: string) {
    slotsTouched.current = true;
    setSlots((rows) => rows.filter((r) => r.key !== key));
  }
  /** Vorschlag an- oder abwählen; mindestens zwei, höchstens zehn Termine bleiben. */
  function toggleSuggested(slot: SuggestedSlot) {
    slotsTouched.current = true;
    setSlots((rows) => {
      if (rows.some((r) => sameSlot(r, slot))) return rows.length > MIN_DATE_SLOTS ? rows.filter((r) => !sameSlot(r, slot)) : rows;
      if (rows.length >= MAX_DATE_SLOTS) return rows;
      return [...rows, { key: newKey(), date: slot.date, time: slot.time }].sort(bySlot);
    });
  }
  function addSlot() {
    slotsTouched.current = true;
    setSlots((rows) => {
      if (rows.length >= MAX_DATE_SLOTS) return rows;
      const last = rows[rows.length - 1];
      return [...rows, { key: newKey(), date: last?.date ? addDays(last.date, 1) : nextWeekday("fri", true), time: last?.time ?? "19:00" }];
    });
  }

  function submitDates() {
    const next: Record<string, string | null> = {};
    if (!crewId) next.crew = t.validation.required;
    if (title.trim().length < 3) next.title = t.validation.minLength(3);
    const seen = new Set<string>();
    for (const row of slots) {
      const at = row.date ? zonedToUtc(row.date, row.time || "23:59") : null;
      if (!row.date || !at) next[`slot-${row.key}`] = t.validation.dateRequired;
      else if (at.getTime() <= Date.now()) next[`slot-${row.key}`] = t.validation.dateInPast;
      else if (seen.has(`${row.date} ${row.time}`)) next[`slot-${row.key}`] = t.polls.create.dates.duplicate;
      seen.add(`${row.date} ${row.time}`);
    }
    if (slots.length < MIN_DATE_SLOTS) next.slots = t.polls.create.dates.tooFew;
    if (placeMissing) next.place = t.polls.create.dates.place.missing;
    const endsAt = resolveEnd();
    if (!endsAt) next.ends = t.validation.dateRequired;
    else if (endsAt.getTime() <= Date.now()) next.ends = t.validation.dateInPast;

    setErrors(next);
    setFormError(null);
    if (Object.values(next).some(Boolean) || !endsAt) return;
    createDatePoll.mutate(
      {
        crewId,
        title: title.trim(),
        endsAt,
        slots: slots.map((row) => ({ date: row.date, time: row.time || null })),
        description: description.trim() || null,
        activityId: placeId,
      },
      {
        onSuccess: (pollId) => {
          toast.success(t.polls.create.started);
          navigate(`/polls/${pollId}`, { replace: true });
        },
        onError: (error) => setFormError(errorMessage(error)),
      },
    );
  }

  const linked = kind === "place" && linkedWinner && datePoll.data ? { poll: datePoll.data, winner: linkedWinner } : null;
  const linkedLoading = kind === "place" && Boolean(whereId) && datePoll.isPending;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (kind === "date") return submitDates();
    if (linkedLoading) return;
    const next: Record<string, string | null> = {};
    if (!crewId) next.crew = t.validation.required;
    if (title.trim().length < 3) next.title = t.validation.minLength(3);
    if (options.length === 0) next.options = t.polls.create.noOptions;

    const payload: PollOptionInput[] = [];
    for (const row of options) {
      const price = parseEuroInput(row.price);
      if (!row.activityId && row.title.trim() === "") next[`title-${row.key}`] = t.polls.create.optionTitleMissing;
      if (price === undefined) next[`price-${row.key}`] = t.validation.amount;
      // Verknüpft: Termin aus „Wann könnt ihr?“ für alle (der Server setzt ihn ohnehin selbst).
      const date = linked ? linked.winner.proposed_date : row.ownWhen ? row.date : sharedDate;
      const time = linked ? (linked.winner.proposed_time?.slice(0, 5) ?? "") : row.ownWhen ? row.time : sharedTime;
      payload.push({
        activity_id: row.activityId,
        title: row.title.trim() || null,
        proposed_date: date || null,
        proposed_time: date && time ? time : null,
        estimated_price_cents: price ?? null,
      });
    }

    const endsAt = resolveEnd();
    if (!endsAt) next.ends = t.validation.dateRequired;
    else if (endsAt.getTime() <= Date.now()) next.ends = t.validation.dateInPast;

    const budgetCents = parseEuroInput(budget);
    if (budgetCents === undefined) next.budget = t.validation.amount;
    const min = minParticipants.trim() === "" ? null : Number(minParticipants);
    if (min !== null && (!Number.isInteger(min) || min < 1 || min > 50)) next.min = t.validation.number;

    setErrors(next);
    setFormError(null);
    if (Object.values(next).some(Boolean) || !endsAt) return;

    const input = { title: title.trim(), endsAt, options: payload, description: description.trim() || null, meetingPoint: meetingPoint.trim() || null, budgetCents: budgetCents ?? null, minParticipants: min };
    const handlers = {
      onSuccess: (pollId: string) => {
        draft.clear();
        toast.success(t.polls.create.started);
        navigate(`/polls/${pollId}`, { replace: true });
      },
      onError: (error: unknown) => setFormError(errorMessage(error)),
    };
    if (linked) createWherePoll.mutate({ ...input, datePollId: linked.poll.id }, handlers);
    else createPoll.mutate({ ...input, crewId }, handlers);
  }

  if (crews.isPending) return <ListSkeleton rows={3} />;
  if (crews.isError) return <ErrorState error={crews.error} onRetry={() => void crews.refetch()} />;
  if (crews.data.length === 0) {
    return (
      <>
        <PageHeader title={t.polls.create.title} back={{ to: "/home", label: t.nav.home }} />
        <EmptyState art={<IconCrews aria-hidden />} title={t.polls.create.needCrewTitle} body={t.polls.create.needCrewBody} action={<ButtonLink to="/crews?new=1">{t.polls.create.needCrewAction}</ButtonLink>} />
      </>
    );
  }

  const endsAt = resolveEnd();
  const whenPreview = linked ? null : sharedDate ? zonedToUtc(sharedDate, sharedTime || "12:00") : null;

  return (
    <>
      <PageHeader
        title={t.polls.create.title}
        lead={kind === "date" ? (fixedPlace ? t.polls.create.dates.place.leadWithPlace(fixedPlace.name) : t.polls.create.dates.lead) : t.polls.create.lead}
        back={{ to: "/plans", label: t.nav.plans }}
      />
      <form onSubmit={submit} noValidate className="max-w-2xl space-y-4">
        {/* P1: Ort oder Termin – dieselbe Abstimmung, andere Optionen. V2 Etappe 3n: als zwei Auswahlkarten. */}
        <KindSwitch
          value={kind}
          onChange={(value) => {
            setKind(value);
            // Titelvorschlag sofort mitwechseln (nicht erst im Effekt), solange niemand selbst getippt hat.
            if (!titleTouched.current) setTitle(value === "date" ? dateTitle : suggestedTitle);
            setErrors({});
            setFormError(null);
          }}
        />

        {crews.data.length > 1 && !linked && (
          <FormCard title={t.polls.create.crew} icon={<IconCrews className="size-[18px]" />} tone="pink" testId="poll-form-crew">
            <CrewPicker crews={crews.data} value={crewId} onChange={setCrewId} label={t.polls.create.crew} />
            {errors.crew && <FormMessage>{errors.crew}</FormMessage>}
          </FormCard>
        )}

        <FormCard title={t.polls.create.sections.question} icon={<IconVote className="size-[18px]" />} tone="lime" testId="poll-form-question">
          <TextField
            label={t.polls.create.pollTitle}
            name="title"
            value={title}
            onChange={(e) => {
              titleTouched.current = true;
              setTitle(e.target.value);
            }}
            maxLength={80}
            error={errors.title}
            required
          />
        </FormCard>

        {kind === "date" && (
          <DatePlaceCard
            place={fixedPlace}
            loading={Boolean(placeId) && !fixedPlace && placeQuery.isPending}
            error={errors.place ?? (placeMissing ? t.polls.create.dates.place.missing : null)}
            onPick={() => setPickerOpen(true)}
            onRemove={() => {
              setPlaceId(null);
              setPickedPlace(null);
              setErrors((current) => ({ ...current, place: null }));
            }}
          />
        )}

        {kind === "date" ? (
          <FormCard title={t.polls.create.dates.title} icon={<IconCalendar className="size-[18px]" />} tone="violet" testId="poll-form-dates">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[13px] text-muted">{t.polls.create.dates.hint}</p>
              <span className={cn(GLASS_PILL, "h-8 text-[13px]")}>{t.polls.create.count(slots.length, MAX_DATE_SLOTS)}</span>
            </div>
            {suggestion && (
              <div className="rounded-[20px] border border-lime/40 bg-lime/[0.08] p-4" data-testid="date-suggestions">
                <p className="flex items-center gap-2 text-sm font-semibold text-lime">
                  <IconSparkles className="size-4 shrink-0" aria-hidden />
                  {t.polls.create.dates.suggest.title}
                </p>
                <p className="mt-1 text-[13px] text-fg">
                  {t.polls.create.dates.suggest.habit(
                    suggestion.weekdayCount,
                    suggestion.evenings,
                    t.polls.create.dates.suggest.weekdays[suggestion.weekday] ?? "",
                    suggestion.time,
                    suggestion.timeCount >= 2,
                  )}
                </p>
                <p className="mt-0.5 text-[13px] text-muted">{prefilled && !slotsTouched.current ? t.polls.create.dates.suggest.applied : t.polls.create.dates.suggest.pick}</p>
                <ul className="mt-3 flex flex-wrap gap-2" aria-label={t.polls.create.dates.suggest.listLabel}>
                  {suggestion.slots.map((slot) => {
                    const [, month, day] = slot.date.split("-");
                    return (
                      <li key={`${slot.date} ${slot.time}`}>
                        <Chip selected={slots.some((r) => sameSlot(r, slot))} onToggle={() => toggleSuggested(slot)}>
                          {t.polls.create.dates.suggest.chip(t.polls.create.dates.suggest.short[slot.weekday] ?? "", locale === "en" ? `${Number(day)}/${Number(month)}` : `${day}.${month}.`, slot.time)}
                        </Chip>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            <ol className="space-y-3">
              {slots.map((row, index) => (
                <li key={row.key} className={cn(CHOICE_CARD, "p-3 sm:p-4")} data-testid="poll-form-slot">
                  <div className="flex items-start gap-3">
                    <div className="mt-6 hidden min-[380px]:block">
                      <DateTile at={row.date ? zonedToUtc(row.date, row.time || "12:00") : null} size="sm" />
                    </div>
                    <div className="grid min-w-0 flex-1 grid-cols-2 gap-3">
                      <TextField
                        label={t.polls.create.dates.dateLabel(index + 1)}
                        name={`slot-date-${index}`}
                        type="date"
                        min={today()}
                        max={addDays(today(), 365)}
                        value={row.date}
                        onChange={(e) => patchSlot(row.key, { date: e.target.value })}
                        error={errors[`slot-${row.key}`]}
                      />
                      <TextField label={t.polls.create.time} name={`slot-time-${index}`} type="time" value={row.time} onChange={(e) => patchSlot(row.key, { time: e.target.value })} optional />
                    </div>
                    <IconButton label={t.polls.create.dates.remove(index + 1)} onClick={() => removeSlot(row.key)} disabled={slots.length <= MIN_DATE_SLOTS} className="mt-6">
                      <IconTrash className="size-[18px] text-muted" aria-hidden />
                    </IconButton>
                  </div>
                </li>
              ))}
            </ol>
            {errors.slots && <FormMessage>{errors.slots}</FormMessage>}
            <Button variant="secondary" onClick={addSlot} disabled={slots.length >= MAX_DATE_SLOTS} icon={<IconPlus className="size-4" aria-hidden />}>
              {t.polls.create.dates.add}
            </Button>
          </FormCard>
        ) : (
          <>
            <FormCard title={t.polls.create.whenTitle} icon={<IconCalendar className="size-[18px]" />} tone="violet" testId="poll-form-when">
              {linked ? (
                <div className="flex items-center gap-3.5 rounded-[20px] border border-lime/40 bg-lime/[0.08] p-3.5" data-testid="poll-linked-when">
                  <DateTile at={zonedToUtc(linked.winner.proposed_date ?? "", linked.winner.proposed_time?.slice(0, 5) ?? "12:00")} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-lime">{t.polls.create.linkedWhen.title}</p>
                    <p className="display mt-1 text-[17px] leading-tight text-fg">{dateOptionLabel(linked.winner)}</p>
                    <p className="mt-1.5 text-[13px] leading-snug text-muted">{t.polls.create.linkedWhen.body}</p>
                    <Link to={`/polls/${linked.poll.id}`} className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-fg underline decoration-lime underline-offset-4">
                      {t.polls.create.linkedWhen.back}
                    </Link>
                  </div>
                </div>
              ) : linkedLoading ? (
                <p className="flex min-h-24 items-center text-sm text-muted" role="status">
                  {t.polls.create.linkedWhen.loading}
                </p>
              ) : (
                <>
                  <div className="flex items-center gap-3.5" data-testid="poll-form-when-preview" data-filled={whenPreview ? "true" : "false"}>
                    <DateTile at={whenPreview} />
                    <div className="min-w-0">
                      {whenPreview ? (
                        <>
                          <p className="truncate font-semibold text-fg">{formatDateLong(whenPreview)}</p>
                          <p className="mt-0.5 text-[14px] text-muted">
                            {sharedTime ? formatTime(whenPreview) : t.polls.create.timeOpen}
                            {whenCountdown(whenPreview) && <span className="ml-2 font-display text-[12px] font-extrabold uppercase tracking-wide text-lime">{whenCountdown(whenPreview)}</span>}
                          </p>
                        </>
                      ) : (
                        <p className="text-[14px] leading-snug text-muted">{t.polls.create.whenOpen}</p>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:gap-4">
                    <TextField label={t.polls.create.date} name="date" type="date" min={today()} value={sharedDate} onChange={(e) => setSharedDate(e.target.value)} optional />
                    <TextField label={t.polls.create.time} name="time" type="time" value={sharedTime} onChange={(e) => setSharedTime(e.target.value)} disabled={!sharedDate} optional />
                  </div>
                  <p className="text-[13px] leading-snug text-muted">{t.polls.create.whenHint}</p>
                </>
              )}
            </FormCard>

            <FormCard title={t.polls.create.optionsTitle} icon={<IconPin className="size-[18px]" />} tone="pink" testId="poll-form-options">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13px] text-muted">{t.polls.create.optionsHint}</p>
                <span className={cn(GLASS_PILL, "h-8 text-[13px]", options.length > 0 && "border-lime/40 text-lime")}>{t.polls.create.count(options.length, MAX_POLL_OPTIONS)}</span>
              </div>
              {options.length > 0 && (
                <ul className="space-y-3">
                  {options.map((row, index) => (
                    // Orte aus Discover in der Farbwelt ihrer Kategorie (wie dort), eigene Ideen als dunkles Glas.
                    <li
                      key={row.key}
                      className={cn("rounded-[20px] border border-white/10 p-3.5 sm:p-4", row.category ? "cat-world" : "bg-white/[0.04]")}
                      data-world={row.category ? categoryWorld(row.category) : undefined}
                      data-testid="poll-form-option"
                    >
                      <div className="flex items-start gap-3">
                        <span aria-hidden className="mt-1.5 grid size-8 shrink-0 place-items-center rounded-full bg-lime font-display text-[14px] font-extrabold text-lime-ink">
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          {row.activityId ? (
                            <div className="flex min-h-11 flex-col justify-center">
                              <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">{t.polls.create.optionPlace}</p>
                              <p className="display break-words text-[16px] leading-tight text-fg">{row.title}</p>
                            </div>
                          ) : (
                            <TextField
                              label={t.polls.create.customLabel(index + 1)}
                              name={`option-${index}`}
                              value={row.title}
                              onChange={(e) => patchOption(row.key, { title: e.target.value })}
                              placeholder={t.polls.create.customPlaceholder}
                              maxLength={120}
                              error={errors[`title-${row.key}`]}
                            />
                          )}
                        </div>
                        <IconButton label={t.polls.create.removeOption(row.title)} onClick={() => setOptions((rows) => rows.filter((r) => r.key !== row.key))} className={cn(!row.activityId && "mt-6")}>
                          <IconTrash className="size-[18px] text-muted" aria-hidden />
                        </IconButton>
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <TextField
                          label={t.polls.create.optionPrice}
                          name={`price-${index}`}
                          inputMode="decimal"
                          value={row.price}
                          onChange={(e) => patchOption(row.key, { price: e.target.value })}
                          placeholder={t.polls.create.optionPricePlaceholder}
                          error={errors[`price-${row.key}`]}
                          hint={t.polls.create.optionPriceHint}
                          trailing={<span className="pr-3 text-muted">€</span>}
                          optional
                        />
                        {!linked && (
                          <label className="flex min-h-11 cursor-pointer items-center gap-3 self-start text-sm text-fg sm:mt-7">
                            <input type="checkbox" checked={row.ownWhen} onChange={(e) => patchOption(row.key, { ownWhen: e.target.checked, date: row.date || sharedDate, time: row.time || sharedTime })} className="size-5 shrink-0 accent-[var(--color-lime)]" />
                            {t.polls.create.ownDate}
                          </label>
                        )}
                      </div>
                      {row.ownWhen && !linked && (
                        <div className="mt-3 grid grid-cols-2 gap-3">
                          <TextField label={t.polls.create.date} type="date" min={today()} value={row.date} onChange={(e) => patchOption(row.key, { date: e.target.value })} />
                          <TextField label={t.polls.create.time} type="time" value={row.time} onChange={(e) => patchOption(row.key, { time: e.target.value })} />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {errors.options && <FormMessage>{errors.options}</FormMessage>}
              <div className="flex flex-wrap gap-2.5">
                <Button variant="secondary" onClick={() => setPickerOpen(true)} disabled={full} icon={<IconPin className="size-4" aria-hidden />}>
                  {t.polls.create.addPlace}
                </Button>
                <Button variant="secondary" onClick={() => setOptions((rows) => [...rows, { key: newKey(), activityId: null, category: null, title: "", price: "", ownWhen: false, date: "", time: "" }])} disabled={full} icon={<IconPlus className="size-4" aria-hidden />}>
                  {t.polls.create.addCustom}
                </Button>
              </div>
            </FormCard>
          </>
        )}

        <FormCard title={t.polls.create.sections.ends} icon={<IconHourglass className="size-[18px]" />} tone="lime" testId="poll-form-ends">
          <div className="flex flex-wrap gap-2" role="group" aria-label={t.polls.create.endsTitle}>
            <Chip selected={endPreset === "twoHours"} onToggle={() => setEndPreset("twoHours")}>
              {t.polls.create.endsPresets.twoHours}
            </Chip>
            {tonightAvailable && (
              <Chip selected={endPreset === "tonight"} onToggle={() => setEndPreset("tonight")}>
                {t.polls.create.endsPresets.tonight}
              </Chip>
            )}
            <Chip selected={endPreset === "tomorrow"} onToggle={() => setEndPreset("tomorrow")}>
              {t.polls.create.endsPresets.tomorrow}
            </Chip>
            <Chip selected={endPreset === "custom"} onToggle={() => setEndPreset("custom")}>
              {t.polls.create.endsPresets.custom}
            </Chip>
          </div>
          {endPreset === "custom" && <TextField fieldClassName="max-w-xs" label={t.polls.create.endsCustom} type="datetime-local" value={endCustom} onChange={(e) => setEndCustom(e.target.value)} min={toLocalInputValue(new Date())} />}
          {/* Was gerade gilt, als Lime-Pille – wie die Frist im Kopf der Abstimmung (V2 Etappe 3d). */}
          {endsAt && endsAt.getTime() > Date.now() && (
            <p>
              <LivePill testId="poll-form-ends-at">{t.polls.create.endsAt(endsLabel(endsAt))}</LivePill>
            </p>
          )}
          {errors.ends && (
            <p role="alert" className="text-[13px] text-danger">
              {errors.ends}
            </p>
          )}
        </FormCard>

        <FormCard title={t.polls.create.sections.more} icon={<IconEdit className="size-[18px]" />} tone="violet" testId="poll-form-more">
          {kind === "place" && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label={t.polls.create.budget} name="budget" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} error={errors.budget} hint={t.polls.create.budgetHint} trailing={<span className="pr-3 text-muted">€</span>} optional />
                <TextField label={t.polls.create.minParticipants} name="min_participants" inputMode="numeric" value={minParticipants} onChange={(e) => setMinParticipants(e.target.value)} error={errors.min} hint={t.polls.create.minParticipantsHint} optional />
              </div>
              <TextField label={t.polls.create.meetingPoint} name="meeting_point" value={meetingPoint} onChange={(e) => setMeetingPoint(e.target.value)} placeholder={t.polls.create.meetingPointPlaceholder} maxLength={160} optional />
            </>
          )}
          <TextAreaField label={t.polls.create.description} name="description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={2} optional />
        </FormCard>

        <div className="space-y-4 pt-4">
          {formError && <FormMessage>{formError}</FormMessage>}
          <Button type="submit" size="lg" block loading={createPoll.isPending || createDatePoll.isPending || createWherePoll.isPending}>
            {t.polls.create.submit}
          </Button>
        </div>
      </form>

      {kind === "date" ? (
        // P5 Etappe 3: genau ein Ort – antippen wählt ihn und schließt die Suche.
        <ActivityPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          selectedIds={new Set(placeId ? [placeId] : [])}
          onToggle={(activity) => {
            const off = activity.id === placeId;
            setPlaceId(off ? null : activity.id);
            setPickedPlace(off ? null : activity);
            setErrors((current) => ({ ...current, place: null }));
            if (!off) setPickerOpen(false);
          }}
        />
      ) : (
        <ActivityPicker open={pickerOpen} onClose={() => setPickerOpen(false)} selectedIds={selectedActivityIds} onToggle={toggleActivity} />
      )}
    </>
  );
}

/**
 * P5 Etappe 3 · Fester Ort für „Wann könnt ihr?“ (optional). Gewählt: Karte in der Farbwelt der Kategorie wie
 * die Orts-Vorschläge; ohne Ort ein kurzer Hinweis und „Ort festlegen“.
 */
function DatePlaceCard({ place, loading, error, onPick, onRemove }: { place: Activity | null; loading: boolean; error: string | null; onPick: () => void; onRemove: () => void }) {
  const copy = t.polls.create.dates.place;
  return (
    <FormCard title={copy.title} icon={<IconPin className="size-[18px]" />} tone="pink" testId="poll-form-date-place">
      {place ? (
        <div className="cat-world rounded-[20px] border border-white/10 p-3.5 sm:p-4" data-world={categoryWorld(place.category)} data-testid="poll-form-date-place-chosen">
          <div className="flex items-start gap-3">
            <span aria-hidden className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-full bg-lime text-lime-ink">
              <IconPin className="size-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">{copy.fixed}</p>
              <p className="display break-words text-[17px] leading-tight text-fg">{place.name}</p>
              <p className="mt-1 text-[13px] text-muted">
                {t.enums.category[place.category]}
                {place.city ? `, ${place.city}` : ""}
              </p>
            </div>
            <IconButton label={copy.remove} onClick={onRemove}>
              <IconTrash className="size-[18px] text-muted" aria-hidden />
            </IconButton>
          </div>
          {(place.latitude == null || place.longitude == null) && <p className="mt-3 text-[13px] leading-snug text-muted">{copy.noWeather}</p>}
        </div>
      ) : loading ? (
        <p className="flex min-h-14 items-center text-sm text-muted" role="status">
          {copy.loading}
        </p>
      ) : (
        <p className="text-[13px] leading-snug text-muted">{copy.hint}</p>
      )}
      {error && <FormMessage>{error}</FormMessage>}
      <div>
        <Button variant="secondary" onClick={onPick} icon={<IconPin className="size-4" aria-hidden />}>
          {place ? copy.change : copy.pick}
        </Button>
      </div>
    </FormCard>
  );
}

/** „In 3 Tagen“, „Morgen“ … wie auf der Plan-Karte; nur bis knapp zwei Wochen voraus. */
function whenCountdown(at: Date): string | null {
  return at.getTime() > Date.now() ? planCountdown({ starts_at: at.toISOString(), status: "proposed" }, new Date()) : null;
}

/** „heute, 20:00 Uhr“, „morgen, 12:00 Uhr“, sonst „Freitag, 30. Oktober, 18:00 Uhr“ (Berliner Zeit). */
function endsLabel(at: Date): string {
  const days = calendarDaysBetween(new Date(), at);
  const day = days === 0 ? t.polls.create.endsToday : days === 1 ? t.polls.create.endsTomorrow : formatDateLong(at);
  return `${day}, ${formatTime(at)}`;
}

/**
 * V2 Etappe 3n · Worüber abgestimmt wird – zwei Auswahlkarten statt Reitern, mit Symbol-Kachel und kurzer
 * Beschreibung. Bleibt technisch eine Reiterleiste (`tablist`/`tab`, Pfeiltasten), wie bisher `Segmented`.
 */
function KindSwitch({ value, onChange }: { value: PollKind; onChange: (value: PollKind) => void }) {
  const kinds: { value: PollKind; icon: ReactNode }[] = [
    { value: "place", icon: <IconPin className="size-[18px]" /> },
    { value: "date", icon: <IconCalendar className="size-[18px]" /> },
  ];
  return (
    <div
      role="tablist"
      aria-label={t.polls.create.kindLabel}
      className="grid grid-cols-2 gap-2.5"
      onKeyDown={(event) => {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        event.preventDefault();
        const next = value === "place" ? "date" : "place";
        onChange(next);
        event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next === "place" ? 0 : 1]?.focus();
      }}
    >
      {kinds.map((kind) => {
        const on = kind.value === value;
        return (
          <button
            key={kind.value}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(kind.value)}
            className={cn(CHOICE_CARD, "flex min-w-0 flex-col items-start gap-2 p-3.5 text-left sm:flex-row sm:items-center sm:gap-3", on && CHOICE_CARD_ON)}
          >
            <span aria-hidden className={cn("grid size-10 shrink-0 place-items-center rounded-full border transition-colors", on ? "border-lime bg-lime text-lime-ink" : "border-white/15 bg-white/[0.06] text-fg")}>
              {kind.icon}
            </span>
            <span className="min-w-0">
              <span className="display block text-[15px] leading-tight text-fg">{t.polls.create.kinds[kind.value]}</span>
              <span className="mt-0.5 block text-[12px] leading-snug text-muted">{t.polls.create.kindHints[kind.value]}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
