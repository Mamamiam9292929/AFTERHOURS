import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { IconVote } from "@/components/icons";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Badge, ErrorState, PageSpinner } from "@/components/ui/Feedback";
import { FormMessage, TextField } from "@/components/ui/Field";
import { AuthLayout } from "@/features/auth/AuthLayout";
import { useAuth } from "@/features/auth/AuthProvider";
import { clearNext, rememberNext } from "@/features/auth/next";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { useDocumentTitle } from "@/lib/hooks";
import { errorMessage } from "@/lib/errors";
import { formatDateTime, formatPlainDate, formatPlainTime, ticketDate } from "@/lib/time";
import type { VoteResponse } from "@/lib/types";
import { type BallotOption, guestSecret, type SharedPollPreview, useGuestVote, useSharedPollBallot, useSharedPollPreview } from "./api";

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
      <p className="mt-4 text-[13px] leading-snug text-faint">{t.polls.shared.privacy}</p>
    </AuthLayout>
  );
}

/** Die geteilte Abstimmung als Karte: Frist im Abriss, Frage als Plakat, Vorschläge und Stimmen als Zahlen. */
function SharedPollTicket({ data }: { data: Valid }) {
  const poll = data.poll;
  const open = poll.status === "open";
  const date = ticketDate(poll.ends_at);
  return (
    <section aria-labelledby="shared-poll-title" className={cn("ticket-feature-wrap", !open && "ticket-feature-past")}>
      <div className="ticket ticket-feature">
        <div className={cn("ticket-stub flex flex-col items-center justify-center gap-1 px-2 py-5 text-center", open ? "bg-lime text-lime-ink" : "bg-raised text-muted")}>
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] opacity-80">{t.polls.shared.stubLabel}</span>
          <span className="text-[13px] font-bold uppercase tracking-wide">{date.weekday}</span>
          <span className="font-display text-[64px] font-extrabold leading-[0.9] sm:text-[76px]">{date.day}</span>
          <span className="text-[13px] font-bold uppercase tracking-wide">{date.month}</span>
          <span className="ticket-barcode mt-3" aria-hidden />
        </div>
        <div className="flex min-w-0 flex-col justify-between gap-4 p-5 sm:p-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={open ? "lime" : "neutral"} icon={<IconVote className="size-3.5" aria-hidden />}>
                {open ? t.polls.shared.open : t.polls.shared.closed}
              </Badge>
              <span className="text-[13px] text-muted">{t.polls.shared.kicker}</span>
            </div>
            <p id="shared-poll-title" className="display mt-3 break-words text-[32px] uppercase text-fg sm:text-[40px]">
              {poll.title}
            </p>
            <p className="mt-2 text-[15px] font-semibold text-fg">
              {open ? t.polls.shared.until(formatDateTime(poll.ends_at)) : t.polls.shared.closedOn(formatDateTime(poll.ends_at))}
            </p>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 border-t border-dashed border-line pt-4 text-[15px] font-semibold text-muted">
            <p className="flex items-baseline gap-1.5">
              <span className="font-display text-[34px] font-extrabold leading-none text-fg">{poll.option_count}</span>
              {t.polls.shared.options(poll.option_count)}
            </p>
            <p className="flex items-baseline gap-1.5">
              {poll.voter_count > 0 && <span className="font-display text-[34px] font-extrabold leading-none text-lime">{poll.voter_count}</span>}
              {t.polls.shared.voters(poll.voter_count, open)}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

const RESPONSES: VoteResponse[] = ["yes", "maybe", "no"];

function optionWhen(option: BallotOption): string {
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
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<{ name?: string | null; answers?: string | null }>({});
  const [saved, setSaved] = useState(false);
  const loaded = ballot.data?.status === "valid" ? ballot.data : null;

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
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!loaded) return;
    const next = {
      name: name.trim().replace(/\s+/g, " ").length < 2 ? t.polls.shared.ballot.nameMissing : null,
      answers: !me && !Object.values(answers).some(Boolean) ? t.polls.shared.ballot.noAnswer : null,
    };
    setErrors(next);
    setSaved(false);
    if (next.name || next.answers) return;
    const votes = Object.fromEntries(loaded.options.map((o) => [String(o.key), answers[String(o.key)] ?? null]));
    vote.mutate({ name: name.trim(), votes }, { onSuccess: () => setSaved(true) });
  }

  return (
    <AuthLayout
      hero={<SharedPollTicket data={data} />}
      title={!open ? t.polls.shared.ballot.closedTitle : me ? t.polls.shared.ballot.changeTitle(me.name) : t.polls.shared.ballot.title}
      intro={!open ? t.polls.shared.ballot.closedIntro : me ? t.polls.shared.ballot.changeIntro : t.polls.shared.ballot.intro}
    >
      <form onSubmit={submit} noValidate className="space-y-5">
        <fieldset className="space-y-3" aria-describedby={errors.answers ? "ballot-answers-error" : undefined}>
          <legend className="mb-3 text-[15px] font-bold text-fg">{t.polls.shared.ballot.options}</legend>
          {loaded.options.map((option) => {
            const key = String(option.key);
            const mine = answers[key] ?? null;
            return (
              <div key={key} className={cn("rounded-card border bg-surface p-4", mine === "yes" ? "border-lime" : "border-line")}>
                <p className="display break-words text-[24px] uppercase text-fg">{option.title}</p>
                <p className="mt-1 text-sm text-muted">
                  {optionWhen(option)} · {t.polls.shared.ballot.counts(option.yes, option.maybe)}
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
                          onClick={() => {
                            setAnswers((prev) => ({ ...prev, [key]: selected ? null : response }));
                            setSaved(false);
                            setErrors((prev) => ({ ...prev, answers: null }));
                          }}
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

        {open && (
          <>
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
            <p className="text-[13px] leading-snug text-faint">{t.polls.shared.ballot.privacy}</p>
          </>
        )}
      </form>

      {!signedIn && (me || !open) && (
        <div className="mt-8 rounded-card border border-dashed border-line-strong p-5">
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
