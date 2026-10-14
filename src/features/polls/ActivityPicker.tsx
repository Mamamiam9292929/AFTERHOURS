import { useEffect, useState } from "react";
import { IconCheck, IconSearch, IconSpinner } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { DemoBadge, ErrorState, ListSkeleton, Notice } from "@/components/ui/Feedback";
import { useActivitySearch, usePlaceRegion } from "@/features/discover/api";
import { CityField } from "@/features/discover/CityField";
import { priceLabel } from "@/features/discover/display";
import { useProfile } from "@/features/profile/api";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { useDebouncedValue } from "@/lib/hooks";
import type { Activity } from "@/lib/types";

/** Ortssuche im Dialog: Stadt wählen, suchen, Orte an- und abwählen. Genutzt von der Abstimmung und vom geführten Start (W5). */
export function ActivityPicker({
  open,
  onClose,
  selectedIds,
  onToggle,
  initialCity,
}: {
  open: boolean;
  onClose: () => void;
  selectedIds: Set<string>;
  onToggle: (activity: Activity) => void;
  /** Stadt, mit der die Suche beginnt; sonst die aus dem Profil. */
  initialCity?: string | null;
}) {
  const profile = useProfile();
  const [city, setCity] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [added, setAdded] = useState(0);
  const query = useDebouncedValue(search, 300);
  useEffect(() => {
    const start = initialCity?.trim() || profile.data?.city?.trim();
    if (city === null && start) setCity(start);
  }, [city, profile.data, initialCity]);
  const places = usePlaceRegion(open ? city : null);
  useEffect(() => {
    if (places.canonicalName && city && places.canonicalName.toLocaleLowerCase("de") !== city.toLocaleLowerCase("de")) setCity(places.canonicalName);
  }, [places.canonicalName, city]);
  const activities = useActivitySearch(open && city ? { city, query, limit: 50 } : null);
  const list = activities.data?.items ?? [];

  useEffect(() => {
    if (open) setAdded(0);
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} title={t.polls.create.pickerTitle} size="lg" footer={<Button onClick={onClose}>{t.polls.create.pickerDone(added)}</Button>}>
      <div className="mb-4 grid gap-3 sm:grid-cols-[200px_minmax(0,1fr)]">
        <CityField value={city} onCommit={(next) => setCity(next)} />
        <div className="relative">
          <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-faint" aria-hidden />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} disabled={!city} aria-label={t.polls.create.pickerSearch} placeholder={t.polls.create.pickerSearch} className="h-12 w-full rounded-control border border-line bg-surface pl-11 pr-3 text-fg placeholder:text-faint focus:border-lime focus:outline-none disabled:opacity-50" />
        </div>
      </div>
      {places.importing && city && (
        <Notice tone="lime" icon={<IconSpinner className="animate-spin" aria-hidden />} title={t.discover.sync.loading(city)} className="mb-4">
          {t.discover.sync.loadingBody}
        </Notice>
      )}
      {places.syncError && !places.importing && (
        <Notice tone="amber" title={city ? t.discover.sync.failedTitle(city) : undefined} className="mb-4">
          {errorMessage(places.syncError)}
        </Notice>
      )}
      {!city ? (
        <p className="py-6 text-center text-sm text-muted">{t.discover.cityPrompt.body}</p>
      ) : activities.isPending ? (
        <ListSkeleton rows={4} height="h-14" />
      ) : activities.isError ? (
        <ErrorState error={activities.error} onRetry={() => void activities.refetch()} />
      ) : list.length === 0 ? (
        places.importing ? null : <p className="py-6 text-center text-sm text-muted">{t.polls.create.pickerEmpty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((activity) => {
            const selected = selectedIds.has(activity.id);
            return (
              <li key={activity.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setAdded((n) => n + (selected ? -1 : 1));
                    onToggle(activity);
                  }}
                  className="flex min-h-14 w-full items-center gap-3 py-2.5 text-left"
                >
                  <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border", selected ? "border-lime bg-lime text-lime-ink" : "border-line-strong")}>
                    {selected && <IconCheck className="size-3.5" strokeWidth={3} aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-semibold text-fg">{activity.name}</span>
                      {activity.is_demo && <DemoBadge />}
                    </span>
                    <span className="block truncate text-[13px] text-muted">
                      {t.enums.category[activity.category]}
                      {activity.city ? `, ${activity.city}` : ""} – {priceLabel(activity)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
