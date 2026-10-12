import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { IconCheck, IconPin, IconPlus, IconSearch, IconSpinner, IconTrash } from "@/components/icons";
import { PageHeader, Section } from "@/components/layout/Page";
import { Button, ButtonLink, IconButton } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Controls";
import { Dialog } from "@/components/ui/Dialog";
import { DemoBadge, EmptyState, ErrorState, ListSkeleton, Notice } from "@/components/ui/Feedback";
import { FormMessage, SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { useCrews } from "@/features/crews/api";
import { useProfile } from "@/features/profile/api";
import { typicalPriceCents, useActivitySearch, usePlaceRegion } from "@/features/discover/api";
import { CityField } from "@/features/discover/CityField";
import { priceLabel } from "@/features/discover/display";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { centsToInput, parseEuroInput } from "@/lib/format";
import { useDebouncedValue, useDocumentTitle } from "@/lib/hooks";
import { addDays, fromLocalInputValue, nextWeekday, today, toLocalInputValue, zonedParts, zonedToUtc } from "@/lib/time";
import type { Activity } from "@/lib/types";
import { useCreatePoll, type PollOptionInput } from "./api";
import { MAX_POLL_OPTIONS, usePollDraft } from "./draft";

interface OptionRow {
  key: string;
  activityId: string | null;
  title: string;
  price: string;
  ownWhen: boolean;
  date: string;
  time: string;
}

type EndPreset = "twoHours" | "tonight" | "tomorrow" | "custom";

let rowCounter = 0;
const newKey = () => `opt-${++rowCounter}`;

function ActivityPicker({ open, onClose, selectedIds, onToggle }: { open: boolean; onClose: () => void; selectedIds: Set<string>; onToggle: (activity: Activity) => void }) {
  const profile = useProfile();
  const [city, setCity] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [added, setAdded] = useState(0);
  const query = useDebouncedValue(search, 300);
  useEffect(() => {
    if (city === null && profile.data?.city?.trim()) setCity(profile.data.city.trim());
  }, [city, profile.data]);
  const places = usePlaceRegion(open ? city : null);
  useEffect(() => {
    if (places.canonicalName && city && places.canonicalName.toLocaleLowerCase("de") !== city.toLocaleLowerCase("de")) setCity(places.canonicalName);
  }, [places.canonicalName, city]);
  const activities = useActivitySearch(open && city ? { city, query, limit: 50 } : null);
  const list = activities.data?.items ?? [];

  useEffect(() => {
    if (open) setAdded(0);
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} title={t.polls.create.pickerTitle} size="lg" footer={<Button onClick={onClose}>{t.polls.create.pickerDone(added)}</Button>}>
      <div className="mb-4 grid gap-3 sm:grid-cols-[200px_minmax(0,1fr)]">
        <CityField value={city} onCommit={(next) => setCity(next)} />
        <div className="relative">
          <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-faint" aria-hidden />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} disabled={!city} aria-label={t.polls.create.pickerSearch} placeholder={t.polls.create.pickerSearch} className="h-12 w-full rounded-control border border-line bg-surface pl-11 pr-3 text-fg placeholder:text-faint focus:border-lime focus:outline-none disabled:opacity-50" />
        </div>
      </div>
      {places.importing && city && (
        <Notice tone="lime" icon={<IconSpinner className="animate-spin" aria-hidden />} title={t.discover.sync.loading(city)} className="mb-4">
          {t.discover.sync.loadingBody}
        </Notice>
      )}
      {places.syncError && !places.importing && (
        <Notice tone="amber" title={city ? t.discover.sync.failedTitle(city) : undefined} className="mb-4">
          {errorMessage(places.syncError)}
        </Notice>
      )}
      {!city ? (
        <p className="py-6 text-center text-sm text-muted">{t.discover.cityPrompt.body}</p>
      ) : activities.isPending ? (
        <ListSkeleton rows={4} height="h-14" />
      ) : activities.isError ? (
        <ErrorState error={activities.error} onRetry={() => void activities.refetch()} />
      ) : list.length === 0 ? (
        places.importing ? null : <p className="py-6 text-center text-sm text-muted">{t.polls.create.pickerEmpty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((activity) => {
            const selected = selectedIds.has(activity.id);
            return (
              <li key={activity.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setAdded((n) => n + (selected ? -1 : 1));
                    onToggle(activity);
                  }}
                  className="flex min-h-14 w-full items-center gap-3 py-2.5 text-left"
                >
                  <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border", selected ? "border-lime bg-lime text-lime-ink" : "border-line-strong")}>
                    {selected && <IconCheck className="size-3.5" strokeWidth={3} aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-semibold text-fg">{activity.name}</span>
                      {activity.is_demo && <DemoBadge />}
                    </span>
                    <span className="block truncate text-[13px] text-muted">
                      {t.enums.category[activity.category]}
                      {activity.city ? `, ${activity.city}` : ""} – {priceLabel(activity)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}

export function PollCreatePage() {
  useDocumentTitle(t.polls.create.title);
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const crews = useCrews();
  const draft = usePollDraft();
  const createPoll = useCreatePoll();

  const [crewId, setCrewId] = useState(params.get("crew") ?? "");
  const [sharedDate, setSharedDate] = useState(() => nextWeekday("sat", true));
  const [sharedTime, setSharedTime] = useState("19:00");
  const [title, setTitle] = useState("");
  const titleTouched = useRef(false);
  const [options, setOptions] = useState<OptionRow[]>(() =>
    draft.items.map((item) => ({ key: newKey(), activityId: item.activityId, title: item.title, price: centsToInput(item.priceCents), ownWhen: false, date: "", time: "" })),
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
  useEffect(() => {
    if (!titleTouched.current) setTitle(suggestedTitle);
  }, [suggestedTitle]);

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
      return [...rows, { key: newKey(), activityId: activity.id, title: activity.name, price: centsToInput(typicalPriceCents(activity)), ownWhen: false, date: "", time: "" }];
    });
  }
  const patchOption = (key: string, update: Partial<OptionRow>) => setOptions((rows) => rows.map((r) => (r.key === key ? { ...r, ...update } : r)));

  function submit(event: FormEvent) {
    event.preventDefault();
    const next: Record<string, string | null> = {};
    if (!crewId) next.crew = t.validation.required;
    if (title.trim().length < 3) next.title = t.validation.minLength(3);
    if (options.length === 0) next.options = t.polls.create.noOptions;

    const payload: PollOptionInput[] = [];
    for (const row of options) {
      const price = parseEuroInput(row.price);
      if (!row.activityId && row.title.trim() === "") next[`title-${row.key}`] = t.polls.create.optionTitleMissing;
      if (price === undefined) next[`price-${row.key}`] = t.validation.amount;
      const date = row.ownWhen ? row.date : sharedDate;
      const time = row.ownWhen ? row.time : sharedTime;
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

    createPoll.mutate(
      { crewId, title: title.trim(), endsAt, options: payload, description: description.trim() || null, meetingPoint: meetingPoint.trim() || null, budgetCents: budgetCents ?? null, minParticipants: min },
      {
        onSuccess: (pollId) => {
          draft.clear();
          toast.success(t.polls.create.started);
          navigate(`/polls/${pollId}`, { replace: true });
        },
        onError: (error) => setFormError(errorMessage(error)),
      },
    );
  }

  if (crews.isPending) return <ListSkeleton rows={3} />;
  if (crews.isError) return <ErrorState error={crews.error} onRetry={() => void crews.refetch()} />;
  if (crews.data.length === 0) {
    return (
      <>
        <PageHeader title={t.polls.create.title} back={{ to: "/home", label: t.nav.home }} />
        <EmptyState title={t.polls.create.needCrewTitle} body={t.polls.create.needCrewBody} action={<ButtonLink to="/crews?new=1">{t.polls.create.needCrewAction}</ButtonLink>} />
      </>
    );
  }

  return (
    <>
      <PageHeader title={t.polls.create.title} lead={t.polls.create.lead} back={{ to: "/plans", label: t.nav.plans }} />
      <form onSubmit={submit} noValidate className="max-w-2xl">
        <div className="space-y-5">
          {crews.data.length > 1 && (
            <SelectField label={t.polls.create.crew} value={crewId} onChange={(e) => setCrewId(e.target.value)} error={errors.crew}>
              {crews.data.map((crew) => (
                <option key={crew.id} value={crew.id}>
                  {crew.emoji} {crew.name}
                </option>
              ))}
            </SelectField>
          )}
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
        </div>

        <Section title={t.polls.create.whenTitle}>
          <div className="grid grid-cols-2 gap-4">
            <TextField label={t.polls.create.date} name="date" type="date" min={today()} value={sharedDate} onChange={(e) => setSharedDate(e.target.value)} optional />
            <TextField label={t.polls.create.time} name="time" type="time" value={sharedTime} onChange={(e) => setSharedTime(e.target.value)} disabled={!sharedDate} optional />
          </div>
          <p className="mt-2 text-[13px] leading-snug text-muted">{t.polls.create.whenHint}</p>
        </Section>

        <Section title={t.polls.create.optionsTitle}>
          <p className="-mt-1 mb-3 text-[13px] text-muted">{t.polls.create.optionsHint}</p>
          {options.length > 0 && (
            <ul className="mb-3 space-y-3">
              {options.map((row, index) => (
                <li key={row.key} className="rounded-card border border-line bg-surface p-4">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      {row.activityId ? (
                        <p className="flex min-h-11 items-center gap-2 text-[17px] font-bold leading-tight text-fg">
                          <IconPin className="size-4 shrink-0 text-muted" aria-hidden />
                          <span className="min-w-0 break-words">{row.title}</span>
                        </p>
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
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 self-start text-sm text-fg sm:mt-7">
                      <input type="checkbox" checked={row.ownWhen} onChange={(e) => patchOption(row.key, { ownWhen: e.target.checked, date: row.date || sharedDate, time: row.time || sharedTime })} className="size-5 shrink-0 accent-[var(--color-lime)]" />
                      {t.polls.create.ownDate}
                    </label>
                  </div>
                  {row.ownWhen && (
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
          <div className="mt-3 flex flex-wrap gap-2.5">
            <Button variant="secondary" onClick={() => setPickerOpen(true)} disabled={full} icon={<IconPin className="size-4" aria-hidden />}>
              {t.polls.create.addPlace}
            </Button>
            <Button variant="secondary" onClick={() => setOptions((rows) => [...rows, { key: newKey(), activityId: null, title: "", price: "", ownWhen: false, date: "", time: "" }])} disabled={full} icon={<IconPlus className="size-4" aria-hidden />}>
              {t.polls.create.addCustom}
            </Button>
          </div>
        </Section>

        <Section title={t.polls.create.endsTitle}>
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
          {endPreset === "custom" && <TextField fieldClassName="mt-4 max-w-xs" label={t.polls.create.endsCustom} type="datetime-local" value={endCustom} onChange={(e) => setEndCustom(e.target.value)} min={toLocalInputValue(new Date())} />}
          {errors.ends && (
            <p role="alert" className="mt-2 text-[13px] text-danger">
              {errors.ends}
            </p>
          )}
        </Section>

        <Section title={t.polls.create.moreTitle}>
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label={t.polls.create.budget} name="budget" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} error={errors.budget} hint={t.polls.create.budgetHint} trailing={<span className="pr-3 text-muted">€</span>} optional />
              <TextField label={t.polls.create.minParticipants} name="min_participants" inputMode="numeric" value={minParticipants} onChange={(e) => setMinParticipants(e.target.value)} error={errors.min} hint={t.polls.create.minParticipantsHint} optional />
            </div>
            <TextField label={t.polls.create.meetingPoint} name="meeting_point" value={meetingPoint} onChange={(e) => setMeetingPoint(e.target.value)} placeholder={t.polls.create.meetingPointPlaceholder} maxLength={160} optional />
            <TextAreaField label={t.polls.create.description} name="description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={2} optional />
          </div>
        </Section>

        <div className="mt-8 space-y-4">
          {formError && <FormMessage>{formError}</FormMessage>}
          <Button type="submit" size="lg" block loading={createPoll.isPending}>
            {t.polls.create.submit}
          </Button>
        </div>
      </form>

      <ActivityPicker open={pickerOpen} onClose={() => setPickerOpen(false)} selectedIds={selectedActivityIds} onToggle={toggleActivity} />
    </>
  );
}
