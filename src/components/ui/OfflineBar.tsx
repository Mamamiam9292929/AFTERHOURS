import { IconOffline, IconRefresh } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { t } from "@/i18n";
import { useOfflineSnapshotTime } from "@/lib/offline";
import { useOnline, useUpdateReady } from "@/lib/pwa";
import { calendarDaysBetween, formatDateTime, formatTime } from "@/lib/time";

/**
 * W4: Streifen oben für den Zustand der App selbst.
 * - Ohne Netz: warum nichts lädt – und, wenn ein gespeicherter Stand angezeigt wird, von wann er ist.
 * - Neue Version: Hinweis mit „Neu laden“, statt still mit der alten weiterzulaufen.
 */
export function OfflineBar() {
  const online = useOnline();
  const savedAt = useOfflineSnapshotTime();
  const updateReady = useUpdateReady();
  const saved = savedAt === null ? null : new Date(savedAt);
  const when = saved === null ? null : calendarDaysBetween(saved, new Date()) === 0 ? formatTime(saved) : formatDateTime(saved);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-0 z-[80] flex flex-col items-center px-4 pt-safe">
      {!online && (
        <p className="mt-2 flex items-center gap-2 rounded-full bg-amber px-4 py-2 text-[13px] font-semibold text-amber-ink shadow-lg">
          <IconOffline className="size-4 shrink-0" aria-hidden />
          {when ? t.home.offlineSaved(when) : t.home.offline}
        </p>
      )}
      {updateReady && online && (
        <div className="pointer-events-auto mt-2 flex items-center gap-3 rounded-full border border-line-strong bg-raised py-1.5 pl-4 pr-1.5 text-[13px] font-semibold text-fg shadow-lg">
          <span>{t.home.update.body}</span>
          <Button size="sm" className="rounded-full" icon={<IconRefresh className="size-4" aria-hidden />} onClick={() => window.location.reload()}>
            {t.home.update.action}
          </Button>
        </div>
      )}
    </div>
  );
}
