import { useEffect } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Avatar } from "@/components/ui/Avatar";
import { ButtonLink } from "@/components/ui/Button";
import { ErrorState, PageSpinner } from "@/components/ui/Feedback";
import { AuthLayout } from "@/features/auth/AuthLayout";
import { useAuth } from "@/features/auth/AuthProvider";
import { clearNext, rememberNext } from "@/features/auth/next";
import { RegisterForm } from "@/features/auth/pages";
import { t } from "@/i18n";
import { useDocumentTitle } from "@/lib/hooks";
import { formatDateTime, ticketDate } from "@/lib/time";
import { type PublicInvitationPreview, usePublicInvitationPreview } from "./api";

type Valid = Extract<PublicInvitationPreview, { status: "valid" }>;

const linkClass = "font-semibold text-fg underline decoration-line-strong underline-offset-4 hover:decoration-lime";

/**
 * W1 · Einladungs-Landingpage: Wer einen Crew-Link ohne Konto öffnet, sieht hier die Einladung als
 * Ticket – Crew, wer schon dabei ist, der nächste Abend – und legt direkt darunter sein Konto an.
 * Danach (E-Mail bestätigen, Profil) landet die Person auf /join/<token> und tritt ausdrücklich bei.
 */
export function InviteLandingPage() {
  const { token } = useParams();
  const { loading, user } = useAuth();
  const preview = usePublicInvitationPreview(token, !loading && !user);
  const valid = preview.data?.status === "valid";

  useDocumentTitle(preview.data?.status === "valid" ? t.crews.landing.pageTitle(preview.data.crew.name) : t.crews.join.title);

  // Nach Registrierung, Bestätigung und Profil geht es zur Beitrittsseite – auch über einen neuen Tab.
  // Ein ungültiger Link wird vergessen, damit niemand nach der Anmeldung auf einer Fehlerseite landet.
  useEffect(() => {
    if (!token || !preview.data) return;
    if (valid) rememberNext(`/join/${token}`);
    else clearNext();
  }, [token, preview.data, valid]);

  if (loading) return <PageSpinner />;
  if (user) return <Navigate to={`/join/${token ?? ""}`} replace />;
  if (preview.isPending) return <PageSpinner />;
  if (preview.isError) {
    return (
      <AuthLayout title={t.crews.join.title}>
        <ErrorState error={preview.error} onRetry={() => void preview.refetch()} />
      </AuthLayout>
    );
  }

  const data = preview.data;
  if (data.status !== "valid") {
    const copy = t.crews.join.status[data.status];
    return (
      <AuthLayout title={copy.title} intro={copy.body}>
        <ButtonLink to="/login" size="lg" block variant="secondary">
          {t.crews.landing.invalidTo}
        </ButtonLink>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      hero={<InviteTicket data={data} />}
      title={t.crews.landing.title}
      intro={t.crews.landing.intro}
      footer={
        <>
          {t.crews.landing.hasAccount}{" "}
          <Link to="/login" className={linkClass}>
            {t.crews.landing.toLogin}
          </Link>
        </>
      }
    >
      <RegisterForm submitLabel={t.crews.landing.submit} />
      <p className="mt-4 text-[13px] leading-snug text-faint">{t.crews.landing.privacy}</p>
    </AuthLayout>
  );
}

/** Die Einladung als Eintrittskarte: Abriss mit dem Datum des nächsten Abends (sonst das Crew-Emoji). */
function InviteTicket({ data }: { data: Valid }) {
  const plan = data.next_plan;
  const date = plan ? ticketDate(plan.starts_at) : null;
  return (
    <section aria-labelledby="invite-crew" className="ticket-feature-wrap">
      <div className="ticket ticket-feature">
        <div className="ticket-stub flex flex-col items-center justify-center gap-1 bg-lime px-2 py-5 text-center text-lime-ink">
          {date ? (
            <p className="flex flex-col items-center leading-none">
              <span className="text-[13px] font-bold uppercase tracking-wide">{date.weekday}</span>
              <span className="font-display text-[46px] font-extrabold leading-[0.9] sm:text-[55px]">{date.day}</span>
              <span className="text-[13px] font-bold uppercase tracking-wide">{date.month}</span>
            </p>
          ) : (
            <p className="flex flex-col items-center">
              <span className="text-[48px] leading-none" aria-hidden>
                {data.crew.emoji}
              </span>
              <span className="mt-2 text-[13px] font-bold uppercase tracking-wide">{t.crews.landing.admit}</span>
            </p>
          )}
          <span className="ticket-barcode mt-3" aria-hidden />
        </div>
        <div className="flex min-w-0 flex-col gap-4 p-5 sm:p-6">
          <div className="min-w-0">
            <p className="text-[13px] text-muted">{data.invited_by ? t.crews.landing.invitedBy(data.invited_by) : t.crews.landing.invitedAnonymous}</p>
            <p id="invite-crew" className="display mt-1 break-words text-[24px] uppercase text-fg sm:text-[29px]">
              {date && (
                <span className="mr-2" aria-hidden>
                  {data.crew.emoji}
                </span>
              )}
              {data.crew.name}
            </p>
          </div>
          {data.members.length > 0 && (
            <div className="flex items-center gap-3">
              <span className="flex shrink-0 -space-x-2 [--avatar-ring:var(--color-surface)]" aria-hidden>
                {data.members.slice(0, 4).map((name, index) => (
                  <Avatar key={`${name}-${index}`} person={{ id: `${name}-${index}`, display_name: name, avatar_url: null }} size="sm" decorative />
                ))}
              </span>
              <p className="min-w-0 text-[14px] leading-snug text-muted">
                <span className="sr-only">{t.crews.landing.membersLabel}: </span>
                {t.crews.landing.members(data.members, data.crew.member_count)}
              </p>
            </div>
          )}
          <div className="border-t border-dashed border-line pt-4">
            <p className="text-[12px] font-bold uppercase tracking-wide text-muted">{t.crews.landing.nextPlan}</p>
            {plan ? (
              <p className="mt-1 text-fg">
                <span className="font-semibold">{plan.title}</span>
                <span className="block text-[14px] text-muted">{formatDateTime(plan.starts_at)}</span>
              </p>
            ) : (
              <p className="mt-1 text-[14px] leading-snug text-muted">{t.crews.landing.nextPlanNone}</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
