import { useEffect } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ButtonLink } from "@/components/ui/Button";
import { ErrorState, PageSpinner } from "@/components/ui/Feedback";
import { AuthLayout } from "@/features/auth/AuthLayout";
import { useAuth } from "@/features/auth/AuthProvider";
import { clearNext, rememberNext } from "@/features/auth/next";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { useDocumentTitle } from "@/lib/hooks";
import { formatTime, ticketDate } from "@/lib/time";
import { type SharedPlanPreview, useSharedPlanPreview } from "./api";
import { planStatusBadge } from "./PlanTicket";

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

  if (user) {
    return (
      <AuthLayout hero={<SharedPlanTicket data={result} />} title={t.plans.shared.outsiderTitle} intro={t.plans.shared.outsiderIntro}>
        <ButtonLink to="/home" size="lg" block variant="secondary">
          {t.plans.shared.toHome}
        </ButtonLink>
      </AuthLayout>
    );
  }

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

/** Der geteilte Plan als Eintrittskarte: Datum im Abriss, Titel als Plakat, Zahl der Zusagen. */
function SharedPlanTicket({ data }: { data: Valid }) {
  const plan = data.plan;
  const date = ticketDate(plan.starts_at);
  const over = plan.status === "completed" || plan.status === "cancelled" || new Date(plan.ends_at ?? plan.starts_at).getTime() < Date.now();
  return (
    <section aria-labelledby="shared-plan-title" className={cn("ticket-feature-wrap", over && "ticket-feature-past")}>
      <div className="ticket ticket-feature">
        <div className={cn("ticket-stub flex flex-col items-center justify-center gap-1 px-2 py-5 text-center", over ? "bg-raised text-muted" : "bg-lime text-lime-ink")}>
          <span className="text-[13px] font-bold uppercase tracking-wide">{date.weekday}</span>
          <span className="font-display text-[46px] font-extrabold leading-[0.9] sm:text-[55px]">{date.day}</span>
          <span className="text-[13px] font-bold uppercase tracking-wide">{date.month}</span>
          <span className="ticket-barcode mt-3" aria-hidden />
        </div>
        <div className="flex min-w-0 flex-col justify-between gap-4 p-5 sm:p-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {planStatusBadge(plan.status)}
              <span className="text-[13px] text-muted">{t.plans.shared.kicker}</span>
            </div>
            <p id="shared-plan-title" className={cn("display mt-3 break-words text-[23px] uppercase text-fg sm:text-[29px]", plan.status === "cancelled" && "line-through decoration-2")}>
              {plan.title}
            </p>
            <p className="mt-2 text-[15px] font-semibold text-fg">{formatTime(plan.starts_at)}</p>
          </div>
          <p className="flex items-baseline gap-1.5 border-t border-dashed border-line pt-4 text-[15px] font-semibold text-muted">
            {plan.going_count > 0 && <span className="font-display text-[24px] font-extrabold leading-none text-fg">{plan.going_count}</span>}
            {t.plans.shared.going(plan.going_count, over)}
          </p>
        </div>
      </div>
    </section>
  );
}
