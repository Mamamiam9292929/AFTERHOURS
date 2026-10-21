import { useEffect } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Avatar } from "@/components/ui/Avatar";
import { ButtonLink } from "@/components/ui/Button";
import { ErrorState, PageSpinner } from "@/components/ui/Feedback";
import { GLASS_PILL } from "@/components/ui/Pill";
import { AuthLayout } from "@/features/auth/AuthLayout";
import { useAuth } from "@/features/auth/AuthProvider";
import { clearNext, rememberNext } from "@/features/auth/next";
import { RegisterForm } from "@/features/auth/pages";
import { t } from "@/i18n";
import { useDocumentTitle, useNow } from "@/lib/hooks";
import { calendarDaysBetween, formatDateTime, formatRelative, ticketDate } from "@/lib/time";
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

/**
 * Die Einladung als Karte (V2 Etappe 3f): oben auf dem Stapel, wer einlädt als Lime-Pille, der Crew-Name als
 * Chrom-Plakat, wer schon dabei ist, und der nächste Abend als kleine Karte im Deck. Dass der Link abläuft,
 * steht ruhig als Glas-Pille da – ohne Countdown-Druck.
 */
function InviteTicket({ data }: { data: Valid }) {
  const plan = data.next_plan;
  const date = plan ? ticketDate(plan.starts_at) : null;
  const now = useNow(60_000);
  return (
    <section aria-labelledby="invite-crew" className="ticket-feature-wrap" data-testid="invite-card">
      <div className="vote-card overflow-hidden rounded-[32px] p-5 sm:p-7">
        <span aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-lime/15 blur-3xl" />
        <span aria-hidden className="pointer-events-none absolute -bottom-24 -left-16 size-56 rounded-full bg-pink/20 blur-3xl" />
        <div className="relative">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-9 items-center gap-2 rounded-full bg-lime px-3.5 text-[13px] font-bold text-lime-ink" data-testid="invite-by">
              <span aria-hidden className="text-[16px] leading-none">
                {data.crew.emoji}
              </span>
              {data.invited_by ? t.crews.landing.invitedBy(data.invited_by) : t.crews.landing.invitedAnonymous}
            </span>
          </div>
          <p className="mt-5 text-[13px] font-semibold uppercase tracking-[0.12em] text-faint">{t.crews.landing.crew}</p>
          <p id="invite-crew" className="display chrome mt-2 break-words text-[27px] uppercase sm:text-[34px]">
            {data.crew.name}
          </p>
          {data.members.length > 0 && (
            <div className="mt-4 flex items-center gap-3">
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
          {/* Der nächste Abend als zweite, kleinere Karte im Deck. */}
          <div className="mt-5 flex items-center gap-4 rounded-[24px] border border-white/10 bg-white/[0.05] p-3.5 pr-4" data-testid="invite-next">
            {date ? (
              <p className="flex w-[60px] shrink-0 flex-col items-center rounded-[18px] border border-lime/40 bg-lime/10 px-1 py-2 text-center leading-none text-fg">
                <span className="text-[11px] font-bold uppercase tracking-wide">{date.weekday}</span>
                <span className="mt-1 font-display text-[24px] font-extrabold text-lime">{date.day}</span>
                <span className="mt-1 text-[11px] font-bold uppercase tracking-wide">{date.month}</span>
              </p>
            ) : (
              <span aria-hidden className="grid size-[60px] shrink-0 place-items-center rounded-[18px] border border-dashed border-white/20 text-[26px]">
                {data.crew.emoji}
              </span>
            )}
            <div className="min-w-0">
              <p className="text-[12px] font-bold uppercase tracking-wide text-muted">{t.crews.landing.nextPlan}</p>
              {plan ? (
                <p className="mt-1 text-fg">
                  <span className="block break-words font-semibold">{plan.title}</span>
                  <span className="block text-[14px] text-muted">{formatDateTime(plan.starts_at)}</span>
                </p>
              ) : (
                <p className="mt-1 text-[14px] leading-snug text-muted">{t.crews.landing.nextPlanNone}</p>
              )}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <p className={GLASS_PILL} data-testid="invite-expires">
              {/* formatRelative nennt ab 30 Tagen ein Datum (Puffer für die Zeitumstellung) – dann „gilt bis …“ statt „läuft … ab“. */}
              {calendarDaysBetween(now, data.expires_at) < 29 ? t.crews.landing.expires(formatRelative(data.expires_at, now)) : t.crews.landing.expiresOn(formatDateTime(data.expires_at))}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
