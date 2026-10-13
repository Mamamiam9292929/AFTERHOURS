import { Link, useNavigate } from "react-router-dom";
import { IconBell, IconBot, IconChevronRight, IconLogout, IconPin, IconSettings, IconShield } from "@/components/icons";
import { PosterTitle, Section } from "@/components/layout/Page";
import { Avatar } from "@/components/ui/Avatar";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Badge, ErrorState, PageSpinner } from "@/components/ui/Feedback";
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
        D0 Etappe 5c: Das Profil ist eine Stammkarte im Ticket-Stil – der eine große Moment der Seite.
        Der Abriss zählt die erlebten Abende; lime wird er erst ab dem ersten gemeinsamen Abend.
      */}
      <div className="ticket-feature-wrap">
        <div className="ticket ticket-feature profile-pass">
          <div className={cn("ticket-stub flex flex-col items-center justify-center gap-1 px-2 py-5 text-center", evenings > 0 ? "bg-lime text-lime-ink" : "bg-raised text-fg")}>
            <p className="flex flex-col items-center">
              <span className="font-display text-[76px] font-extrabold leading-[0.85] sm:text-[92px]">{count(plansReady, evenings)}</span>{" "}
              <span className="mt-1 text-[13px] font-bold uppercase leading-tight tracking-wide">{t.profile.pass.evenings(evenings)}</span>
            </p>
            <span className="ticket-barcode mt-3" aria-hidden />
          </div>
          <div className="flex min-w-0 flex-col gap-4 p-5 sm:p-6">
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:gap-4">
              <Avatar person={me} size="lg" decorative className="shrink-0" />
              <div className="min-w-0">
                <h1 className="display break-words text-[36px] uppercase text-fg sm:text-[52px]">
                  <PosterTitle text={me.display_name} />
                </h1>
                <p className="mt-1.5 flex items-center gap-1.5 text-[15px] text-muted">
                  <IconPin className="size-4 shrink-0" aria-hidden />
                  <span className="min-w-0 truncate">{me.city ?? t.profile.noCity}</span>
                </p>
                <p className="mt-0.5 text-[13px] text-muted">{t.profile.pass.since(formatMonthYear(me.created_at))}</p>
              </div>
            </div>
            <dl className="grid grid-cols-3 gap-2 border-t border-dashed border-line pt-4">
              {stats.map((stat) => (
                <div key={stat.label} className="flex min-w-0 flex-col-reverse">
                  <dt className="mt-1 truncate text-[13px] text-muted">{stat.label}</dt>
                  <dd className="font-display text-[30px] font-extrabold leading-none text-fg sm:text-[36px]">{stat.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>

      <ButtonLink to="/settings" variant="secondary" className="mt-6" block>
        {t.profile.edit}
      </ButtonLink>

      <Section title={t.profile.interests}>
        {me.interests.length + me.favorite_categories.length === 0 ? (
          <p className="text-[15px] text-muted">{t.profile.noInterests}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {me.interests.map((interest) => (
              <Badge key={interest} tone="outline" className="h-8 px-3 text-sm text-fg">
                {t.enums.interest[interest]}
              </Badge>
            ))}
            {me.favorite_categories.map((category) => (
              <Badge key={category} className="h-8 px-3 text-sm">
                {t.enums.category[category]}
              </Badge>
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

      <nav className="mt-9 divide-y divide-line rounded-card border border-line bg-surface" aria-label={t.profile.title}>
        {links.map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to} className="flex h-14 items-center gap-3.5 px-4 font-medium text-fg hover:bg-raised/50">
            <Icon className="size-5 text-muted" aria-hidden />
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
