import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * V2 Etappe 3g · Bereiche der Planseite (Kosten teilen, Reservierung, Fahrgemeinschaften) als Glas-Karten
 * aus dem Deck: eigener Farbschein je Bereich (`data-tone`, nur als Licht – nie als Textfarbe), Symbol in
 * einer Kachel, Überschrift in der Display-Schrift. Die Überschrift bleibt ein `h2`, damit Sprungziele und
 * Screenreader-Navigation gleich bleiben.
 */
export function PlanPanel({ id, title, icon, tone, children }: { id?: string; title: string; icon: ReactNode; tone: "lime" | "violet" | "pink"; children: ReactNode }) {
  const headingId = `${id ?? tone}-panel-heading`;
  return (
    <section id={id} aria-labelledby={headingId} data-tone={tone} className={cn("plan-panel mt-6 rounded-[28px] border border-white/[0.08] p-4 sm:p-5", id && "scroll-mt-20 lg:scroll-mt-6")}>
      <div className="mb-4 flex items-center gap-3">
        <span aria-hidden className="plan-panel-icon grid size-10 shrink-0 place-items-center rounded-[14px] text-fg [&>svg]:size-[18px]">
          {icon}
        </span>
        <h2 id={headingId} className="display text-[17px] uppercase text-fg sm:text-[19px]">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

/** Innere Karte in einem Bereich (eine Fahrt, ein Eintrag, der Stand): dunkles Glas, runder als früher. */
export const PANEL_ITEM = "rounded-[20px] border border-white/10 bg-white/[0.04]";

type PillTone = "glass" | "lime" | "amber" | "danger";

/**
 * Status als Pille wie im Kopf der Abstimmung: Lime gefüllt heißt „steht“ (bestätigt, Plätze frei),
 * Gelb heißt „läuft noch“, Rot „hat nicht geklappt“, Glas ist neutral.
 */
export function StatusPill({ tone = "glass", children, className, testId }: { tone?: PillTone; children: ReactNode; className?: string; testId?: string }) {
  return (
    <span
      data-testid={testId}
      data-tone={tone}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-bold whitespace-nowrap",
        tone === "glass" && "border border-white/15 bg-white/[0.06] text-muted",
        tone === "lime" && "bg-lime text-lime-ink",
        tone === "amber" && "border border-amber/45 bg-amber/10 text-amber",
        tone === "danger" && "border border-danger/45 bg-danger/10 text-danger",
        className,
      )}
    >
      {children}
    </span>
  );
}
