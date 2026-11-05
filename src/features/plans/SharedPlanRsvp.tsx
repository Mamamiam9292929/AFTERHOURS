import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { IconPin } from "@/components/icons";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ErrorState, PageSpinner } from "@/components/ui/Feedback";
import { FormMessage, TextField } from "@/components/ui/Field";
import { AuthLayout } from "@/features/auth/AuthLayout";
import { rememberedGuestName, rememberGuestName } from "@/features/polls/api";
import { loadTexts, t } from "@/i18n";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { NoteEditor } from "./AnswerNote";
import { type GuestAnswer, planGuestSecret, useGuestNote, useGuestRsvp, useGuestWaitlist, useSharedPlanRsvp } from "./guestsApi";

// F7: Texte der Zusagen ohne Konto liegen nicht im Start-Bundle.
await loadTexts("planGuests");

const ANSWERS: GuestAnswer[] = ["going", "maybe", "declined"];
/** P26 Etappe 3b: Bei voller Runde wird „Bin dabei“ zu „Nachrücken“ – wie auf der Planseite der Crew. */
type Choice = GuestAnswer | "waitlist";
/** Antwortfarben wie auf den Abstimm-Karten (`.vote-card[data-answer]`, `.vote-pill[data-response]`). */
const CARD_ANSWER: Record<Choice, "yes" | "maybe" | "no"> = { going: "yes", maybe: "maybe", declined: "no", waitlist: "maybe" };

const linkClass = "font-semibold text-fg underline decoration-line-strong underline-offset-4 hover:decoration-lime";
const clean = (name: string) => name.trim().replace(/\s+/g, " ");

/**
 * W10 · Zusagen ohne Konto unter dem geteilten Plan (/s/<token>), wenn die Crew es erlaubt: wohin es geht, dann
 * „Bin dabei / Vielleicht / Kann nicht“ mit Namen. Wer den Namen vom letzten Link mitbringt (S2) oder hier schon
 * geantwortet hat, antwortet mit einem Tipp. Danach der Weg zum eigenen Konto.
 */
export function SharedPlanRsvp({
  token,
  hero,
  signedIn,
  fallback,
  full = false,
}: {
  token: string;
  hero: ReactNode;
  signedIn: boolean;
  fallback: ReactNode;
  /** P26 Etappe 2: Höchstzahl erreicht (laut Vorschau) – „Bin dabei“ ist dann zu, außer für die, die schon dabei sind. */
  full?: boolean;
}) {
  const secret = useMemo(() => planGuestSecret(token), [token]);
  const rsvp = useSharedPlanRsvp(token, secret);
  const answer = useGuestRsvp(token, secret);
  const note = useGuestNote(token, secret);
  const waitlist = useGuestWaitlist(token, secret);
  const [deviceName, setDeviceName] = useState(() => rememberedGuestName());
  const [name, setName] = useState(() => deviceName ?? "");
  const [editingName, setEditingName] = useState(false);
  const [chosen, setChosen] = useState<Choice | null>(null);
  const [errors, setErrors] = useState<{ name?: string | null; answer?: string | null }>({});
  const [saved, setSaved] = useState<"saved" | "withdrawn" | "waitlist" | "left" | null>(null);
  const loaded = rsvp.data?.status === "valid" ? rsvp.data : null;
  const me = loaded?.me ?? null;
  // Antworten nacheinander senden, damit schnelles Tippen nichts überholt.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (initialized || !loaded) return;
    setInitialized(true);
    if (me) {
      setChosen(me.waitlist ? "waitlist" : me.status);
      setName(me.name);
    }
  }, [initialized, loaded, me]);

  if (rsvp.isPending) return <PageSpinner />;
  if (rsvp.isError) {
    return (
      <AuthLayout hero={hero} title={t.planGuests.rsvp.title}>
        <ErrorState error={rsvp.error} onRetry={() => void rsvp.refetch()} />
      </AuthLayout>
    );
  }
  // Inzwischen ausgeschaltet (oder der Link ist weg): wie ohne Freigabe.
  if (!loaded) return <>{fallback}</>;

  const knownName = me?.name ?? deviceName;
  const oneTap = Boolean(knownName) && !editingName;
  const open = loaded.plan.open;
  const where = [loaded.plan.place, loaded.plan.address].filter(Boolean).join(" · ");
  // P26 Etappe 2: Ist die Runde voll, bleibt „Bin dabei“ zu – wer schon zugesagt hat, behält den Platz.
  const goingClosed = full && me?.status !== "going";
  const fullError = answer.isError && (answer.error as { code?: string; message?: string }).message === "plan_full";
  // P26 Etappe 3b: Fehler der letzten Aktion – Antwort oder Nachrückliste.
  const failed = answer.isError ? answer.error : waitlist.isError ? waitlist.error : null;
  const pending = answer.isPending || waitlist.isPending;
  const position = me?.waitlist ?? null;

  /** Antwort, „Nachrücken“ oder – wer auf der Liste steht und „Vielleicht“ tippt – von der Liste gehen. */
  function request(choice: Choice | null, guestName: string | null): Promise<"saved" | "withdrawn" | "waitlist" | "left"> {
    if (choice === "waitlist") return waitlist.mutateAsync({ name: guestName, join: true }).then(() => "waitlist" as const);
    if (choice === "maybe" && position != null && (!guestName || guestName === me?.name)) {
      return waitlist.mutateAsync({ name: null, join: false }).then(() => "left" as const);
    }
    return answer.mutateAsync({ name: guestName, status: choice }).then(() => (choice ? ("saved" as const) : ("withdrawn" as const)));
  }

  /** `revert`: bei einem Fehler die vorige Antwort wieder zeigen (Ein-Tipp); im Formular bleibt die Auswahl stehen. */
  function send(status: Choice | null, guestName: string | null, revert?: { to: Choice | null }) {
    setSaved(null);
    answer.reset();
    waitlist.reset();
    queue.current = queue.current.then(() =>
      request(status, guestName)
        .then((result) => {
          setSaved(result);
          if (guestName) {
            rememberGuestName(guestName);
            setDeviceName(guestName);
          }
          setEditingName(false);
        })
        .catch(() => {
          if (revert) setChosen(revert.to);
        }),
    );
  }

  function tap(next: Choice) {
    setErrors({});
    const previous = chosen;
    setChosen(next);
    if (oneTap && knownName) send(next, knownName, { to: previous });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const next = {
      name: clean(name).length < 2 ? t.planGuests.rsvp.nameMissing : null,
      answer: chosen ? null : t.planGuests.rsvp.noAnswer,
    };
    setErrors(next);
    if (next.name || next.answer || !chosen) return;
    send(chosen, clean(name));
  }

  return (
    <AuthLayout
      hero={hero}
      title={!open ? t.planGuests.rsvp.closedTitle : me ? t.planGuests.rsvp.changeTitle(me.name) : t.planGuests.rsvp.title}
      intro={!open ? t.planGuests.rsvp.closedIntro : me ? t.planGuests.rsvp.changeIntro : t.planGuests.rsvp.intro}
    >
      {(where || loaded.plan.meeting_point) && (
        <div className="vote-card mb-5 flex gap-3 p-4" data-testid="rsvp-where">
          <IconPin className="mt-0.5 size-5 shrink-0 text-lime" aria-hidden />
          <div className="min-w-0 text-[15px] leading-snug">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">{t.planGuests.rsvp.where}</p>
            {where && <p className="mt-1 break-words font-semibold text-fg">{where}</p>}
            {loaded.plan.meeting_point && (
              <p className="mt-1 break-words text-muted">
                {t.planGuests.rsvp.meetingPoint}: <span className="text-fg">{loaded.plan.meeting_point}</span>
              </p>
            )}
          </div>
        </div>
      )}

      <form onSubmit={submit} noValidate className="space-y-5">
        <div className="vote-card p-4 sm:p-5" data-answer={chosen ? CARD_ANSWER[chosen] : undefined} data-testid="rsvp-card">
          <p className="display text-[17px] uppercase text-fg">{t.planGuests.rsvp.question}</p>
          <p className="mt-1 text-sm text-muted">{t.planGuests.rsvp.counts(loaded.counts.going, loaded.counts.maybe)}</p>
          {open ? (
            <div role="radiogroup" aria-label={t.planGuests.rsvp.question} aria-describedby={errors.answer ? "rsvp-answer-error" : undefined} className="mt-3 grid grid-cols-3 gap-2">
              {ANSWERS.map((answerValue) => {
                // P26 Etappe 3b: Runde voll – statt „Bin dabei“ in die Reihe (wer schon dabei ist, behält den Platz).
                const value: Choice = answerValue === "going" && goingClosed ? "waitlist" : answerValue;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={chosen === value}
                    aria-label={value === "waitlist" ? t.plans.detail.attendance.waitlistLabel : undefined}
                    data-response={CARD_ANSWER[value]}
                    data-testid={value === "waitlist" ? "rsvp-waitlist" : undefined}
                    disabled={(pending && oneTap) || (value === "waitlist" && position != null)}
                    onClick={() => tap(value)}
                    className="vote-pill"
                  >
                    {value === "waitlist" ? t.plans.detail.attendance.waitlist : t.plans.detail.attendance[value]}
                  </button>
                );
              })}
            </div>
          ) : (
            me && (
              <p className="mt-2 text-sm text-muted">
                {t.planGuests.rsvp.yourAnswer}: <span className="font-semibold text-fg">{t.plans.detail.attendance[me.status]}</span>
              </p>
            )
          )}
          {/* P26 Etappe 3b: Platz auf der Nachrückliste bzw. nachgerückt. Ohne Konto gibt es keine Nachricht – das steht da. */}
          {open && position != null && (
            <div className="mt-3 rounded-[16px] border border-white/15 bg-black/25 p-3" data-testid="rsvp-waitlist-mine" aria-live="polite">
              <p className="text-sm font-bold text-fg">{t.planGuests.rsvp.waitlist.position(position)}</p>
              <p className="mt-0.5 text-[13px] leading-snug text-muted">{t.planGuests.rsvp.waitlist.body}</p>
              <button
                type="button"
                data-testid="rsvp-waitlist-leave"
                onClick={() => {
                  const previous = chosen;
                  setChosen("maybe");
                  send("maybe", null, { to: previous });
                }}
                className={cn("mt-1 min-h-11 text-sm font-semibold text-muted underline-offset-4 hover:text-fg hover:underline", pending && "pointer-events-none opacity-60")}
              >
                {t.planGuests.rsvp.waitlist.leave}
              </button>
            </div>
          )}
          {open && me?.promoted && (
            <p className="mt-3 rounded-[16px] border border-lime/40 bg-lime/10 p-3 text-sm font-semibold leading-snug text-fg" data-testid="rsvp-promoted">
              {t.planGuests.rsvp.waitlist.promoted}
            </p>
          )}
          {open && goingClosed && position == null && (
            <p className="mt-3 text-sm leading-snug text-muted" data-testid="rsvp-full">
              {t.planGuests.rsvp.full}
            </p>
          )}
          {errors.answer && (
            <p id="rsvp-answer-error" role="alert" className="mt-2 text-sm text-danger">
              {errors.answer}
            </p>
          )}
          {/* P24 Etappe 2: Zusatz zur gespeicherten Antwort („komme später“) – erst, wenn sie beim Server ist. */}
          {open && me && chosen === me.status && !pending && (
            <NoteEditor key={me.status} answer={me.status} note={me.note ?? null} pending={note.isPending} save={(value, callbacks) => note.mutate(value, callbacks)} />
          )}
        </div>

        {open && oneTap && knownName && (
          <div className="space-y-3" data-testid="rsvp-one-tap">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-[28px] border border-white/15 bg-white/[0.06] py-1.5 pl-5 pr-3">
              <p className="text-[15px] text-muted">
                {t.planGuests.rsvp.answeringAs} <span className="font-bold text-fg">{knownName}</span>
              </p>
              <button
                type="button"
                onClick={() => {
                  setName(knownName);
                  setEditingName(true);
                  setSaved(null);
                }}
                className="min-h-11 text-sm font-semibold text-muted underline-offset-4 hover:text-fg hover:underline"
              >
                {t.planGuests.rsvp.notMe(knownName)}
              </button>
            </div>
            {!me && <p className="text-[13px] leading-snug text-faint">{t.planGuests.rsvp.tapHint}</p>}
          </div>
        )}

        {open && !oneTap && (
          <>
            <TextField
              label={t.planGuests.rsvp.name}
              name="guest_name"
              autoComplete="given-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setSaved(null);
                setErrors((prev) => ({ ...prev, name: null }));
              }}
              maxLength={40}
              hint={t.planGuests.rsvp.nameHint}
              error={errors.name}
              required
            />
            <Button type="submit" size="lg" block loading={pending}>
              {me ? t.planGuests.rsvp.update : t.planGuests.rsvp.submit}
            </Button>
          </>
        )}

        <div aria-live="polite" className="space-y-2">
          {failed && <FormMessage>{fullError ? t.planGuests.rsvp.full : errorMessage(failed)}</FormMessage>}
          {pending ? (
            <p className="text-sm text-muted">{t.planGuests.rsvp.saving}</p>
          ) : (
            saved && (
              <FormMessage tone="success">
                {saved === "saved" ? t.planGuests.rsvp.saved : saved === "withdrawn" ? t.planGuests.rsvp.withdrawn : saved === "waitlist" ? t.planGuests.rsvp.waitlist.joined : t.planGuests.rsvp.waitlist.left}
              </FormMessage>
            )
          )}
        </div>

        {open && me && (
          <button
            type="button"
            data-testid="rsvp-withdraw"
            onClick={() => {
              const previous = chosen;
              setChosen(null);
              send(null, null, { to: previous });
            }}
            className={cn("min-h-11 text-sm font-semibold text-muted underline-offset-4 hover:text-fg hover:underline", pending && "pointer-events-none opacity-60")}
          >
            {t.planGuests.rsvp.withdraw}
          </button>
        )}
        {open && <p className="text-[13px] leading-snug text-faint">{t.planGuests.rsvp.privacy}</p>}
      </form>

      {!signedIn && (me || !open) && (
        <div className="vote-card mt-8 p-5 sm:p-6" data-testid="rsvp-cta">
          <p className="text-[17px] font-bold text-fg">{t.planGuests.rsvp.ctaTitle}</p>
          <p className="mt-1.5 text-[15px] leading-snug text-muted">{t.planGuests.rsvp.ctaBody}</p>
          <ButtonLink to="/register" variant="secondary" block className="mt-4">
            {t.plans.shared.register}
          </ButtonLink>
          <p className="mt-3 text-sm text-muted">
            {t.plans.shared.hasAccount}{" "}
            <Link to="/login" className={linkClass}>
              {t.plans.shared.toLogin}
            </Link>
          </p>
        </div>
      )}
    </AuthLayout>
  );
}
