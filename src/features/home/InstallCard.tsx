import { useState } from "react";
import { IconDownload, IconPhoneApp } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { useInstall } from "@/lib/pwa";

const KEY = "afterhours.install-dismissed";
const QUIET_DAYS = 30;

function dismissedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < QUIET_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

/**
 * W4 · „Auf den Homescreen“: erscheint auf Home erst, wenn du in einer Crew bist (dann gibt es einen
 * Grund wiederzukommen), nur wenn der Browser die Installation anbietet oder es Safari auf iOS ist,
 * und nach „Nicht jetzt“ 30 Tage lang nicht. Kein Drängeln, kein Countdown.
 */
export function InstallCard({ className }: { className?: string }) {
  const { state, install } = useInstall();
  const toast = useToast();
  const [hidden, setHidden] = useState(dismissedRecently);
  const [busy, setBusy] = useState(false);
  if (hidden || state === "unavailable") return null;

  function dismiss() {
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      /* dann eben nur für diese Sitzung */
    }
    setHidden(true);
  }

  async function onInstall() {
    setBusy(true);
    const accepted = await install().catch(() => false);
    setBusy(false);
    if (accepted) toast.success(t.home.install.done);
    else dismiss();
  }

  return (
    <section aria-labelledby="install-title" className={cn("flex gap-4 rounded-card border border-line bg-surface p-5 sm:p-6", className)}>
      <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-lime text-lime-ink" aria-hidden>
        <IconPhoneApp className="size-6" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 id="install-title" className="display text-[19px] leading-tight text-fg">
          {t.home.install.title}
        </h2>
        <p className="mt-2 text-[15px] leading-snug text-muted">{state === "ios" ? t.home.install.iosBody : t.home.install.body}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {state === "prompt" ? (
            <>
              <Button size="sm" icon={<IconDownload className="size-4" aria-hidden />} loading={busy} onClick={() => void onInstall()}>
                {t.home.install.action}
              </Button>
              <Button size="sm" variant="ghost" onClick={dismiss} disabled={busy}>
                {t.home.install.later}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="secondary" onClick={dismiss}>
              {t.home.install.ok}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
