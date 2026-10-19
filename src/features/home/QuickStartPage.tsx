import { useMemo, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { IconCheck, IconClose, IconPlus, IconSearch, IconShare, IconSpinner, IconVote } from "@/components/icons";
import { PosterTitle } from "@/components/layout/Page";
import { Button, ButtonLink, IconButton } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Controls";
import { DemoBadge, ErrorState, ListSkeleton, Notice } from "@/components/ui/Feedback";
import { FormMessage, TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { useCreateCrew, useCreateInvitation, useCrews, type CreatedInvitation } from "@/features/crews/api";
import { CrewForm } from "@/features/crews/CrewForm";
import { CategoryArt } from "@/features/discover/CategoryArt";
import { CityField } from "@/features/discover/CityField";
import { typicalPriceCents } from "@/features/discover/api";
import { rememberedCity } from "@/features/discover/rememberedCity";
import { priceLabel } from "@/features/discover/display";
import { ActivityPicker } from "@/features/polls/ActivityPicker";
import { useCreatePoll, type PollOptionInput } from "@/features/polls/api";
import { MAX_POLL_OPTIONS } from "@/features/polls/draft";
import { useProfile, useUpdateProfile } from "@/features/profile/api";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { useDocumentTitle } from "@/lib/hooks";
import { shareOrCopy } from "@/lib/share";
import { siteUrl } from "@/lib/supabase";
import { addDays, formatDateShort, formatDateTime, nextWeekday, zonedParts, zonedToUtc } from "@/lib/time";
import type { Activity, Crew, Weekday } from "@/lib/types";
import { useIdeas } from "./ideas";

/*
 * W5 · Erster Plan in 60 Sekunden. Drei Schritte auf einer Seite, der Stand steht in der Adresse
 * (/start → /start?crew=<id> → /start?crew=<id>&step=poll), damit Neuladen und Zurück funktionieren:
 *   1. Crew gründen  2. Einladungslink teilen (überspringbar)  3. Abstimmung mit bis zu drei echten Orten
 *      aus der eigenen Stadt – nur Orte aus der Datenbank, nichts erfunden. Dazu eigene Vorschläge als Text
 *      und weitere Orte aus der Suche (Etappe 2); ohne Stadt im Profil gilt die zuletzt in Discover gewählte.
 * Geschrieben wird ausschließlich über die bestehenden RPCs (create_crew, create_crew_invitation, create_poll).
 */

const TOTAL = 3;
const INVITE_HOURS = 168;
const INVITE_USES = 20;

function Progress({ step }: { step: number }) {
  return (
    <div className="mb-6 flex items-center gap-3">
      <div className="flex gap-1.5" aria-hidden>
        {Array.from({ length: TOTAL }, (_, i) => (
          <span key={i} className={cn("h-1.5 w-8 rounded-full transition-colors duration-300", i < step ? "bg-lime" : "bg-line-strong")} />
        ))}
      </div>
      <p className="text-[13px] font-semibold uppercase tracking-wide text-muted">{t.home.quickStart.step(step, TOTAL)}</p>
    </div>
  );
}

function Header({ step, title, body }: { step: number; title: string; body: string }) {
  return (
    <header className="mb-7">
      <Progress step={step} />
      <h1 className="display chrome break-words text-[32px] uppercase leading-[0.95] sm:text-[46px]">
        <PosterTitle text={title} />
      </h1>
      <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">{body}</p>
    </header>
  );
}

function CrewStep({ hasCrews }: { hasCrews: boolean }) {
  const create = useCreateCrew();
  const toast = useToast();
  const [, setParams] = useSearchParams();
  return (
    <>
      <Header step={1} title={t.home.quickStart.crew.title} body={t.home.quickStart.crew.body} />
      <div className="max-w-xl">
        <CrewForm
          submitLabel={t.home.quickStart.crew.submit}
          pending={create.isPending}
          error={create.isError ? errorMessage(create.error) : null}
          onSubmit={(values) =>
            create.mutate(values, {
              onSuccess: (crewId) => {
                toast.success(t.home.quickStart.crew.created(values.name));
                setParams({ crew: crewId }, { replace: true });
              },
            })
          }
        />
        {hasCrews && (
          <Notice className="mt-6">
            {t.home.quickStart.crew.haveCrew}{" "}
            <Link to="/polls/new" className="font-semibold text-fg underline decoration-line-strong underline-offset-4 hover:decoration-lime">
              {t.home.quickStart.crew.haveCrewAction}
            </Link>
          </Notice>
        )}
      </div>
    </>
  );
}

function InviteStep({ crew }: { crew: Crew }) {
  const toast = useToast();
  const [, setParams] = useSearchParams();
  const create = useCreateInvitation(crew.id);
  const [invitation, setInvitation] = useState<CreatedInvitation | null>(null);
  const [shared, setShared] = useState(false);
  const link = invitation ? `${siteUrl()}/join/${invitation.token}` : "";

  async function share(target: CreatedInvitation) {
    const outcome = await shareOrCopy({ title: "AFTERHOURS", text: t.crews.invite.shareText(crew.name), url: `${siteUrl()}/join/${target.token}` });
    if (outcome === "copied") toast.success(t.home.quickStart.invite.copied);
    if (outcome === "failed") toast.error(t.home.quickStart.invite.failed);
    if (outcome === "shared" || outcome === "copied") setShared(true);
  }

  function shareLink() {
    // Der Link wird genau einmal erzeugt (gespeichert ist nur sein Hash) und danach wiederverwendet.
    if (invitation) return void share(invitation);
    create.mutate(
      { expiresInHours: INVITE_HOURS, maxUses: INVITE_USES },
      {
        onSuccess: (created) => {
          setInvitation(created);
          void share(created);
        },
      },
    );
  }

  const next = () => setParams({ crew: crew.id, step: "poll" }, { replace: true });

  return (
    <>
      <Header step={2} title={t.home.quickStart.invite.title} body={t.home.quickStart.invite.body} />
      <div className="max-w-xl space-y-4">
        <p className="flex items-center gap-2.5 text-[15px] font-semibold text-fg">
          <span className="flex size-9 items-center justify-center rounded-full bg-raised text-lg" aria-hidden>
            {crew.emoji}
          </span>
          {crew.name}
        </p>
        <Button size="lg" block variant={shared ? "secondary" : "primary"} loading={create.isPending} onClick={shareLink} icon={<IconShare className="size-5" aria-hidden />}>
          {invitation ? t.home.quickStart.invite.shareAgain : t.home.quickStart.invite.share}
        </Button>
        {create.isError && <FormMessage>{errorMessage(create.error)}</FormMessage>}
        {invitation && (
          <div>
            <TextField label={t.home.quickStart.invite.linkLabel} name="invite_link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="font-mono text-[13px]" />
            <p className="mt-2 text-[13px] leading-snug text-faint">{t.home.quickStart.invite.linkNote}</p>
          </div>
        )}
        <div className="pt-2">
          {shared ? (
            <Button size="lg" block onClick={next} icon={<IconVote className="size-5" aria-hidden />}>
              {t.home.quickStart.invite.next}
            </Button>
          ) : (
            <Button variant="ghost" block onClick={next}>
              {t.home.quickStart.invite.skip}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

interface DateChoice {
  date: string;
  weekday: Weekday;
}

/** Nächster Freitag und Samstag, die noch mindestens drei Stunden entfernt sind (um 19 Uhr). */
function dateChoices(time: string): DateChoice[] {
  const soon = Date.now() + 3 * 3600_000;
  return (["fri", "sat"] as const)
    .map((weekday) => {
      let date = nextWeekday(weekday, true);
      const at = zonedToUtc(date, time);
      if (!at || at.getTime() < soon) date = addDays(date, 7);
      return { date, weekday };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Abstimmen bis zum Vorabend um 20 Uhr – mindestens zwei Stunden, aber spätestens eine Stunde vor Beginn. */
function deadlineFor(date: string, time: string): Date | null {
  const start = zonedToUtc(date, time);
  const eve = zonedToUtc(addDays(date, -1), "20:00");
  if (!start || !eve) return null;
  const soonest = Date.now() + 2 * 3600_000;
  const ends = eve.getTime() >= soonest ? eve.getTime() : Math.min(soonest, start.getTime() - 3600_000);
  return ends > Date.now() + 10 * 60_000 ? new Date(ends) : null;
}

/** Ein zusätzlicher Vorschlag: ein Ort aus der Suche oder ein freier Text („Grillen bei Bob“). */
type Extra = { key: string; kind: "place"; activity: Activity } | { key: string; kind: "own"; title: string };

function ExtraRow({ extra, onRemove }: { extra: Extra; onRemove: () => void }) {
  const title = extra.kind === "place" ? extra.activity.name : extra.title;
  return (
    <li className="flex items-center gap-3 overflow-hidden rounded-card border border-lime/60 bg-surface p-2 pr-1.5">
      <span className="relative flex h-16 w-20 shrink-0 items-center justify-center overflow-hidden rounded-control">
        {extra.kind === "place" ? (
          <CategoryArt category={extra.activity.category} />
        ) : (
          <span className="display flex size-full items-center justify-center rounded-control border border-dashed border-lime/50 bg-raised text-3xl uppercase text-lime" aria-hidden>
            {title.slice(0, 1)}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-semibold text-fg">{title}</span>
          {extra.kind === "place" && extra.activity.is_demo && <DemoBadge />}
        </span>
        <span className="mt-0.5 block truncate text-[13px] text-muted">
          {extra.kind === "place" ? `${t.enums.category[extra.activity.category]} · ${priceLabel(extra.activity)}` : t.home.quickStart.poll.own.ownTag}
        </span>
      </span>
      <IconButton label={t.home.quickStart.poll.own.remove(title)} onClick={onRemove}>
        <IconClose className="size-5" aria-hidden />
      </IconButton>
    </li>
  );
}

let extraCounter = 0;

function PollStep({ crew }: { crew: Crew }) {
  const navigate = useNavigate();
  const toast = useToast();
  const createPoll = useCreatePoll();
  const updateProfile = useUpdateProfile();
  const profile = useProfile();
  const discoverCity = useMemo(rememberedCity, []);
  const { ideas, isPending, city, importing } = useIdeas(discoverCity);
  const cityFromDiscover = Boolean(city && profile.data && !profile.data.city?.trim());
  const [time, setTime] = useState("19:00");
  const choices = useMemo(() => dateChoices(time), [time]);
  const [date, setDate] = useState(() => choices[choices.length - 1]?.date ?? "");
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  const [extras, setExtras] = useState<Extra[]>([]);
  const [ownText, setOwnText] = useState("");
  const [ownError, setOwnError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const weekday = choices.find((c) => c.date === date)?.weekday ?? zonedParts(zonedToUtc(date, "12:00") ?? new Date()).weekday;
  const title = t.polls.create.defaultTitle(t.weekdays[weekday]);
  const suggestions = ideas?.activities ?? [];
  const selected = suggestions.filter(({ activity }) => !removed.has(activity.id));
  const total = selected.length + extras.length;
  const full = total >= MAX_POLL_OPTIONS;
  const deadline = deadlineFor(date, time);
  const ideaIds = new Set(suggestions.map(({ activity }) => activity.id));
  const pickedIds = new Set([...selected.map(({ activity }) => activity.id), ...extras.flatMap((e) => (e.kind === "place" ? [e.activity.id] : []))]);

  // Aus der Suche: Vorschläge von oben werden an- bzw. abgewählt, alles andere kommt unten dazu.
  function togglePicked(activity: Activity) {
    if (ideaIds.has(activity.id)) return toggle(activity.id);
    setExtras((current) => {
      if (current.some((e) => e.kind === "place" && e.activity.id === activity.id)) return current.filter((e) => !(e.kind === "place" && e.activity.id === activity.id));
      if (selected.length + current.length >= MAX_POLL_OPTIONS) return current;
      return [...current, { key: `x${++extraCounter}`, kind: "place", activity }];
    });
  }

  function addOwn(event: FormEvent) {
    event.preventDefault();
    const title = ownText.replace(/\s+/g, " ").trim();
    if (title.length < 2) return setOwnError(t.home.quickStart.poll.own.tooShort);
    const taken = [...selected.map(({ activity }) => activity.name), ...extras.map((e) => (e.kind === "place" ? e.activity.name : e.title))];
    if (taken.some((name) => name.toLocaleLowerCase("de") === title.toLocaleLowerCase("de"))) return setOwnError(t.home.quickStart.poll.own.duplicate);
    if (full) return setOwnError(t.home.quickStart.poll.own.full(MAX_POLL_OPTIONS));
    setExtras((current) => [...current, { key: `x${++extraCounter}`, kind: "own", title }]);
    setOwnText("");
    setOwnError(null);
    setError(null);
  }

  function toggle(id: string) {
    setRemoved((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        if (full) return current;
        next.delete(id);
      } else next.add(id);
      return next;
    });
  }

  function start() {
    setError(null);
    if (total === 0) return setError(t.home.quickStart.poll.pickOne);
    if (!deadline) return setError(t.validation.dateInPast);
    createPoll.mutate(
      {
        crewId: crew.id,
        title,
        endsAt: deadline,
        options: [...selected.map(({ activity }) => activity), ...extras.map((e) => (e.kind === "place" ? e.activity : e.title))].map(
          (option): PollOptionInput =>
            typeof option === "string"
              ? { activity_id: null, title: option, proposed_date: date, proposed_time: time, estimated_price_cents: null }
              : { activity_id: option.id, title: option.name, proposed_date: date, proposed_time: time, estimated_price_cents: typicalPriceCents(option) },
        ),
      },
      {
        onSuccess: (pollId) => {
          toast.success(t.polls.create.started);
          navigate(`/polls/${pollId}`, { replace: true });
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  }

  return (
    <>
      <Header step={3} title={t.home.quickStart.poll.title(t.weekdays[weekday])} body={t.home.quickStart.poll.body} />
      <div className="max-w-2xl space-y-7">
        <section aria-labelledby="qs-when">
          <h2 id="qs-when" className="mb-3 text-sm font-semibold text-fg">
            {t.home.quickStart.poll.when}
          </h2>
          <div className="flex flex-wrap items-end gap-2">
            {choices.map((choice) => (
              <Chip key={choice.date} selected={choice.date === date} onToggle={() => setDate(choice.date)}>
                {formatDateShort(zonedToUtc(choice.date, "12:00") ?? new Date())}
              </Chip>
            ))}
            <TextField label={t.home.quickStart.poll.time} name="qs_time" type="time" value={time} onChange={(e) => setTime(e.target.value || "19:00")} fieldClassName="w-32" className="h-10" />
          </div>
          {deadline && <p className="mt-2 text-[13px] text-faint">{t.home.quickStart.poll.deadline(formatDateTime(deadline))}</p>}
        </section>

        <section aria-labelledby="qs-ideas">
          <h2 id="qs-ideas" className="mb-1 text-sm font-semibold text-fg">
            {t.home.quickStart.poll.ideas}
          </h2>
          {!city ? (
            <div className="mt-3 space-y-3">
              <p className="text-sm text-muted">{t.home.quickStart.poll.noCity}</p>
              <CityField value={null} onCommit={(next) => updateProfile.mutate({ city: next })} className="max-w-xs" />
              {updateProfile.isError && <FormMessage>{errorMessage(updateProfile.error)}</FormMessage>}
            </div>
          ) : importing ? (
            <Notice tone="lime" icon={<IconSpinner className="animate-spin" aria-hidden />} title={t.discover.sync.loading(city)} className="mt-3">
              {t.discover.sync.loadingBody}
            </Notice>
          ) : isPending ? (
            <div className="mt-3">
              <ListSkeleton rows={3} height="h-20" />
            </div>
          ) : suggestions.length === 0 ? (
            <Notice className="mt-3">{t.home.quickStart.poll.none}</Notice>
          ) : (
            <>
              <p className="mb-3 text-[13px] text-muted first-letter:uppercase">{ideas?.reasons.join(", ")}</p>
              {cityFromDiscover && city && <p className="-mt-1.5 mb-3 text-[13px] text-faint">{t.home.quickStart.poll.fromDiscover(city)}</p>}
              <ul className="space-y-2.5">
                {suggestions.map(({ activity }) => {
                  const on = !removed.has(activity.id);
                  return (
                    <li key={activity.id}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggle(activity.id)}
                        className={cn(
                          "flex w-full items-center gap-3 overflow-hidden rounded-card border p-2 pr-4 text-left transition-[border-color,background-color,opacity] duration-200",
                          on ? "border-lime/60 bg-surface" : "border-line bg-transparent opacity-60 hover:opacity-80",
                        )}
                      >
                        <span className="relative h-16 w-20 shrink-0 overflow-hidden rounded-control">
                          <CategoryArt category={activity.category} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate font-semibold text-fg">{activity.name}</span>
                            {activity.is_demo && <DemoBadge />}
                          </span>
                          <span className="mt-0.5 block truncate text-[13px] text-muted">
                            {t.enums.category[activity.category]} · {priceLabel(activity)}
                          </span>
                        </span>
                        <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full border", on ? "border-lime bg-lime text-lime-ink" : "border-line-strong")} aria-hidden>
                          {on && <IconCheck className="size-4" strokeWidth={3} />}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>

        <section aria-labelledby="qs-own">
          <h2 id="qs-own" className="mb-1 text-sm font-semibold text-fg">
            {t.home.quickStart.poll.own.title}
          </h2>
          <p className="mb-3 text-[13px] text-muted">{t.home.quickStart.poll.own.body}</p>
          {extras.length > 0 && (
            <ul className="mb-3 space-y-2.5">
              {extras.map((extra) => (
                <ExtraRow key={extra.key} extra={extra} onRemove={() => setExtras((current) => current.filter((e) => e.key !== extra.key))} />
              ))}
            </ul>
          )}
          <form onSubmit={addOwn} noValidate className="flex items-start gap-2">
            <TextField
              label={t.home.quickStart.poll.own.label}
              name="qs_own"
              value={ownText}
              maxLength={80}
              autoComplete="off"
              placeholder={t.home.quickStart.poll.own.placeholder}
              onChange={(e) => {
                setOwnText(e.target.value);
                if (ownError) setOwnError(null);
              }}
              error={ownError}
              fieldClassName="min-w-0 flex-1"
            />
            <Button type="submit" variant="secondary" className="mt-[26px] h-12 shrink-0" disabled={full} icon={<IconPlus className="size-5" aria-hidden />}>
              {t.home.quickStart.poll.own.add}
            </Button>
          </form>
          <Button variant="ghost" size="sm" className="-ml-3 mt-2" disabled={full} onClick={() => setPickerOpen(true)} icon={<IconSearch className="size-4" aria-hidden />}>
            {t.home.quickStart.poll.own.search}
          </Button>
          {full && <p className="mt-2 text-[13px] text-faint">{t.home.quickStart.poll.own.full(MAX_POLL_OPTIONS)}</p>}
          <ActivityPicker open={pickerOpen} onClose={() => setPickerOpen(false)} selectedIds={pickedIds} onToggle={togglePicked} initialCity={city} />
        </section>

        {error && <FormMessage>{error}</FormMessage>}
        <Button size="lg" block onClick={start} loading={createPoll.isPending} disabled={total === 0} icon={<IconVote className="size-5" aria-hidden />}>
          {t.home.quickStart.poll.submit(total)}
        </Button>
      </div>
    </>
  );
}

export function QuickStartPage() {
  useDocumentTitle(t.home.quickStart.documentTitle);
  const [params] = useSearchParams();
  const crews = useCrews();
  const crewId = params.get("crew");

  if (crews.isPending) return <ListSkeleton rows={3} />;
  if (crews.isError) return <ErrorState error={crews.error} onRetry={() => void crews.refetch()} />;
  const crew = crewId ? crews.data.find((c) => c.id === crewId) : undefined;
  // Unbekannte oder fremde Crew in der Adresse: von vorn.
  if (crewId && !crew) return crews.isFetching ? <ListSkeleton rows={3} /> : <Navigate to="/start" replace />;

  return (
    <div className="relative isolate pb-6">
      <div className="home-glow" aria-hidden />
      {!crew ? <CrewStep hasCrews={crews.data.length > 0} /> : params.get("step") === "poll" ? <PollStep crew={crew} /> : <InviteStep crew={crew} />}
      <div className="mt-8 max-w-xl">
        <ButtonLink to="/home" variant="ghost" size="sm" className="-ml-3 text-muted">
          {t.home.quickStart.later}
        </ButtonLink>
      </div>
    </div>
  );
}
