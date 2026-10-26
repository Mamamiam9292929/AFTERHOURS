import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * V2 Etappe 3m · Ein Abschnitt eines Formulars (Plan anlegen, Crew gründen) als Glas-Karte aus dem Deck –
 * wie die Bereiche der Planseite: Farbschein je Abschnitt (`data-tone`, nur als Licht, nie als Textfarbe),
 * Symbol auf einer Glas-Kachel, Überschrift in der Display-Schrift.
 *
 * Technisch ein `fieldset` mit `legend`, damit Screenreader die Felder als Gruppe ansagen. `min-w-0`, weil
 * ein `fieldset` sonst nicht schmaler als sein Inhalt wird und auf 390 px seitlich überläuft.
 * `flat`: ohne Karte (im Dialog, der schon eine Fläche ist) – nur Überschrift und Abstand.
 */
export function FormCard({
  title,
  icon,
  tone = "violet",
  flat = false,
  testId,
  className,
  children,
}: {
  title: string;
  icon: ReactNode;
  tone?: "lime" | "violet" | "pink";
  flat?: boolean;
  testId?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <fieldset
      data-tone={tone}
      data-testid={testId}
      className={cn("min-w-0", flat ? "border-t border-white/[0.08] pt-5 first:border-t-0 first:pt-0" : "plan-panel rounded-[28px] border border-white/[0.08] p-4 sm:p-5", className)}
    >
      <legend className={cn("float-left flex w-full items-center gap-3 p-0", flat ? "mb-3" : "mb-4")}>
        <span aria-hidden className={cn("grid shrink-0 place-items-center rounded-full border border-white/15 bg-white/[0.06] text-fg", flat ? "size-8" : "size-10")}>
          {icon}
        </span>
        <span className={cn("display uppercase text-fg", flat ? "text-[15px]" : "text-[16px] sm:text-[18px]")}>{title}</span>
      </legend>
      {/* `float` am legend holt ihn in die Karte (statt auf den Rand); der Inhalt beginnt darunter. */}
      <div className="clear-both space-y-4">{children}</div>
    </fieldset>
  );
}

/** Auswahl in einem Formular (Crew, Verbindlichkeit, Symbol): dunkles Glas, gewählt mit Lime-Kante. */
export const CHOICE_CARD = "rounded-[20px] border border-white/10 bg-white/[0.04] transition-colors hover:border-white/25";
export const CHOICE_CARD_ON = "border-lime bg-lime/[0.08] hover:border-lime";
