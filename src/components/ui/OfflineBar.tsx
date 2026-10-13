import { IconOffline } from "@/components/icons";
import { t } from "@/i18n";
import { useOnline } from "@/lib/pwa";

/** W4: Ohne Netz sagt ein schmaler Streifen oben, warum nichts lädt – statt endloser Ladekreise. */
export function OfflineBar() {
  const online = useOnline();
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-0 z-[80] flex justify-center px-4 pt-safe">
      {!online && (
        <p className="mt-2 flex items-center gap-2 rounded-full bg-amber px-4 py-2 text-[13px] font-semibold text-amber-ink shadow-lg">
          <IconOffline className="size-4 shrink-0" aria-hidden />
          {t.home.offline}
        </p>
      )}
    </div>
  );
}
