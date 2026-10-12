import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { IconBack } from "@/components/icons";
import { cn } from "@/lib/cn";

interface PageHeaderProps {
  title: string;
  /** Kurze Einordnung unter dem Titel – nur, wenn sie etwas erklärt, das der Titel nicht sagt. */
  lead?: ReactNode;
  back?: { to: string; label: string };
  actions?: ReactNode;
  className?: string;
}

/** Seitentitel in der Display-Schrift, optional mit Rückweg und Aktionen. */
export function PageHeader({ title, lead, back, actions, className }: PageHeaderProps) {
  return (
    <header className={cn("mb-6 lg:mb-8", className)}>
      {back && (
        <Link to={back.to} className="-ml-1 mb-3 inline-flex h-9 items-center gap-1.5 rounded-control px-1 text-sm font-semibold text-muted hover:text-fg">
          <IconBack className="size-4" aria-hidden />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 max-w-2xl">
          <h1 className="display break-words text-[40px] text-fg sm:text-[52px]">{title}</h1>
          {lead && <div className="mt-2.5 text-[15px] leading-snug text-muted">{lead}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** Abschnitt mit Überschrift und optionalem Link rechts. */
export function Section({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("mt-9 first:mt-0", className)}>
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="text-[17px] font-bold text-fg">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function SectionLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex h-9 items-center text-sm font-semibold text-muted underline-offset-4 hover:text-fg hover:underline">
      {children}
    </Link>
  );
}

/** Zeile aus Icon, Beschriftung und Wert – für die "Was/Wann/Wo"-Übersichten. */
export function Fact({ icon, label, children, className }: { icon: ReactNode; label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex gap-3.5 py-3.5", className)}>
      <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-raised text-muted [&>svg]:size-[18px]">{icon}</div>
      <div className="min-w-0 flex-1">
        <dt className="text-[13px] font-medium text-muted">{label}</dt>
        <dd className="mt-0.5 break-words text-[15px] leading-snug text-fg">{children}</dd>
      </div>
    </div>
  );
}
