import { useEffect } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { IconCheck } from "@/components/icons";
import { ButtonLink } from "@/components/ui/Button";
import { ErrorState, PageSpinner } from "@/components/ui/Feedback";
import { GLASS_PILL, LivePill } from "@/components/ui/Pill";
import { AuthLayout } from "@/features/auth/AuthLayout";
import { useAuth } from "@/features/auth/AuthProvider";
import { clearNext, rememberNext } from "@/features/auth/next";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { spotsLeft } from "@/lib/capacity";
import { useDocumentTitle, useNow } from "@/lib/hooks";
import { quorumLeft } from "@/lib/quorum";
import { formatTime, ticketDate } from "@/lib/time";
import { type SharedPlanPreview, useSharedPlanPreview } from "./api";
import { planCountdown } from "./PlanTicket";
import { storedPlanGuestSecret } from "./guestsApi";
import { SharedPlanRsvp } from "./SharedPlanRsvp";

type Valid = Extract<SharedPlanPreview, { status: "valid" }>;

const linkClass = "font-semibold text-fg underline decoration-line-strong underline-offset-4 hover:decoration-lime";

/**
 * W2 · Geteilter Plan: Ziel des Links aus dem Gruppenchat (/s/<token>). Crew-Mitglieder springen
 * direkt zum Plan. Alle anderen sehen die Karte – Titel, Zeit, wie viele dabei sind – und den Weg in
 * die App. Dieselben Angaben stehen in der Messenger-Vorschau (api/share.js).
 */
export function SharedPlanPage() {
  const { token } = useParams();
  const { loading, user } = useAuth();
  // Erst fragen, wenn die Sitzung feststeht: Mitglieder bekommen die Plan-ID nur mit Anmeldung.
  const preview = useSharedPlanPreview(token, user?.id ?? null, !loading);
  const data = preview.data;

  useDocumentTitle(data?.status === "valid" ? t.plans.shared.pageTitle(data.plan.title) : t.plans.shared.kicker);

  // Wer sich von hier aus registriert oder anmeldet, kommt danach wieder auf diese Karte.
  useEffect(() => {
    if (!token || !data || user) return;
    if (data.status === "valid") rememberNext(`/s/${token}`);
    else clearNext();
  }, [token, data, user]);

  if (loading || preview.isPending) return <PageSpinner />;
  if (preview.isError) {
    return (
      <AuthLayout title={t.plans.shared.kicker}>
        <ErrorState error={preview.error} onRetry={() => void preview.refetch()} />
      </AuthLayout>
    );
  }

  const result = preview.data;
  if (result.status !== "valid") {
    const copy = t.plans.shared.status[result.status];
    return (
      <AuthLayout title={copy.title} intro={copy.body}>
        <ButtonLink to={user ? "/home" : "/login"} size="lg" block variant="secondary">
          {t.plans.shared.toStart}
        </ButtonLink>
      </AuthLayout>
    );
  }

  if (result.plan_id) return <Navigate to={`/plans/${result.plan_id}`} replace />;

  const fallback = user ? (
    <AuthLayout hero={<SharedPlanTicket data={result} />} title={t.plans.shared.outsiderTitle} intro={t.plans.shared.outsiderIntro}>
      <ButtonLink to="/home" size="lg" block variant="secondary">
        {t.plans.shared.toHome}
      </ButtonLink>
    </AuthLayout>
  ) : null;
  // W10: Die Crew erlaubt Zusagen ohne Konto – dann steht hier die Zusagekarte. W11: Wer hier schon als Gast
  // geantwortet hat, sieht sie auch nach Beginn (eigene Antwort, „Crew beitreten“, falls freigeschaltet).
  if (token && (result.plan.guests || storedPlanGuestSecret(token))) {
    // P26 Etappe 2: Runde voll – Gäste können dann nur „Vielleicht“ oder „Kann nicht“ sagen.
    const full = spotsLeft(result.plan, result.plan.going_count) === 0;
    return (
      <SharedPlanRsvp token={token} hero={<SharedPlanTicket data={result} />} signedIn={Boolean(user)} fallback={fallback ?? <GuestInvite data={result} />} full={full} />
    );
  }
  if (fallback) return fallback;
  return <GuestInvite data={result} />;
}

/** Ohne Konto und ohne Freigabe: Karte und der Weg in die App. */
function GuestInvite({ data: result }: { data: Valid }) {
  return (
    <AuthLayout
      hero={<SharedPlanTicket data={result} />}
      title={t.plans.shared.guestTitle}
      intro={t.plans.shared.guestIntro}
      footer={
        <>
          {t.plans.shared.hasAccount}{" "}
          <Link to="/login" className={linkClass}>
            {t.plans.shared.toLogin}
          </Link>
        </>
      }
    >
      <ButtonLink to="/register" size="lg" block>
        {t.plans.shared.register}
      </ButtonLink>
      <p className="mt-4 text-[13px] leading-snug text-faint">{t.plans.shared.privacy}</p>
    </AuthLayout>
  );
}

/**
 * Der geteilte Plan als Karte (V2 Etappe 3f) – wie die geteilte Abstimmung: oben auf dem Stapel, was gerade
 * zählt als Lime-Pille („In 3 Tagen“), der Titel als Chrom-Plakat, das Datum als Kachel daneben, die Zusagen als
 * Glas-Pille. Wer den Link öffnet, hat noch keine Antwort – die Karte bleibt deshalb dunkles Glas.
 * Ist der Abend vorbei oder abgesagt, liegt sie gedämpft allein da.
 */
function SharedPlanTicket({ data }: { data: Valid }) {
  const plan = data.plan;
  const now = useNow(60_000);
  const date = ticketDate(plan.starts_at);
  const over = plan.status === "completed" || plan.status === "cancelled" || new Date(plan.ends_at ?? plan.starts_at).getTime() < now.getTime();
  const countdown = over ? null : planCountdown(plan, now);
  // P25 Etappe 2: „Noch 1 fehlt – bist du dabei?“ bzw. „Findet statt“, solange der Abend offen ist.
  const left = over ? null : quorumLeft(plan, plan.going_count, now);
  // P26 Etappe 2: „Noch 2 Plätze frei“ bzw. „Voll“, solange der Abend offen ist.
  const spots = over ? null : spotsLeft(plan, plan.going_count, now);
  return (
    <section aria-labelledby="shared-plan-title" className={cn("ticket-feature-wrap", over && "ticket-feature-past")} data-testid="shared-plan-card">
      <div className={cn("vote-card overflow-hidden rounded-[32px] p-5 sm:p-7", over && "opacity-80")}>
        <span aria-hidden className="pointer-events-none absolute -left-16 -top-20 size-56 rounded-full bg-violet/30 blur-3xl" />
        <div className="relative flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {countdown && <LivePill testId="shared-plan-countdown">{countdown}</LivePill>}
            <span className={cn(GLASS_PILL, plan.status === "cancelled" ? "text-danger" : "text-fg")}>{t.enums.planStatus[plan.status]}</span>
          </div>
          {/* Datum als Kachel – ersetzt den Abriss des alten Tickets. */}
          <p className={cn("flex w-[72px] shrink-0 flex-col items-center rounded-[22px] border px-2 py-2.5 text-center leading-none", over ? "border-white/10 bg-white/[0.04] text-muted" : "border-lime/40 bg-lime/10 text-fg")} data-testid="shared-plan-date">
            <span className="text-[12px] font-bold uppercase tracking-wide">{date.weekday}</span>
            <span className={cn("mt-1 font-display text-[30px] font-extrabold", !over && "text-lime")}>{date.day}</span>
            <span className="mt-1 text-[12px] font-bold uppercase tracking-wide">{date.month}</span>
          </p>
        </div>
        <div className="relative">
          <p className="mt-4 text-[13px] font-semibold uppercase tracking-[0.12em] text-faint">{t.plans.shared.kicker}</p>
          <p id="shared-plan-title" className={cn("display chrome mt-2 break-words text-[27px] uppercase sm:text-[34px]", plan.status === "cancelled" && "line-through decoration-2")}>
            {plan.title}
          </p>
          <p className="mt-3 text-[15px] font-semibold text-fg">{formatTime(plan.starts_at)}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <p className={GLASS_PILL} data-testid="shared-plan-going">
              {plan.going_count > 0 && <span className="font-display text-[17px] font-extrabold leading-none text-lime">{plan.going_count}</span>}
              {t.plans.shared.going(plan.going_count, over)}
            </p>
            {left != null && (
              <p
                className={cn(GLASS_PILL, left === 0 ? "border-lime/50 bg-lime/10 text-lime" : "border-amber/45 bg-amber/10 text-fg")}
                data-testid="shared-plan-quorum"
                data-reached={left === 0 ? "true" : "false"}
              >
                {left === 0 && <IconCheck className="size-4" aria-hidden />}
                {left === 0 ? t.plans.ticket.quorum.reached : t.plans.shared.quorumAsk(left)}
              </p>
            )}
            {spots != null && (
              <p
                className={cn(GLASS_PILL, spots === 0 ? "border-white/30 text-fg" : "border-lime/40 text-fg")}
                data-testid="shared-plan-capacity"
                data-full={spots === 0 ? "true" : "false"}
              >
                {spots === 0 ? t.plans.shared.capacityFull : t.plans.shared.capacityLeft(spots)}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
