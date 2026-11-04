import { useMemo } from "react";
import { Link } from "react-router-dom";
import { IconForward, IconPlane } from "@/components/icons";
import { Avatar } from "@/components/ui/Avatar";
import { ErrorState } from "@/components/ui/Feedback";
import { PanelCard } from "@/components/ui/PanelCard";
import { PANEL_ITEM, StatusPill } from "@/features/plans/PlanPanel";
import { usePeople } from "@/features/profile/api";
import { t } from "@/i18n";
import { awaySoon, type AwaySoon } from "@/lib/absences";
import { cn } from "@/lib/cn";
import { useNow } from "@/lib/hooks";
import { addDays, formatPlainDate, zonedParts } from "@/lib/time";
import { useCrewAbsences } from "./absencesApi";

const tx = t.crews.detail.away;

function when(a: AwaySoon, today: string): string {
  const tomorrow = addDays(today, 1);
  if (a.now) return a.ends_on === today ? tx.untilToday : a.ends_on === tomorrow ? tx.untilTomorrow : tx.until(formatPlainDate(a.ends_on));
  return a.starts_on === tomorrow ? tx.fromTomorrow : tx.from(formatPlainDate(a.starts_on));
}

/**
 * P21 Etappe 2 · „Gerade weg“ auf der Crew-Übersicht: wer laut „Bin weg“ heute weg ist oder in den nächsten
 * 14 Tagen wegfährt – nur Tage, ohne Grund (mehr speichert der Server nicht). Nur für Mitglieder (`crew_absences`).
 * Ohne Abwesende, solange geladen wird: nichts. Fehler: kurzer Fehlerzustand mit „Nochmal“.
 */
export function CrewAway({ crewId, userId, memberIds }: { crewId: string; userId: string; memberIds: readonly string[] }) {
  const absences = useCrewAbsences(crewId);
  const people = usePeople();
  const now = useNow(60_000);
  const today = zonedParts(now).date;
  const list = useMemo(
    () => awaySoon(absences.data ?? [], today, 14, [userId, ...memberIds]).filter((a) => memberIds.includes(a.user_id)),
    [absences.data, today, userId, memberIds],
  );

  if (absences.isPending) return null;
  if (absences.isError) {
    return (
      <div className="mt-9 max-w-2xl">
        <ErrorState error={absences.error} onRetry={() => void absences.refetch()} />
      </div>
    );
  }
  if (list.length === 0) return null;

  return (
    <div className="mt-9 max-w-2xl">
      <PanelCard id="weg" title={list.some((a) => a.now) ? tx.titleNow : tx.titleSoon} icon={<IconPlane />} tone="violet" lead={tx.lead} testId="crew-away">
        <ul className="grid gap-1.5">
          {list.map((a) => {
            const self = a.user_id === userId;
            const person = people.lookup(a.user_id);
            return (
              <li key={a.user_id} data-testid="crew-away-row" className={cn(PANEL_ITEM, "flex flex-wrap items-center gap-3 px-4 py-3")}>
                <Avatar person={person} size="sm" decorative />
                <span className="min-w-0 flex-1 basis-32">
                  <span className="block truncate font-semibold text-fg">{self ? tx.you : (person?.display_name ?? t.states.formerMember)}</span>
                  <span className="block text-[13px] text-muted">{tx.range(formatPlainDate(a.starts_on), formatPlainDate(a.ends_on))}</span>
                </span>
                <StatusPill tone={a.now ? "lime" : "glass"}>{when(a, today)}</StatusPill>
              </li>
            );
          })}
        </ul>
        {!list.some((a) => a.user_id === userId) && (
          <Link
            to="/settings#absences"
            data-testid="crew-away-add"
            className={cn(PANEL_ITEM, "mt-3 flex min-h-12 items-center gap-3 px-4 py-2.5 text-sm font-semibold text-fg hover:bg-raised focus-visible:bg-raised")}
          >
            <span className="min-w-0 flex-1">{tx.addOwn}</span>
            <IconForward className="size-4 shrink-0 text-faint" aria-hidden />
          </Link>
        )}
      </PanelCard>
    </div>
  );
}
