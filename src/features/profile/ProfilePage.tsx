import { Link, useNavigate } from "react-router-dom";
import { IconBell, IconBot, IconChevronRight, IconLogout, IconPin, IconSettings, IconShield } from "@/components/icons";
import { Section } from "@/components/layout/Page";
import { Avatar } from "@/components/ui/Avatar";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Badge, ErrorState, PageSpinner } from "@/components/ui/Feedback";
import { useAuth } from "@/features/auth/AuthProvider";
import { useCrews } from "@/features/crews/api";
import { CrewRow } from "@/features/crews/CrewsPage";
import { isUpcoming, usePlans } from "@/features/plans/api";
import { totalPoints, useRewards } from "@/features/rewards/RewardsPage";
import { t } from "@/i18n";
import { formatNumber } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
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
  const stats = [
    { label: t.profile.stats.crews, value: crews.data?.length ?? 0 },
    { label: t.profile.stats.planned, value: mine.filter((p) => isUpcoming(p)).length },
    { label: t.profile.stats.completed, value: mine.filter((p) => p.status === "completed").length },
    { label: t.profile.stats.points, value: totalPoints(rewards.data) },
  ];
  const links = [
    { to: "/settings", label: t.profile.links.settings, icon: IconSettings },
    { to: "/notifications", label: t.profile.links.notifications, icon: IconBell },
    { to: "/privacy", label: t.profile.links.privacy, icon: IconShield },
    { to: "/assistant", label: t.profile.links.assistant, icon: IconBot },
    ...(admin.data ? [{ to: "/admin", label: t.profile.links.admin, icon: IconShield }] : []),
  ];

  return (
    <div className="max-w-2xl">
      <header className="flex items-center gap-5">
        <Avatar person={me} size="xl" decorative />
        <div className="min-w-0">
          <h1 className="display break-words text-[44px] text-fg sm:text-[52px]">{me.display_name}</h1>
          <p className="mt-1.5 flex items-center gap-1.5 text-[15px] text-muted">
            <IconPin className="size-4 shrink-0" aria-hidden />
            {me.city ?? t.profile.noCity}
          </p>
        </div>
      </header>

      <dl className="mt-7 grid grid-cols-4 divide-x divide-line rounded-card border border-line bg-surface">
        {stats.map((stat) => (
          <div key={stat.label} className="px-2 py-4 text-center">
            <dd className="font-display text-[34px] font-extrabold leading-none text-fg">{formatNumber(stat.value)}</dd>
            <dt className="mt-1.5 text-[13px] text-muted">{stat.label}</dt>
          </div>
        ))}
      </dl>

      <ButtonLink to="/settings" variant="secondary" className="mt-4" block>
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
