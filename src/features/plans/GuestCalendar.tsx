import { useState } from "react";
import { IconCalendarPlus, IconRefresh } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { t } from "@/i18n";
import { downloadIcs } from "@/lib/ics";
import { type GuestIcsPlan, type GuestIcsStamp, guestIcsChanges, guestIcsStamp, guestPlanIcs, icsFileName, parseGuestIcsStamp } from "@/lib/icsformat";
import { siteUrl } from "@/lib/supabase";
import { formatDateTime } from "@/lib/time";

/** Auf dem Gerät gemerkt: mit welchem Stand der Termin zuletzt heruntergeladen wurde (nur Plan-Angaben, kein Name). */
const stampKey = (token: string) => `afterhours.planguest.ics.${token}`;

function readStamp(token: string): GuestIcsStamp | null {
  try {
    return parseGuestIcsStamp(localStorage.getItem(stampKey(token)));
  } catch {
    return null;
  }
}

function writeStamp(token: string, stamp: GuestIcsStamp) {
  try {
    localStorage.setItem(stampKey(token), JSON.stringify(stamp));
  } catch {
    // Privates Fenster o. Ä.: Dann sieht der Gast später keinen Änderungshinweis – die Datei ist trotzdem da.
  }
}

/**
 * P27 · „In meinen Kalender“ für Gäste ohne Konto (W10). Die Datei entsteht im Browser aus genau dem, was die
 * Zusagekarte ohnehin zeigt (Titel, Zeit, Ort, Adresse, Treffpunkt) plus eigener Antwort und Link zurück – keine
 * Namen der Crew, nichts geht an einen Server. Ohne Konto gibt es kein Abo; deshalb merkt sich das Gerät den Stand
 * der Datei, und ändert sich Zeit, Ort oder Titel, sagt die Karte das und bietet die neue Datei an.
 */
export function GuestCalendar({ token, plan, answer, open }: { token: string; plan: GuestIcsPlan; answer: string; open: boolean }) {
  const toast = useToast();
  const [stamp, setStamp] = useState(() => readStamp(token));
  const cancelled = plan.status === "cancelled";

  // Abgesagt: nur, wer den Termin schon geladen hat, braucht den Hinweis.
  if (cancelled) {
    if (!stamp) return null;
    return (
      <p className="vote-card p-4 text-sm font-semibold leading-snug text-fg" data-answer="no" data-testid="rsvp-calendar-cancelled" role="status">
        {t.planGuests.calendar.cancelled}
      </p>
    );
  }
  if (!open || (answer !== "going" && answer !== "maybe")) return null;

  const changes = guestIcsChanges(stamp, plan);
  const changeText = changes.map((change) => t.planGuests.calendar.changes[change]);
  const what = changeText.length > 1 ? `${changeText.slice(0, -1).join(", ")} ${t.planGuests.calendar.and} ${changeText.at(-1)}` : (changeText[0] ?? "");

  function download() {
    const url = `${siteUrl()}/s/${token}`;
    const file = t.planGuests.calendar.file;
    const labels = { meetingPoint: file.meetingPoint, link: file.link, noUpdates: file.noUpdates, answer: answer === "going" ? file.going : file.maybe };
    downloadIcs(guestPlanIcs(plan, { token, url, answer: answer as "going" | "maybe", labels }), icsFileName(plan.title));
    const next = guestIcsStamp(plan);
    writeStamp(token, next);
    setStamp(next);
    toast.success(t.planGuests.calendar.done);
  }

  return (
    <div className="vote-card p-4 sm:p-5" data-answer={changes.length > 0 ? "maybe" : undefined} data-testid="rsvp-calendar">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">{t.planGuests.calendar.title}</p>
      {changes.length > 0 ? (
        <p className="mt-1.5 text-[15px] font-semibold leading-snug text-fg" data-testid="rsvp-calendar-changed" role="status">
          {t.planGuests.calendar.changed(what)}
        </p>
      ) : stamp ? (
        <p className="mt-1.5 text-[15px] leading-snug text-muted" data-testid="rsvp-calendar-saved">
          {t.planGuests.calendar.saved(formatDateTime(stamp.starts_at))}
        </p>
      ) : (
        <p className="mt-1.5 text-[15px] leading-snug text-muted">{t.planGuests.calendar.body}</p>
      )}
      <Button
        variant={changes.length > 0 ? "primary" : "secondary"}
        block
        className="mt-3"
        onClick={download}
        icon={changes.length > 0 ? <IconRefresh className="size-4" aria-hidden /> : <IconCalendarPlus className="size-4" aria-hidden />}
      >
        {changes.length > 0 ? t.planGuests.calendar.update : t.planGuests.calendar.add}
      </Button>
    </div>
  );
}
