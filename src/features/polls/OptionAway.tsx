import { IconPlane } from "@/components/icons";
import type { Person } from "@/components/ui/Avatar";
import { t } from "@/i18n";
import { awayOn, type Absence } from "@/lib/absences";
import { cn } from "@/lib/cn";

/**
 * P21 · Unter einem Termin in einer laufenden Abstimmung: wer da laut „Bin weg“ nicht da ist – „Nicht da:
 * Bob, Carol“ (du zuerst als „du“). Ohne Termin oder ohne Abwesende: nichts. Gerechnet im Browser aus
 * `crew_absences` (nur Mitglieder der Crew, nur laufende und kommende Zeiträume).
 */
export function awayLine(
  date: string | null | undefined,
  absences: readonly Absence[] | undefined,
  memberIds: readonly string[],
  userId: string,
  lookup: (id: string) => Person | null | undefined,
  tone: "card" | "deck" = "card",
) {
  if (!absences || absences.length === 0) return null;
  // Nur, wer (noch) in der Crew ist; du zuerst, dann in der Reihenfolge der Mitglieder.
  const ids = awayOn(absences, date, [userId, ...memberIds]).filter((id) => memberIds.includes(id));
  if (ids.length === 0) return null;
  const a = t.polls.detail.away;
  const names = ids.map((id) => (id === userId ? a.you : (lookup(id)?.display_name ?? t.states.formerMember)));
  return (
    <p
      className={cn("mt-1 flex items-start gap-1.5 text-sm", tone === "deck" ? "font-bold text-white" : ids.includes(userId) ? "font-semibold text-fg" : "text-muted")}
      data-testid="poll-option-away"
    >
      <IconPlane className="mt-1 size-4 shrink-0" aria-hidden />
      <span className="min-w-0 py-0.5">{a.line(names)}</span>
    </p>
  );
}
