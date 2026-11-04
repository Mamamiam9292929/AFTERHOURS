import { useMemo } from "react";
import { IconCake } from "@/components/icons";
import { PanelCard } from "@/components/ui/PanelCard";
import { useMyCrewBirthdays } from "@/features/crews/birthdaysApi";
import { BirthdayRow } from "@/features/crews/CrewBirthdays";
import type { Person } from "@/components/ui/Avatar";
import { t } from "@/i18n";
import { homeBirthdays } from "@/lib/birthdays";
import type { Crew } from "@/lib/types";

/**
 * P20 Etappe 2 · „Bald Geburtstag“ auf Home: wer aus deinen Crews heute bis in 7 Tagen Geburtstag hat – jede
 * Person einmal, mit der Crew, in der gefeiert wird, und „Feier planen“. So weit vorher kommt auch die
 * Erinnerung. Nichts in Sicht oder Fehler beim Laden: keine Karte (Home bleibt ruhig; die Crew-Seite zeigt
 * die Geburtstage mit Fehlerzustand). Solange geladen wird, bleibt der Platz leer.
 */
export function HomeBirthdays({
  crews,
  userId,
  today,
  lookup,
}: {
  crews: readonly Crew[];
  userId: string;
  today: string;
  lookup: (id: string) => Person | null;
}) {
  const birthdays = useMyCrewBirthdays(crews.length > 0);
  const crewOrder = useMemo(() => crews.map((crew) => crew.id), [crews]);
  const upcoming = useMemo(() => homeBirthdays(birthdays.data ?? [], today, userId, crewOrder), [birthdays.data, today, userId, crewOrder]);
  if (upcoming.length === 0) return null;
  const crewName = (id: string) => crews.find((crew) => crew.id === id)?.name;

  return (
    <div className="mt-9 first:mt-0">
      <PanelCard id="geburtstage" title={t.home.birthdays.title} icon={<IconCake />} tone="pink" lead={t.home.birthdays.lead} testId="home-birthdays">
        <ul className="grid gap-1.5">
          {upcoming.map((b) => (
            <BirthdayRow key={b.user_id} birthday={b} crewId={b.crew_id} person={lookup(b.user_id)} self={false} crewName={crewName(b.crew_id)} />
          ))}
        </ul>
      </PanelCard>
    </div>
  );
}
