import { Link, useNavigate } from "react-router-dom";
import { IconBell, IconBot, IconChevronRight, IconLogout, IconPin, IconSettings, IconShield } from "@/components/icons";
import { PosterTitle, Section } from "@/components/layout/Page";
import { Avatar } from "@/components/ui/Avatar";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ErrorState, PageSpinner } from "@/components/ui/Feedback";
import { GLASS_PILL } from "@/components/ui/Pill";
import { useAuth } from "@/features/auth/AuthProvider";
import { useCrews } from "@/features/crews/api";
import { CrewRow } from "@/features/crews/CrewsPage";
import { isUpcoming, usePlans } from "@/features/plans/api";
import { totalPoints, useRewards } from "@/features/rewards/RewardsPage";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { formatMonthYear } from "@/lib/time";
import { useIsAdmin, useProfile } from "./api";

export function ProfilePage() {
  useDocumentTitle(t.profile.title);
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const profile = useProfile();
  const crews = useCrews();
  const plans = usePlans();
  const rewards = useRewards();
  const admin = useIsAdmin();

  if (profile.isPending) return <PageSpinner />;
  if (profile.isError) return <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />;
  const me = profile.data;
  const mine = (plans.data ?? []).filter((p) => p.participants.some((pp) => pp.user_id === user?.id && pp.attendance_status !== "declined"));
  // Solange eine Quelle lädt oder fehlt, steht „–“ statt einer falschen 0.
  const count = (ready: boolean, value: number) => (ready ? formatNumber(value) : "–");
  const plansReady = plans.isSuccess;
  const evenings = mine.filter((p) => p.status === "completed").length;
  const stats = [
    { label: t.profile.stats.crews, value: count(crews.isSuccess, crews.data?.length ?? 0) },
    { label: t.profile.stats.planned, value: count(plansReady, mine.filter((p) => isUpcoming(p)).length) },
    { label: t.profile.stats.points, value: count(rewards.isSuccess, totalPoints(rewards.data)) },
  ];
  const links = [
    { to: "/settings", label: t.profile.links.settings, icon: IconSettings },
    { to: "/notifications", label: t.profile.links.notifications, icon: IconBell },
    { to: "/privacy", label: t.profile.links.privacy, icon: IconShield },
    { to: "/assistant", label: t.profile.links.assistant, icon: IconBot },
    ...(admin.data ? [{ to: "/admin", label: t.profile.links.admin, icon: IconShield }] : []),
  ];

  return (
    <div className="relative isolate max-w-2xl">
      <div className="home-glow" aria-hidden />
      {/*
        V2 Etappe 3h: Das Profil ist eine Stammkarte im Stil 2.0 – oben auf dem Stapel, Name in Chrom,
        Stadt und „Dabei seit“ als Glas-Pillen. Die erlebten Abende sind die große Kachel: lime erst ab dem
        ersten gemeinsamen Abend, davor gestrichelt (keine falsche Feier).
      */}
      <section aria-labelledby="profile-name" className="ticket-feature-wrap profile-pass" data-testid="profile-pass">
        <div className="vote-card overflow-hidden rounded-[32px] p-5 sm:p-7">
          <span aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-lime/15 blur-3xl" />
          <span aria-hidden className="pointer-events-none absolute -bottom-24 -left-16 size-56 rounded-full bg-pink/20 blur-3xl" />
          <div className="relative">
            <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-faint">{t.profile.pass.label}</p>
            <div className="mt-3 flex items-center gap-4">
              <Avatar person={me} size="lg" decorative className="shrink-0" />
              <h1 id="profile-name" className="display chrome min-w-0 break-words text-[27px] uppercase sm:text-[34px]">
                <PosterTitle text={me.display_name} />
              </h1>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <p className={cn(GLASS_PILL, "max-w-full")} data-testid="profile-city">
                <IconPin className="size-4 shrink-0" aria-hidden />
                <span className="min-w-0 truncate">{me.city ?? t.profile.noCity}</span>
              </p>
              <p className={GLASS_PILL} data-testid="profile-since">
                {t.profile.pass.since(formatMonthYear(me.created_at))}
              </p>
            </div>
            <p
              data-testid="profile-evenings"
              data-lit={evenings > 0 ? "true" : "false"}
              className={cn(
                "mt-5 flex items-center gap-4 rounded-[24px] p-4",
                evenings > 0 ? "bg-lime text-lime-ink" : "border border-dashed border-white/20 bg-white/[0.04] text-fg",
              )}
            >
              <span className="font-display text-[55px] font-extrabold leading-[0.85] sm:text-[66px]">{count(plansReady, evenings)}</span>{" "}
              <span className="text-[15px] font-bold uppercase leading-tight tracking-wide">{t.profile.pass.evenings(evenings)}</span>
            </p>
            <dl className="mt-3 grid grid-cols-3 gap-2">
              {stats.map((stat) => (
                <div key={stat.label} className="flex min-w-0 flex-col-reverse rounded-[20px] border border-white/10 bg-white/[0.05] p-3">
                  <dt className="mt-1 truncate text-[13px] text-muted">{stat.label}</dt>
                  <dd className="font-display text-[22px] font-extrabold leading-none text-fg sm:text-[26px]">{stat.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      <ButtonLink to="/settings" variant="secondary" className="mt-6" block>
        {t.profile.edit}
      </ButtonLink>

      <Section title={t.profile.interests}>
        {me.interests.length + me.favorite_categories.length === 0 ? (
          <p className="text-[15px] text-muted">{t.profile.noInterests}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {me.interests.map((interest) => (
              <span key={interest} className={cn(GLASS_PILL, "text-fg")}>
                {t.enums.interest[interest]}
              </span>
            ))}
            {me.favorite_categories.map((category) => (
              <span key={category} className="inline-flex h-9 items-center rounded-full border border-lime/40 bg-lime/10 px-3.5 text-[14px] font-semibold text-fg">
                {t.enums.category[category]}
              </span>
            ))}
          </div>
        )}
      </Section>

      {(crews.data?.length ?? 0) > 0 && (
        <Section title={t.profile.crews}>
          <div className="space-y-3">
            {crews.data?.map((crew) => (
              <CrewRow key={crew.id} crew={crew} />
            ))}
          </div>
        </Section>
      )}

      <nav className="mt-9 divide-y divide-line overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.04]" aria-label={t.profile.title} data-testid="profile-links">
        {links.map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to} className="flex h-16 items-center gap-3.5 px-4 font-medium text-fg hover:bg-raised">
            <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white/[0.06]">
              <Icon className="size-5 text-muted" />
            </span>
            <span className="flex-1">{label}</span>
            <IconChevronRight className="size-5 text-faint" aria-hidden />
          </Link>
        ))}
      </nav>

      <Button
        variant="ghost"
        className="mt-4"
        block
        onClick={() => {
          void signOut().then(() => navigate("/login", { replace: true }));
        }}
        icon={<IconLogout className="size-4" aria-hidden />}
      >
        {t.settings.account.signOut}
      </Button>
    </div>
  );
}
