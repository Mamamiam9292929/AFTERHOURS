import { cn } from "@/lib/cn";

/**
 * Bildmarke: ein "A" aus zwei Wegen, die sich treffen – darunter der Punkt, an dem man sich trifft.
 * Funktioniert einfarbig, als App-Icon und ab 16px.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cn("size-8", className)} aria-hidden focusable="false">
      <rect width="48" height="48" rx="12" fill="var(--color-lime)" />
      <path d="M11.5 37 21.2 11h5.6L36.5 37h-6.1L24 18.6 17.6 37z" fill="var(--color-lime-ink)" />
      <circle cx="24" cy="33.2" r="3.4" fill="var(--color-lime-ink)" />
    </svg>
  );
}

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className={compact ? "size-7" : "size-8"} />
      <span className={cn("font-display font-extrabold tracking-[0.04em] text-fg", compact ? "text-[22px]" : "text-[26px]")} aria-label="AFTERHOURS">
        AFTERHOURS
      </span>
    </span>
  );
}
