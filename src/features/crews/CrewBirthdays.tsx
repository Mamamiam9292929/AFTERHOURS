import { useMemo } from "react";
import { Link } from "react-router-dom";
import { IconCake, IconForward } from "@/components/icons";
import { Avatar } from "@/components/ui/Avatar";
import { ButtonLink } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/Feedback";
import { PanelCard } from "@/components/ui/PanelCard";
import { PANEL_ITEM, StatusPill } from "@/features/plans/PlanPanel";
import { usePeople } from "@/features/profile/api";
import { t } from "@/i18n";
import { upcomingBirthdays } from "@/lib/birthdays";
import { cn } from "@/lib/cn";
import { useNow } from "@/lib/hooks";
import { formatPlainDate, zonedParts } from "@/lib/time";
import { useCrewBirthdays, useMyBirthday } from "./birthdaysApi";

const tx = t.crews.detail.birthdays;

/** „Feier planen“: Termin-Abstimmung für die Crew rund um den Geburtstag (`PollCreatePage` liest `birthday`/`for`). */
export function birthdayPollLink(crewId: string, date: string, name: string): string {
  const params = new URLSearchParams({ crew: crewId, kind: "date", birthday: date, for: name });
  return `/polls/new?${params.toString()}`;
}

/**
 * P20 · „Bald Geburtstag“ auf der Crew-Übersicht: wer aus der Crew in den nächsten 30 Tagen Geburtstag hat
 * (nur Tag und Monat, heute zuerst), mit „Feier planen“ – für die anderen, nicht für sich selbst. Hat die
 * Person selbst keinen eingetragen, steht darunter (bzw. allein) ein Hinweis mit Link zu den Einstellungen.
 * Solange geladen wird, bleibt der Platz leer – wie bei den offenen Beträgen.
 */
export function CrewBirthdays({ crewId, userId }: { crewId: string; userId: string }) {
  const birthdays = useCrewBirthdays(crewId);
  const mine = useMyBirthday();
  const people = usePeople();
  const now = useNow(60_000);
  const today = zonedParts(now).date;
  const upcoming = useMemo(() => upcomingBirthdays(birthdays.data ?? [], today), [birthdays.data, today]);

  if (birthdays.isPending || mine.isPending) return null;
  if (birthdays.isError) {
    return (
      <div className="mt-9 max-w-2xl">
        <ErrorState error={birthdays.error} onRetry={() => void birthdays.refetch()} />
      </div>
    );
  }
  const missingOwn = !mine.isError && mine.data === null;
  if (upcoming.length === 0 && !missingOwn) return null;

  const when = (inDays: number) => (inDays === 0 ? tx.today : inDays === 1 ? tx.tomorrow : tx.inDays(inDays));

  return (
    <div className="mt-9 max-w-2xl">
      <PanelCard
        id="geburtstage"
        title={tx.title}
        icon={<IconCake />}
        tone="pink"
        lead={upcoming.some((b) => b.user_id !== userId) ? tx.lead : undefined}
        testId="crew-birthdays"
      >
        {upcoming.length > 0 && (
          <ul className="grid gap-1.5">
            {upcoming.map((b) => {
              const person = people.lookup(b.user_id);
              const self = b.user_id === userId;
              const name = person?.display_name ?? t.states.formerMember;
              return (
                <li key={b.user_id} data-testid="crew-birthday" className={cn(PANEL_ITEM, "flex flex-wrap items-center gap-3 px-4 py-3")}>
                  <Avatar person={person} size="sm" decorative />
                  <span className="min-w-0 flex-1 basis-32">
                    <span className="block truncate font-semibold text-fg">{self ? tx.yourDay : name}</span>
                    <span className="block text-[13px] text-muted">{formatPlainDate(b.date, "long")}</span>
                  </span>
                  <StatusPill tone={b.inDays === 0 ? "lime" : "glass"}>{when(b.inDays)}</StatusPill>
                  {!self && (
                    <ButtonLink to={birthdayPollLink(crewId, b.date, name)} size="sm" variant="secondary" aria-label={tx.planLabel(name)}>
                      {tx.plan}
                    </ButtonLink>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {missingOwn && (
          <Link
            to="/settings#birthday"
            data-testid="crew-birthday-add"
            className={cn(PANEL_ITEM, "flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-raised focus-visible:bg-raised", upcoming.length > 0 && "mt-3")}
          >
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-fg">{tx.addOwn}</span>
              <span className="block text-[13px] leading-snug text-muted">{tx.addOwnBody}</span>
            </span>
            <IconForward className="size-4 shrink-0 text-faint" aria-hidden />
          </Link>
        )}
      </PanelCard>
    </div>
  );
}
