import { lazy, Suspense, useEffect } from "react";
import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { PageSpinner } from "@/components/ui/Feedback";
import { useAuth } from "@/features/auth/AuthProvider";
import { PublicOnly, RequireAuth, RequireOnboarded } from "@/features/auth/guards";
import { DraftBar } from "@/features/polls/DraftBar";
import { NotFoundPage, RouteError } from "./errors";
import { preloadWhenIdle, smoothNavigation } from "./transitions";

/*
 * Jede Seite ist ein eigener Chunk und wird erst geladen, wenn sie gebraucht wird.
 * Die Anmeldeseiten liegen gemeinsam in einem Chunk.
 */
/*
 * Ist der Chunk schon da (vorgeladen oder einmal besucht), rendert die Seite sofort – ohne den einen
 * Suspense-Durchlauf, den React.lazy sonst immer braucht. Das hält Seitenwechsel ohne Spinner (D7).
 */
function page<T extends Record<string, unknown>, K extends keyof T>(load: () => Promise<T>, name: K) {
  let loaded: React.ComponentType | null = null;
  let pending: Promise<React.ComponentType> | null = null;
  const preload = () => (pending ??= load().then((module) => (loaded = module[name] as React.ComponentType)));
  const Lazy = lazy(async () => ({ default: await preload() }));
  function Page() {
    const Loaded = loaded;
    return Loaded ? <Loaded /> : <Lazy />;
  }
  return Object.assign(Page, { preload });
}

const authPages = () => import("@/features/auth/pages");
const LoginPage = page(authPages, "LoginPage");
const RegisterPage = page(authPages, "RegisterPage");
const CheckEmailPage = page(authPages, "CheckEmailPage");
const ForgotPasswordPage = page(authPages, "ForgotPasswordPage");
const AuthConfirmPage = page(authPages, "AuthConfirmPage");
const ResetPasswordPage = page(authPages, "ResetPasswordPage");

const LandingPage = page(() => import("@/features/landing/LandingPage"), "LandingPage");
const OnboardingPage = page(() => import("@/features/onboarding/OnboardingPage"), "OnboardingPage");
const HomePage = page(() => import("@/features/home/HomePage"), "HomePage");
const QuickStartPage = page(() => import("@/features/home/QuickStartPage"), "QuickStartPage");
const DiscoverPage = page(() => import("@/features/discover/DiscoverPage"), "DiscoverPage");
const ActivityDetailPage = page(() => import("@/features/discover/ActivityDetailPage"), "ActivityDetailPage");
const CrewsPage = page(() => import("@/features/crews/CrewsPage"), "CrewsPage");
const CrewDetailPage = page(() => import("@/features/crews/CrewDetailPage"), "CrewDetailPage");
const JoinPage = page(() => import("@/features/crews/JoinPage"), "JoinPage");
const InviteLandingPage = page(() => import("@/features/crews/InviteLandingPage"), "InviteLandingPage");
const PollCreatePage = page(() => import("@/features/polls/PollCreatePage"), "PollCreatePage");
const PollDetailPage = page(() => import("@/features/polls/PollDetailPage"), "PollDetailPage");
const PlansPage = page(() => import("@/features/plans/PlansPage"), "PlansPage");
const PlanCreatePage = page(() => import("@/features/plans/PlanCreatePage"), "PlanCreatePage");
const PlanDetailPage = page(() => import("@/features/plans/PlanDetailPage"), "PlanDetailPage");
const SharedPlanPage = page(() => import("@/features/plans/SharedPlanPage"), "SharedPlanPage");
const SharedPollPage = page(() => import("@/features/polls/SharedPollPage"), "SharedPollPage");
const RewardsPage = page(() => import("@/features/rewards/RewardsPage"), "RewardsPage");
const NotificationsPage = page(() => import("@/features/notifications/NotificationsPage"), "NotificationsPage");
const ProfilePage = page(() => import("@/features/profile/ProfilePage"), "ProfilePage");
const SettingsPage = page(() => import("@/features/profile/SettingsPage"), "SettingsPage");
const PrivacyPage = page(() => import("@/features/profile/PrivacyPage"), "PrivacyPage");
const AdminPage = page(() => import("@/features/admin/AdminPage"), "AdminPage");
const AssistantPage = page(() => import("@/features/assistant/AssistantPage"), "AssistantPage");

/** W6: „/“ ist ohne Konto die öffentliche Startseite, mit Konto geht es direkt zu Home. */
function Root() {
  const { loading, user } = useAuth();
  if (loading) return <PageSpinner />;
  if (user) return <Navigate to="/home" replace />;
  return <LandingPage />;
}

function Standalone() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <Outlet />
    </Suspense>
  );
}

/** Seiten, die man aus der Navigation und von Tickets aus öffnet – im Leerlauf vorgeladen (D7). */
const PRELOAD = () => [HomePage, DiscoverPage, CrewsPage, CrewDetailPage, PlansPage, PlanDetailPage, PollDetailPage].map((p) => p.preload);

function AppLayout() {
  useEffect(() => preloadWhenIdle(PRELOAD()), []);
  return (
    <>
      <AppShell />
      <DraftBar />
    </>
  );
}

export const router = createBrowserRouter([
  {
    element: <Standalone />,
    errorElement: <RouteError />,
    children: [
      { path: "/", element: <Root /> },
      {
        element: <PublicOnly />,
        children: [
          { path: "/login", element: <LoginPage /> },
          { path: "/register", element: <RegisterPage /> },
          { path: "/check-email", element: <CheckEmailPage /> },
          { path: "/forgot-password", element: <ForgotPasswordPage /> },
        ],
      },
      { path: "/auth/confirm", element: <AuthConfirmPage /> },
      { path: "/auth/reset", element: <ResetPasswordPage /> },
      { path: "/privacy", element: <PrivacyPage /> },
      // W1: Einladung ohne Konto – Angemeldete leitet die Seite selbst zu /join/<token> weiter.
      { path: "/invite/:token", element: <InviteLandingPage /> },
      // W2: geteilter Plan – Mitglieder leitet die Seite zum Plan weiter, alle anderen sehen die Karte.
      { path: "/s/:token", element: <SharedPlanPage /> },
      // W2 Etappe 2: geteilte Abstimmung – Mitglieder leitet die Seite zur Abstimmung weiter.
      { path: "/v/:token", element: <SharedPollPage /> },
      {
        element: <RequireAuth />,
        children: [
          { path: "/onboarding", element: <OnboardingPage /> },
          {
            element: <RequireOnboarded />,
            children: [
              {
                element: <AppLayout />,
                children: [
                  { path: "/home", element: <HomePage /> },
                  { path: "/start", element: <QuickStartPage /> },
                  { path: "/discover", element: <DiscoverPage /> },
                  { path: "/activities/:activityId", element: <ActivityDetailPage /> },
                  { path: "/crews", element: <CrewsPage /> },
                  { path: "/crews/:crewId", element: <CrewDetailPage /> },
                  { path: "/join/:token", element: <JoinPage /> },
                  { path: "/polls/new", element: <PollCreatePage /> },
                  { path: "/polls/:pollId", element: <PollDetailPage /> },
                  { path: "/plans", element: <PlansPage /> },
                  { path: "/plans/new", element: <PlanCreatePage /> },
                  { path: "/plans/:planId", element: <PlanDetailPage /> },
                  { path: "/rewards", element: <RewardsPage /> },
                  { path: "/notifications", element: <NotificationsPage /> },
                  { path: "/profile", element: <ProfilePage /> },
                  { path: "/settings", element: <SettingsPage /> },
                  { path: "/assistant", element: <AssistantPage /> },
                  { path: "/admin", element: <AdminPage /> },
                ],
              },
            ],
          },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

smoothNavigation(router);
