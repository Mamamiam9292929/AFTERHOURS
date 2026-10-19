import { Component, type ReactNode } from "react";
import { useRouteError } from "react-router-dom";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Logo } from "@/components/ui/Logo";
import { t } from "@/i18n";

function Shell({ title, body, action }: { title: string; body: string; action: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-10">
      <Logo compact />
      <h1 className="display chrome mt-10 text-[32px]">{title}</h1>
      <p className="mt-3 text-[15px] leading-snug text-muted">{body}</p>
      <div className="mt-7">{action}</div>
    </div>
  );
}

export function NotFoundPage() {
  return <Shell title={t.notFound.title} body={t.notFound.body} action={<ButtonLink to="/home">{t.notFound.action}</ButtonLink>} />;
}

function CrashScreen() {
  return <Shell title={t.crash.title} body={t.crash.body} action={<Button onClick={() => window.location.reload()}>{t.crash.action}</Button>} />;
}

/** Fehler beim Rendern oder Laden einer Route – ohne technische Details für Nutzer. */
export function RouteError() {
  const error = useRouteError();
  // Bewusst auch im Produktivbetrieb: Ohne Konsoleneintrag wäre ein Absturz nicht nachvollziehbar.
  console.error("[AFTERHOURS] Fehler beim Anzeigen einer Seite:", error);
  return <CrashScreen />;
}

/** Letztes Netz für alles außerhalb des Routers. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("[AFTERHOURS] Unbehandelter Fehler:", error);
  }
  render() {
    return this.state.failed ? <CrashScreen /> : this.props.children;
  }
}

/** Solange .env.local fehlt: klare Anweisung statt eines kryptischen Netzwerkfehlers. */
export function SetupScreen() {
  return <Shell title={t.setup.title} body={t.setup.body} action={<code className="block rounded-control border border-line bg-surface p-4 text-[13px] leading-relaxed text-muted">VITE_SUPABASE_URL=…<br />VITE_SUPABASE_ANON_KEY=…</code>} />;
}
