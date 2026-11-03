import { Link } from "react-router-dom";
import { IconCalendarCheck } from "@/components/icons";
import { t } from "@/i18n";
import type { BusyHit } from "@/lib/busy";
import { cn } from "@/lib/cn";
import { formatPlainTime } from "@/lib/time";

/**
 * P18: Unter einem Vorschlag, wenn du zu dem Termin schon etwas vorhast – „Schon verplant: Kino, 19:30 Uhr“
 * (überschneidet sich) bzw. „Am selben Tag: Brunch, 11:00 Uhr“. Führt zum Plan. Aus einer anderen Crew
 * steht sie dahinter. Nur für dich: gerechnet im Browser aus deinen eigenen Plänen (`src/lib/busy.ts`).
 */
export function OptionBusy({ hit, crewLabel, tone = "card" }: { hit: BusyHit | null; crewLabel?: string | null; tone?: "card" | "deck" }) {
  if (!hit) return null;
  const b = t.polls.detail.busy;
  const time = formatPlainTime(hit.time);
  const text = hit.kind === "overlap" ? b.overlap(hit.plan.title, time) : b.day(hit.plan.title, time);
  return (
    <p
      className={cn(
        "mt-1 flex items-start gap-1.5 text-sm",
        tone === "deck" ? "font-bold text-white" : hit.kind === "overlap" ? "font-semibold text-fg" : "text-muted",
      )}
      data-testid="poll-option-busy"
      data-kind={hit.kind}
    >
      <IconCalendarCheck className="mt-1 size-4 shrink-0" aria-hidden />
      <span className={cn("min-w-0", tone === "deck" && "py-0.5")}>
        {tone === "deck" ? (
          // Im Kartenstapel nur Text: Karten dahinter sind für Screenreader ausgeblendet (kein fokussierbarer Link
          // darin), und ein Tipp soll wischen, nicht springen. Der Link steht unten auf der Karte des Vorschlags.
          text
        ) : (
          <Link to={`/plans/${hit.plan.id}`} className="inline-block py-0.5 underline decoration-line-strong underline-offset-4 hover:decoration-lime">
            {text}
          </Link>
        )}
        {crewLabel && <> · {crewLabel}</>}
        {hit.more > 0 && <> · {b.more(hit.more)}</>}
      </span>
    </p>
  );
}
