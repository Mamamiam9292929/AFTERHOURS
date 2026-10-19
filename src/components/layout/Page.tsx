import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { IconBack } from "@/components/icons";
import { cn } from "@/lib/cn";

interface PageHeaderProps {
  title: ReactNode;
  /** Kurze Einordnung unter dem Titel – nur, wenn sie etwas erklärt, das der Titel nicht sagt. */
  lead?: ReactNode;
  back?: { to: string; label: string };
  actions?: ReactNode;
  className?: string;
  /** Plakat-Überschrift (D0): Versalien, größer; das Schlüsselwort setzt der Aufrufer in Lime. */
  poster?: boolean;
}

/** Seitentitel in der Display-Schrift, optional mit Rückweg und Aktionen. */
export function PageHeader({ title, lead, back, actions, className, poster }: PageHeaderProps) {
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
          <h1 className={cn("display chrome break-words", poster ? "text-[34px] uppercase sm:text-[48px]" : "text-[30px] sm:text-[40px]")}>{title}</h1>
          {lead && <div className="mt-2.5 text-[15px] leading-snug text-muted">{lead}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/**
 * Plakat-Überschrift (D0) aus einem Text, den die Crew selbst geschrieben hat: Das letzte Wort wird in
 * Lime gesetzt („Was machen wir am **Samstag?**“). Satzzeichen am Ende bleiben weiß; der Text selbst –
 * und damit der barrierefreie Name der Überschrift – bleibt unverändert.
 */
export function PosterTitle({ text }: { text: string }) {
  const match = /^(.*\s)(\S*?[\p{L}\p{N}][\S]*?)([?!.…:]*)$/u.exec(text.trim());
  if (!match) return <>{text}</>;
  const [, lead, key, tail] = match;
  return (
    <>
      {lead}
      <span className="text-lime">{key}</span>
      {tail}
    </>
  );
}

/** Plakat-Überschrift aus Teilen: `key` in Lime. Die Teile kommen aus echten Daten, nie Dekor. */
export function PosterLine({ lead = "", keyword, tail = "" }: { lead?: string; keyword: string; tail?: string }) {
  return (
    <>
      {lead}
      <span className="text-lime">{keyword}</span>
      {tail}
    </>
  );
}

/** Abschnitt mit Überschrift und optionalem Link rechts. */
export function Section({ id, title, action, children, className }: { id?: string; title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    // Mit `id` als Sprungziel (z. B. /plans/<id>#kosten): Abstand für die feste Kopfleiste auf dem Handy.
    <section id={id} className={cn("mt-9 first:mt-0", id && "scroll-mt-20 lg:scroll-mt-6", className)}>
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

/**
 * Zeile aus Icon, Beschriftung und Wert – für die "Was/Wann/Wo"-Übersichten. Steht in einem <dl>;
 * <dt>/<dd> sind direkte Kinder der Zeile (HTML erlaubt nur eine <div>-Ebene dazwischen), das Icon
 * sitzt deshalb absolut im <dt>.
 */
export function Fact({ icon, label, children, className }: { icon: ReactNode; label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("relative min-w-0 py-3.5 pl-[50px]", className)}>
      <dt className="text-[13px] font-medium text-muted">
        <span aria-hidden className="absolute left-0 top-4 flex size-9 items-center justify-center rounded-full bg-raised text-muted [&>svg]:size-[18px]">
          {icon}
        </span>
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-[15px] leading-snug text-fg">{children}</dd>
    </div>
  );
}
