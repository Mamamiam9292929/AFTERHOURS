import { Suspense, type ComponentType } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { IconBell, IconCrews, IconDiscover, IconHome, IconPlans, IconRewards, IconShield } from "@/components/icons";
import { Avatar } from "@/components/ui/Avatar";
import { PageSpinner } from "@/components/ui/Feedback";
import { Logo } from "@/components/ui/Logo";
import { useUnreadCount } from "@/features/notifications/api";
import { useIsAdmin, useProfile } from "@/features/profile/api";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  /** Pfad-Präfixe, die ebenfalls zu diesem Bereich gehören. */
  match: string[];
}

const NAV: NavItem[] = [
  { to: "/home", label: t.nav.home, icon: IconHome, match: ["/home"] },
  { to: "/discover", label: t.nav.discover, icon: IconDiscover, match: ["/discover", "/activities"] },
  { to: "/crews", label: t.nav.crews, icon: IconCrews, match: ["/crews", "/join"] },
  { to: "/plans", label: t.nav.plans, icon: IconPlans, match: ["/plans", "/polls"] },
  { to: "/rewards", label: t.nav.rewards, icon: IconRewards, match: ["/rewards"] },
];

function useActiveSection(): string | null {
  const { pathname } = useLocation();
  return NAV.find((item) => item.match.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)))?.to ?? null;
}

function UnreadDot({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-lime px-1 text-[11px] font-bold text-lime-ink" aria-hidden>
      {count > 9 ? "9+" : count}
    </span>
  );
}

/** App-Rahmen: Seitenleiste ab Desktop, obere Leiste und untere Navigation auf Smartphone und Tablet. */
export function AppShell() {
  const active = useActiveSection();
  const unread = useUnreadCount();
  const profile = useProfile();
  const admin = useIsAdmin();
  const { pathname } = useLocation();
  const bellLabel = unread > 0 ? t.notifications.bellUnread(unread) : t.nav.notifications;

  return (
    <div className="min-h-dvh lg:pl-64">
      <a href="#content" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-control focus:bg-lime focus:px-4 focus:py-2 focus:font-semibold focus:text-lime-ink">
        {t.nav.skipToContent}
      </a>

      {/* Desktop: Seitenleiste */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-nav px-4 py-6 lg:flex">
        <Link to="/home" className="px-2">
          <Logo />
        </Link>
        <nav aria-label={t.nav.main} className="mt-10 flex flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              aria-current={active === to ? "page" : undefined}
              className={cn(
                "flex h-12 items-center gap-3 rounded-control px-3 text-[15px] font-semibold transition-colors",
                active === to ? "bg-raised text-fg" : "text-muted hover:bg-surface hover:text-fg",
              )}
            >
              <Icon className={cn("size-5", active === to && "text-lime")} aria-hidden />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-1">
          {admin.data && (
            <NavLink to="/admin" className={({ isActive }) => cn("flex h-11 items-center gap-3 rounded-control px-3 text-sm font-semibold", isActive ? "bg-raised text-fg" : "text-muted hover:bg-surface hover:text-fg")}>
              <IconShield className="size-5" aria-hidden />
              {t.nav.admin}
            </NavLink>
          )}
          <NavLink to="/notifications" aria-label={bellLabel} className={({ isActive }) => cn("flex h-11 items-center gap-3 rounded-control px-3 text-sm font-semibold", isActive ? "bg-raised text-fg" : "text-muted hover:bg-surface hover:text-fg")}>
            <span className="relative">
              <IconBell className="size-5" aria-hidden />
              <UnreadDot count={unread} />
            </span>
            {t.nav.notifications}
          </NavLink>
          <NavLink to="/profile" className={({ isActive }) => cn("mt-2 flex items-center gap-3 rounded-control border border-line px-3 py-2.5", isActive ? "bg-raised" : "hover:bg-surface")}>
            <Avatar person={profile.data} size="sm" decorative />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-fg">{profile.data?.display_name ?? "…"}</span>
              <span className="block text-xs text-muted">{t.nav.profile}</span>
            </span>
          </NavLink>
        </div>
      </aside>

      {/* Smartphone/Tablet: obere Leiste */}
      <header className="sticky top-0 z-30 border-b border-line bg-base pt-safe lg:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <Link to="/home" aria-label={t.nav.home}>
            <Logo compact />
          </Link>
          <div className="flex items-center gap-1">
            <Link to="/notifications" aria-label={bellLabel} className="relative inline-flex size-11 items-center justify-center rounded-full text-fg hover:bg-raised">
              <span className="relative">
                <IconBell className="size-[22px]" aria-hidden />
                <UnreadDot count={unread} />
              </span>
            </Link>
            <Link to="/profile" aria-label={t.nav.profile} className="inline-flex size-11 items-center justify-center rounded-full">
              <Avatar person={profile.data} size="sm" decorative />
            </Link>
          </div>
        </div>
      </header>

      <main id="content" tabIndex={-1} className="mx-auto w-full max-w-[1080px] px-4 pb-32 pt-5 outline-none sm:px-6 lg:px-10 lg:pb-16 lg:pt-10">
        <Suspense fallback={<PageSpinner />} key={pathname}>
          <Outlet />
        </Suspense>
      </main>

      {/* Smartphone/Tablet: untere Navigation */}
      <nav aria-label={t.nav.main} className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-nav pb-safe lg:hidden">
        <ul className="mx-auto grid max-w-xl grid-cols-5">
          {NAV.map(({ to, label, icon: Icon }) => {
            const isActive = active === to;
            return (
              <li key={to}>
                <Link to={to} aria-current={isActive ? "page" : undefined} className={cn("relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold tracking-wide", isActive ? "text-fg" : "text-faint")}>
                  <span className={cn("absolute top-0 h-[3px] w-8 rounded-b-full transition-colors", isActive ? "bg-lime" : "bg-transparent")} aria-hidden />
                  <Icon className={cn("size-[22px]", isActive && "text-lime")} aria-hidden />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
