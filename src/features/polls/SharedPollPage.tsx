import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { IconVote } from "@/components/icons";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ErrorState, PageSpinner } from "@/components/ui/Feedback";
import { FormMessage, TextField } from "@/components/ui/Field";
import { GLASS_PILL, LivePill } from "@/components/ui/Pill";
import { AuthLayout } from "@/features/auth/AuthLayout";
import { useAuth } from "@/features/auth/AuthProvider";
import { clearNext, rememberNext } from "@/features/auth/next";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { useDocumentTitle, useNow } from "@/lib/hooks";
import { errorMessage } from "@/lib/errors";
import { formatDateTime, formatPlainDate, formatPlainTime, formatRelative } from "@/lib/time";
import type { VoteResponse } from "@/lib/types";
import { type BallotOption, guestSecret, rememberedGuestName, rememberGuestName, type SharedPollPreview, useGuestJoin, useGuestVote, useSharedPollBallot, useSharedPollPreview } from "./api";

type Valid = Extract<SharedPollPreview, { status: "valid" }>;

const linkClass = "font-semibold text-fg underline decoration-line-strong underline-offset-4 hover:decoration-lime";

/**
 * W2 Etappe 2 · Geteilte Abstimmung: Ziel des Links aus dem Gruppenchat (/v/<token>). Crew-Mitglieder
 * springen direkt zur Abstimmung. Alle anderen sehen die Karte – Frage, Frist, wie viele Vorschläge und
 * wie viele schon abgestimmt haben – und den Weg in die App. Dieselben Angaben stehen in der
 * Messenger-Vorschau (api/share.js). Was zur Wahl steht, sieht nur die Crew – es sei denn, die Crew hat
 * „Gäste dürfen mitstimmen“ eingeschaltet (W3): Dann steht hier der Stimmzettel für Gäste ohne Konto.
 */
export function SharedPollPage() {
  const { token } = useParams();
  const { loading, user } = useAuth();
  // Erst fragen, wenn die Sitzung feststeht: Mitglieder bekommen die ID nur mit Anmeldung.
  const preview = useSharedPollPreview(token, user?.id ?? null, !loading);
  const data = preview.data;

  useDocumentTitle(data?.status === "valid" ? t.polls.shared.pageTitle(data.poll.title) : t.polls.shared.kicker);

  // Wer sich von hier aus registriert oder anmeldet, kommt danach wieder auf diese Karte.
  useEffect(() => {
    if (!token || !data || user) return;
    if (data.status === "valid") rememberNext(`/v/${token}`);
    else clearNext();
  }, [token, data, user]);

  if (loading || preview.isPending) return <PageSpinner />;
  if (preview.isError) {
    return (
      <AuthLayout title={t.polls.shared.kicker}>
        <ErrorState error={preview.error} onRetry={() => void preview.refetch()} />
      </AuthLayout>
    );
  }

  const result = preview.data;
  if (result.status !== "valid") {
    const copy = t.polls.shared.status[result.status];
    return (
      <AuthLayout title={copy.title} intro={copy.body}>
        <ButtonLink to={user ? "/home" : "/login"} size="lg" block variant="secondary">
          {t.polls.shared.toStart}
        </ButtonLink>
      </AuthLayout>
    );
  }

  if (result.poll_id) return <Navigate to={`/polls/${result.poll_id}`} replace />;
  if (token && result.poll.guests) return <GuestBallot token={token} data={result} signedIn={Boolean(user)} />;

  if (user) {
    return (
      <AuthLayout hero={<SharedPollTicket data={result} />} title={t.polls.shared.outsiderTitle} intro={t.polls.shared.outsiderIntro}>
        <ButtonLink to="/home" size="lg" block variant="secondary">
          {t.polls.shared.toHome}
        </ButtonLink>
      </AuthLayout>
    );
  }

  const open = result.poll.status === "open";
  return (
    <AuthLayout
      hero={<SharedPollTicket data={result} />}
      title={open ? t.polls.shared.guestTitle : t.polls.shared.guestClosedTitle}
      intro={open ? t.polls.shared.guestIntro : t.polls.shared.guestClosedIntro}
      footer={
        <>
          {t.polls.shared.hasAccount}{" "}
          <Link to="/login" className={linkClass}>
            {t.polls.shared.toLogin}
          </Link>
        </>
      }
    >
      <ButtonLink to="/register" size="lg" block>
        {t.polls.shared.register}
      </ButtonLink>
      <p className="mt-4 text-[13px] leading-snug text-faint">{result.poll.kind === "date" ? t.polls.shared.privacyDates : t.polls.shared.privacy}</p>
    </AuthLayout>
  );
}

/**
 * Die geteilte Abstimmung als Karte (V2 Etappe 3e): oben auf dem Stapel, Frist als Lime-Pille, die Frage als
 * Chrom-Plakat, darunter Vorschläge und Stimmen als Glas-Pillen. Ist sie vorbei, liegt sie gedämpft allein da.
 */
function SharedPollTicket({ data }: { data: Valid }) {
  const poll = data.poll;
  const open = poll.status === "open";
  const now = useNow(60_000);
  return (
    <section aria-labelledby="shared-poll-title" className={cn("ticket-feature-wrap", !open && "ticket-feature-past")} data-testid="shared-poll-card">
      <div className={cn("vote-card overflow-hidden rounded-[32px] p-5 sm:p-7", !open && "opacity-80")}>
        <span aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-pink/25 blur-3xl" />
        <div className="relative">
          <div className="flex flex-wrap items-center gap-2">
            {open ? (
              <LivePill testId="shared-poll-ends">{t.polls.status.endsIn(formatRelative(poll.ends_at, now))}</LivePill>
            ) : (
              <span className={GLASS_PILL}>
                <IconVote className="size-4" aria-hidden />
                {t.polls.shared.closed}
              </span>
            )}
          </div>
          <p className="mt-5 text-[13px] font-semibold uppercase tracking-[0.12em] text-faint">{t.polls.shared.kicker}</p>
          <p id="shared-poll-title" className="display chrome mt-2 break-words text-[27px] uppercase sm:text-[34px]">
            {poll.title}
          </p>
          <p className="mt-3 text-[15px] font-semibold text-fg">
            {open ? t.polls.shared.until(formatDateTime(poll.ends_at)) : t.polls.shared.closedOn(formatDateTime(poll.ends_at))}
          </p>
          {poll.kind === "date" && poll.dates && poll.dates.length > 0 && <SlotList dates={poll.dates} />}
          <div className="mt-5 flex flex-wrap gap-2">
            <p className={GLASS_PILL}>
              <span className="font-display text-[17px] font-extrabold leading-none text-fg">{poll.option_count}</span>
              {t.polls.shared.options(poll.option_count, poll.kind)}
            </p>
            <p className={GLASS_PILL}>
              {poll.voter_count > 0 && <span className="font-display text-[17px] font-extrabold leading-none text-lime">{poll.voter_count}</span>}
              {t.polls.shared.voters(poll.voter_count, open)}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/** P1 Etappe 2 · Termine einer Termin-Abstimmung als Glas-Pillen – sie verraten weder Namen noch Orte. */
function SlotList({ dates }: { dates: { date: string; time: string | null }[] }) {
  return (
    <div className="mt-4">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">{t.polls.shared.datesLabel}</p>
      <ul className="mt-2 flex flex-wrap gap-2" data-testid="shared-poll-dates">
        {dates.map((slot) => (
          <li key={`${slot.date}-${slot.time ?? ""}`} className="inline-flex min-h-9 items-center rounded-full border border-white/15 bg-white/[0.06] px-3.5 text-[13px] font-semibold text-fg">
            {formatPlainDate(slot.date)}
            {slot.time && <span className="font-normal text-muted">&nbsp;· {formatPlainTime(slot.time)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

const RESPONSES: VoteResponse[] = ["yes", "maybe", "no"];

function optionWhen(option: BallotOption, isDate: boolean): string {
  // P1: Bei Termin-Abstimmungen ist der Titel schon das Datum – darunter nur die Uhrzeit.
  if (isDate) return option.proposed_time ? formatPlainTime(option.proposed_time) : t.polls.shared.ballot.dates.timeOpen;
  if (!option.proposed_date) return t.polls.shared.ballot.dateOpen;
  const date = formatPlainDate(option.proposed_date);
  return option.proposed_time ? `${date}, ${formatPlainTime(option.proposed_time)}` : date;
}

/**
 * W3 Etappe 1 · Stimmzettel für Gäste ohne Konto: Vorschläge mit Stand, je Vorschlag „Bin dabei /
 * Vielleicht / Bin nicht dabei“, dazu der Name. Wer schon abgestimmt hat (Geheimnis auf diesem Gerät),
 * sieht seine Antworten und kann sie ändern. Danach der Weg zum eigenen Konto.
 */
function GuestBallot({ token, data, signedIn }: { token: string; data: Valid; signedIn: boolean }) {
  const secret = useMemo(() => guestSecret(token), [token]);
  const ballot = useSharedPollBallot(token, secret);
  const vote = useGuestVote(token, secret);
  const [answers, setAnswers] = useState<Record<string, VoteResponse | null>>({});
  // S2: Name vom letzten Link auf diesem Gerät – dann genügt ein Tipp je Vorschlag.
  const [deviceName, setDeviceName] = useState(() => rememberedGuestName());
  const [name, setName] = useState(() => deviceName ?? "");
  const [editingName, setEditingName] = useState(false);
  const [forgotten, setForgotten] = useState(false);
  const [errors, setErrors] = useState<{ name?: string | null; answers?: string | null }>({});
  const [saved, setSaved] = useState(false);
  const loaded = ballot.data?.status === "valid" ? ballot.data : null;
  // Antworten im Ein-Tipp-Modus nacheinander senden, damit schnelles Tippen nichts überholt.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  // Gespeicherten Stand übernehmen, sobald er da ist (nur einmal – Eingaben gehen nicht verloren).
  const me = loaded?.me ?? null;
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (initialized || !loaded) return;
    setInitialized(true);
    if (me) {
      setAnswers(me.votes);
      setName(me.name);
    }
  }, [initialized, loaded, me]);

  // Wer hier schon abgestimmt hat (oder den Namen vom letzten Link mitbringt), stimmt mit einem Tipp ab.
  const knownName = me?.name ?? deviceName;
  const oneTap = Boolean(knownName) && !editingName;

  if (ballot.isPending) return <PageSpinner />;
  if (ballot.isError) {
    return (
      <AuthLayout hero={<SharedPollTicket data={data} />} title={t.polls.shared.ballot.title}>
        <ErrorState error={ballot.error} onRetry={() => void ballot.refetch()} />
      </AuthLayout>
    );
  }
  if (!loaded) {
    // Gäste wurden inzwischen ausgeschaltet (oder der Link ist weg): wie ohne Freigabe.
    return (
      <AuthLayout hero={<SharedPollTicket data={data} />} title={t.polls.shared.guestTitle} intro={t.polls.shared.guestIntro}>
        <ButtonLink to={signedIn ? "/home" : "/register"} size="lg" block>
          {signedIn ? t.polls.shared.toHome : t.polls.shared.register}
        </ButtonLink>
      </AuthLayout>
    );
  }

  const open = loaded.poll.open;
  const isDate = (loaded.poll.kind ?? data.poll.kind) === "date";
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!loaded) return;
    const next = {
      name: name.trim().replace(/\s+/g, " ").length < 2 ? t.polls.shared.ballot.nameMissing : null,
      answers: !me && !Object.values(answers).some(Boolean) ? (isDate ? t.polls.shared.ballot.dates.noAnswer : t.polls.shared.ballot.noAnswer) : null,
    };
    setErrors(next);
    setSaved(false);
    if (next.name || next.answers) return;
    const votes = Object.fromEntries(loaded.options.map((o) => [String(o.key), answers[String(o.key)] ?? null]));
    const cleanName = name.trim().replace(/\s+/g, " ");
    vote.mutate(
      { name: cleanName, votes },
      {
        onSuccess: () => {
          setSaved(true);
          setEditingName(false);
          rememberGuestName(cleanName);
          setDeviceName(cleanName);
          setForgotten(false);
        },
      },
    );
  }

  /** Ein-Tipp-Modus: jede Antwort geht sofort raus – nur diese eine, die übrigen bleiben, wie sie sind. */
  function tap(key: string, next: VoteResponse | null) {
    if (!knownName) return;
    const previous = answers[key] ?? null;
    setAnswers((prev) => ({ ...prev, [key]: next }));
    setErrors((prev) => ({ ...prev, answers: null }));
    setSaved(false);
    // Neuer Gast ohne eine einzige Antwort: nichts zu speichern (der Server verlangt mindestens eine).
    if (!me && next === null) return;
    queue.current = queue.current.then(() =>
      vote
        .mutateAsync({ name: knownName, votes: { [key]: next } })
        .then(() => {
          setSaved(true);
          rememberGuestName(knownName);
        })
        .catch(() => setAnswers((prev) => ({ ...prev, [key]: previous }))),
    );
  }

  return (
    <AuthLayout
      hero={<SharedPollTicket data={data} />}
      title={!open ? t.polls.shared.ballot.closedTitle : me ? t.polls.shared.ballot.changeTitle(me.name) : t.polls.shared.ballot.title}
      intro={!open ? t.polls.shared.ballot.closedIntro : me ? t.polls.shared.ballot.changeIntro : isDate ? t.polls.shared.ballot.dates.intro : t.polls.shared.ballot.intro}
    >
      <form onSubmit={submit} noValidate className="space-y-5">
        <fieldset className="space-y-3" aria-describedby={errors.answers ? "ballot-answers-error" : undefined}>
          <legend className="mb-3 text-[15px] font-bold text-fg">{isDate ? t.polls.shared.ballot.dates.options : t.polls.shared.ballot.options}</legend>
          {loaded.options.map((option) => {
            const key = String(option.key);
            const mine = answers[key] ?? null;
            return (
              // V2 Etappe 3b: Der Vorschlag trägt die eigene Antwort – grün, gelb oder rot (wie in der Crew).
              <div key={key} className="vote-card p-4 sm:p-5" data-answer={open && mine ? mine : undefined} data-testid="ballot-option">
                <p className="display break-words text-[17px] uppercase text-fg">{option.title}</p>
                <p className="mt-1 text-sm text-muted">
                  {optionWhen(option, isDate)} · {t.polls.shared.ballot.counts(option.yes, option.maybe)}
                </p>
                {open && (
                  <div role="radiogroup" aria-label={t.polls.shared.ballot.answerFor(option.title)} className="mt-3 grid grid-cols-3 gap-2">
                    {RESPONSES.map((response) => {
                      const selected = mine === response;
                      return (
                        <button
                          key={response}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          data-response={response}
                          onClick={() => {
                            if (oneTap) {
                              tap(key, selected ? null : response);
                              return;
                            }
                            setAnswers((prev) => ({ ...prev, [key]: selected ? null : response }));
                            setSaved(false);
                            setErrors((prev) => ({ ...prev, answers: null }));
                          }}
                          className="vote-pill"
                        >
                          {t.enums.vote[response]}
                        </button>
                      );
                    })}
                  </div>
                )}
                {!open && mine && (
                  <p className="mt-2 text-sm text-muted">
                    {t.polls.detail.yourAnswer}: <span className="font-semibold text-fg">{t.enums.vote[mine]}</span>
                  </p>
                )}
              </div>
            );
          })}
          {errors.answers && (
            <p id="ballot-answers-error" role="alert" className="text-sm text-danger">
              {errors.answers}
            </p>
          )}
        </fieldset>

        {open && oneTap && knownName && (
          <div className="space-y-3" data-testid="guest-one-tap">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-[28px] border border-white/15 bg-white/[0.06] py-1.5 pl-5 pr-3">
              <p className="text-[15px] text-muted">
                {t.polls.shared.ballot.votingAs} <span className="font-bold text-fg">{knownName}</span>
              </p>
              <button
                type="button"
                onClick={() => {
                  setName(knownName);
                  setEditingName(true);
                  setSaved(false);
                }}
                className="min-h-11 text-sm font-semibold text-muted underline-offset-4 hover:text-fg hover:underline"
              >
                {t.polls.shared.ballot.notMe(knownName)}
              </button>
            </div>
            <p className="text-[13px] leading-snug text-faint">{t.polls.shared.ballot.tapHint}</p>
            {vote.isError && <FormMessage>{errorMessage(vote.error)}</FormMessage>}
            <div aria-live="polite">
              {vote.isPending ? (
                <p className="text-sm text-muted">{t.polls.shared.ballot.saving}</p>
              ) : (
                saved && <FormMessage tone="success">{t.polls.shared.ballot.saved}</FormMessage>
              )}
            </div>
            <p className="text-[13px] leading-snug text-faint">{t.polls.shared.ballot.privacy}</p>
          </div>
        )}
        {open && !oneTap && (
          <>
            {forgotten && <FormMessage tone="success">{t.polls.shared.ballot.nameForgotten}</FormMessage>}
            <TextField
              label={t.polls.shared.ballot.name}
              name="guest_name"
              autoComplete="given-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setSaved(false);
                setErrors((prev) => ({ ...prev, name: null }));
              }}
              maxLength={40}
              hint={t.polls.shared.ballot.nameHint}
              error={errors.name}
              required
            />
            {vote.isError && <FormMessage>{errorMessage(vote.error)}</FormMessage>}
            {saved && <FormMessage tone="success">{t.polls.shared.ballot.saved}</FormMessage>}
            <Button type="submit" size="lg" block loading={vote.isPending}>
              {me ? t.polls.shared.ballot.update : t.polls.shared.ballot.submit}
            </Button>
            {deviceName && (
              <button
                type="button"
                onClick={() => {
                  rememberGuestName(null);
                  setDeviceName(null);
                  setForgotten(true);
                  if (!me) setName("");
                }}
                className="min-h-11 text-sm font-semibold text-muted underline-offset-4 hover:text-fg hover:underline"
              >
                {t.polls.shared.ballot.forgetName}
              </button>
            )}
            <p className="text-[13px] leading-snug text-faint">{t.polls.shared.ballot.privacy}</p>
          </>
        )}
      </form>

      {me && loaded.poll.can_join ? (
        <GuestJoinCard token={token} secret={secret} name={me.name} />
      ) : !signedIn && (me || !open) && (
        <div className="vote-card mt-8 p-5 sm:p-6">
          <p className="text-[17px] font-bold text-fg">{t.polls.shared.ballot.ctaTitle}</p>
          <p className="mt-1.5 text-[15px] leading-snug text-muted">{t.polls.shared.ballot.ctaBody}</p>
          <ButtonLink to="/register" variant="secondary" block className="mt-4">
            {t.polls.shared.register}
          </ButtonLink>
          <p className="mt-3 text-sm text-muted">
            {t.polls.shared.hasAccount}{" "}
            <Link to="/login" className={linkClass}>
              {t.polls.shared.toLogin}
            </Link>
          </p>
        </div>
      )}
    </AuthLayout>
  );
}

/**
 * W3 Etappe 3 · Die Crew erlaubt Gästen den Beitritt: Wer abgestimmt hat, holt sich hier einen
 * persönlichen Einladungslink und landet auf der normalen Einladung – Konto anlegen oder anmelden,
 * beitreten, Stimme übernehmen. Ohne Abstimmen erscheint die Karte nicht.
 */
function GuestJoinCard({ token, secret, name }: { token: string; secret: string; name: string }) {
  const navigate = useNavigate();
  const join = useGuestJoin(token, secret);
  return (
    <section aria-labelledby="guest-join-title" className="mt-8 rounded-card border border-lime/60 bg-lime/10 p-5" data-testid="guest-join">
      <h2 id="guest-join-title" className="text-[17px] font-bold text-fg">
        {t.polls.shared.join.title(name)}
      </h2>
      <p className="mt-1.5 text-[15px] leading-snug text-muted">{t.polls.shared.join.body}</p>
      {join.isError && (
        <div className="mt-3">
          <FormMessage>{errorMessage(join.error)}</FormMessage>
        </div>
      )}
      <Button
        size="lg"
        block
        className="mt-4"
        loading={join.isPending}
        onClick={() => join.mutate(undefined, { onSuccess: (result) => navigate(`/invite/${result.token}`) })}
      >
        {t.polls.shared.join.cta}
      </Button>
      <p className="mt-3 text-[13px] leading-snug text-muted">{t.polls.shared.join.privacy}</p>
    </section>
  );
}
