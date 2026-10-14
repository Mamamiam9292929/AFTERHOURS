import { useEffect } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { IconVote } from "@/components/icons";
import { ButtonLink } from "@/components/ui/Button";
import { Badge, ErrorState, PageSpinner } from "@/components/ui/Feedback";
import { AuthLayout } from "@/features/auth/AuthLayout";
import { useAuth } from "@/features/auth/AuthProvider";
import { clearNext, rememberNext } from "@/features/auth/next";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { useDocumentTitle } from "@/lib/hooks";
import { formatDateTime, ticketDate } from "@/lib/time";
import { type SharedPollPreview, useSharedPollPreview } from "./api";

type Valid = Extract<SharedPollPreview, { status: "valid" }>;

const linkClass = "font-semibold text-fg underline decoration-line-strong underline-offset-4 hover:decoration-lime";

/**
 * W2 Etappe 2 · Geteilte Abstimmung: Ziel des Links aus dem Gruppenchat (/v/<token>). Crew-Mitglieder
 * springen direkt zur Abstimmung. Alle anderen sehen die Karte – Frage, Frist, wie viele Vorschläge und
 * wie viele schon abgestimmt haben – und den Weg in die App. Dieselben Angaben stehen in der
 * Messenger-Vorschau (api/share.js). Was zur Wahl steht, sieht nur die Crew.
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
