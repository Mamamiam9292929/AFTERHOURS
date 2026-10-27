import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * V2 · Bereich einer Seite als Glas-Karte aus dem Deck – wie die Bereiche der Planseite und der Einstellungen
 * (`plan-panel`): eigener Farbschein (`tone`, nur als Licht, nie als Textfarbe), Symbol auf einer Glas-Kachel,
 * Überschrift (`h2`) in der Display-Schrift, rechts optional der Stand als Pille.
 */
export function PanelCard({
  id,
  title,
  icon,
  tone = "violet",
  status,
  lead,
  testId,
  className,
  children,
}: {
  id: string;
  title: string;
  icon: ReactNode;
  tone?: "violet" | "pink" | "lime";
  status?: ReactNode;
  lead?: ReactNode;
  testId?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} data-tone={tone} data-testid={testId} className={cn("plan-panel scroll-mt-24 rounded-[28px] border border-white/[0.08] p-4 sm:p-6", className)}>
      <div className="flex flex-wrap items-center gap-3">
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full border border-white/15 bg-white/[0.06] text-fg [&>svg]:size-5">
          {icon}
        </span>
        <h2 id={`${id}-title`} className="display mr-auto min-w-0 text-[17px] uppercase text-fg sm:text-[19px]">
          {title}
        </h2>
        {status}
      </div>
      {lead && <div className="mt-3 max-w-prose text-sm leading-snug text-muted">{lead}</div>}
      <div className="mt-4">{children}</div>
    </section>
  );
}
