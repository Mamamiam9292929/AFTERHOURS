import { useId, useMemo, useState } from "react";
import { IconChevronDown, IconExternal, IconNavigation } from "@/components/icons";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { detectPlatform, directionsLinks, type DirectionsTarget, type Platform } from "@/lib/directions";

function currentPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  return detectPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0);
}

/**
 * P41 · „Wie komm ich hin?“: aufklappbare Auswahl der Karten-Apps mit der Route zum Ort – die für das Gerät
 * wahrscheinlichste zuerst (iPhone: Apple Karten, Android: Karten-App des Systems). Nichts wird vorab geladen;
 * erst der Tipp auf einen Link schickt den Ort an den Anbieter. Ohne Punkt und ohne Adresse: nichts.
 */
export function Directions({ target, className }: { target: DirectionsTarget; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const links = useMemo(() => directionsLinks(target, currentPlatform()), [target]);
  if (links.length === 0) return null;

  return (
    <div className={cn("mt-1", className)} data-testid="directions">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-fit items-center gap-1.5 text-sm font-semibold text-fg underline decoration-line-strong underline-offset-4 hover:decoration-lime"
      >
        <IconNavigation className="size-4 text-lime" aria-hidden />
        {t.plans.detail.route.open}
        <IconChevronDown className={cn("size-4 transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div id={id} className="mt-1">
          <ul aria-label={t.plans.detail.route.label} className="flex flex-wrap gap-2">
            {links.map((link, i) => (
              <li key={link.app}>
                <a
                  href={link.url}
                  target={link.app === "device" ? undefined : "_blank"}
                  rel="noopener noreferrer"
                  data-app={link.app}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-colors",
                    i === 0 ? "border-lime bg-lime text-lime-ink hover:bg-lime-press" : "border-white/[0.12] bg-white/[0.06] text-fg hover:border-lime/60",
                  )}
                >
                  {t.plans.detail.route.apps[link.app]}
                  {link.app !== "device" && <IconExternal className="size-3.5" aria-hidden />}
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[13px] text-faint">{t.plans.detail.route.hint}</p>
        </div>
      )}
    </div>
  );
}
