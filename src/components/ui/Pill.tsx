import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * V2 · Eigenschaften im Kopf einer Karte als Glas-Pille (geteilte Abstimmung, geteilter Plan, Einladung).
 * Als Klasse, damit sie auf `p`, `span` oder `li` sitzen kann.
 */
export const GLASS_PILL = "inline-flex h-9 items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3.5 text-[14px] font-semibold text-muted";

/**
 * V2 · Was gerade zählt (Frist, Countdown) als Lime-Pille mit pulsierendem Punkt. Der Punkt steht still,
 * wenn reduzierte Bewegung gewünscht ist.
 */
export function LivePill({ children, className, testId }: { children: ReactNode; className?: string; testId?: string }) {
  return (
    <span className={cn("inline-flex h-9 items-center gap-2 rounded-full bg-lime px-3.5 text-[13px] font-bold text-lime-ink", className)} data-testid={testId}>
      <span aria-hidden className="size-2 animate-pulse rounded-full bg-lime-ink motion-reduce:animate-none" />
      {children}
    </span>
  );
}
