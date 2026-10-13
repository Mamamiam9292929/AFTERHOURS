import { useEffect, useRef } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ErrorState, PageSpinner } from "@/components/ui/Feedback";
import { useProfile } from "@/features/profile/api";
import { useAuth } from "./AuthProvider";
import { clearNext, peekNext, rememberNext } from "./next";

/** Alles dahinter erfordert eine Anmeldung. Das ursprüngliche Ziel wird für danach gemerkt. */
export function RequireAuth() {
  const { loading, user } = useAuth();
  const location = useLocation();
  if (loading) return <PageSpinner />;
  if (!user) {
    const target = location.pathname + location.search;
    if (target !== "/" && target !== "/home") rememberNext(target);
    // W1: Einladungslinks führen ohne Konto auf die Landingpage statt auf die Anmeldung.
    const invite = INVITE_PATH.exec(location.pathname);
    if (invite) return <Navigate to={`/invite/${invite[1]}`} replace />;
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}

const INVITE_PATH = /^\/join\/([0-9a-f]{64})\/?$/;

/** Die App selbst ist erst nach dem Onboarding erreichbar. */
export function RequireOnboarded() {
  const profile = useProfile();
  const location = useLocation();
  if (profile.isPending) return <PageSpinner />;
  if (profile.isError) {
    return (
      <div className="mx-auto max-w-md p-6">
        <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />
      </div>
    );
  }
  if (!profile.data.onboarded_at) {
    const target = location.pathname + location.search;
    if (target !== "/" && target !== "/home") rememberNext(target);
    return <Navigate to="/onboarding" replace />;
  }
  return <Outlet />;
}

/** Anmeldeseiten: wer schon angemeldet ist, wird dorthin gebracht, wo er hinwollte. */
export function PublicOnly() {
  const { loading, user } = useAuth();
  if (loading) return <PageSpinner />;
  if (user) return <ContinueAfterAuth />;
  return <Outlet />;
}

/**
 * Leitet nach Anmeldung/Bestätigung zum gemerkten Ziel weiter (sonst zu Home). Das Ziel wird
 * seiteneffektfrei gelesen und erst im Effekt verbraucht – so bleibt es auch dann richtig, wenn
 * React den Effekt im Entwicklungsmodus doppelt ausführt.
 */
export function ContinueAfterAuth() {
  const navigate = useNavigate();
  const target = useRef<string | null>(null);
  if (target.current === null) target.current = peekNext() ?? "/home";
  useEffect(() => {
    clearNext();
    navigate(target.current ?? "/home", { replace: true });
  }, [navigate]);
  return <PageSpinner />;
}
