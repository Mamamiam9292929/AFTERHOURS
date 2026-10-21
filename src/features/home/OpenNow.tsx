import { useMemo } from "react";
import { Link } from "react-router-dom";
import { IconCalendarPlus, IconClock, IconDiscover, IconRefresh } from "@/components/icons";
import { useActivitySearch } from "@/features/discover/api";
import { openLabel } from "@/features/discover/display";
import { rememberedCity } from "@/features/discover/rememberedCity";
import { useProfile } from "@/features/profile/api";
import { t } from "@/i18n";
import { openStateAt } from "@/lib/hours";
import { pickOpenNow } from "@/lib/opennow";
import { zonedParts } from "@/lib/time";
import type { Activity } from "@/lib/types";

const tx = t.home.spontaneous.openNow;

/**
 * S4 Etappe 2 · Steht die Runde, zeigt die Karte bis zu drei Orte in der eigenen Stadt, die laut
 * OpenStreetMap jetzt offen haben (und noch mindestens eine Stunde). Reicht das nicht, kommen Orte mit
 * unbekannten Öffnungszeiten dazu – ausdrücklich so beschriftet. Geschlossene Orte nie.
 * Stadt: aus dem Profil, sonst die zuletzt in Discover gewählte (nur im Browser).
 */
export function OpenNowPlaces({ crewId, note, now }: { crewId: string; note: string | null; now: Date }) {
  const profile = useProfile();
  const city = profile.data ? profile.data.city?.trim() || rememberedCity() : null;
  // Dieselbe Abfrage wie Discover ohne Kategorie: alle Orte der Stadt, vollständigste zuerst.
  const search = useActivitySearch(city ? { city } : null);
  const minute = Math.floor(now.getTime() / 60_000);

  const pick = useMemo(() => {
    if (!search.data) return null;
    const at = new Date(minute * 60_000);
    const { hour, minute: min } = zonedParts(at);
    const candidates = search.data.items.map((activity) => ({ activity, state: openStateAt(activity.opening_hours, at) }));
    return pickOpenNow<Activity>(candidates, hour * 60 + min, { note });
  }, [search.data, minute, note]);

  const headingId = `open-now-${crewId}`;

  if (profile.isPending) return null;
  if (!city) {
    return (
      <section className="ask-open mt-4" aria-labelledby={headingId} data-testid="open-now">
        <h4 id={headingId} className="text-[13px] font-bold uppercase tracking-wide text-fg">
          {tx.titleNoCity}
        </h4>
        <p className="mt-1 text-sm text-muted">{tx.noCity}</p>
        <Link to="/discover" className="ask-open-link mt-2">
          <IconDiscover className="size-4" aria-hidden />
          {tx.noCityAction}
        </Link>
      </section>
    );
  }

  const total = pick ? pick.open.length + pick.unknown.length : 0;

  return (
    <section className="ask-open mt-4" aria-labelledby={headingId} aria-busy={search.isPending || undefined} data-testid="open-now">
      <h4 id={headingId} className="text-[13px] font-bold uppercase tracking-wide text-fg">
        {pick && pick.open.length === 0 && pick.unknown.length > 0 ? tx.titleUnknown(city) : tx.title(city)}
      </h4>

      {search.isPending ? (
        <ul className="mt-2 space-y-2" aria-label={tx.loading}>
          {[0, 1].map((i) => (
            <li key={i} className="h-14 animate-pulse rounded-[18px] bg-raised" />
          ))}
        </ul>
      ) : search.isError ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="text-sm text-muted">{tx.error}</p>
          <button type="button" onClick={() => void search.refetch()} className="ask-open-link">
            <IconRefresh className="size-4" aria-hidden />
            {t.actions.retry}
          </button>
        </div>
      ) : search.data && search.data.total === 0 ? (
        <div className="mt-1">
          <p className="text-sm text-muted">{tx.noPlaces(city)}</p>
          <Link to="/discover" className="ask-open-link mt-2">
            <IconDiscover className="size-4" aria-hidden />
            {tx.toDiscover}
          </Link>
        </div>
      ) : total === 0 ? (
        <div className="mt-1">
          <p className="text-sm text-muted">{tx.none(city)}</p>
          <Link to="/discover" className="ask-open-link mt-2">
            <IconDiscover className="size-4" aria-hidden />
            {tx.toDiscover}
          </Link>
        </div>
      ) : (
        <>
          <ul className="mt-2 space-y-2">
            {pick?.open.map(({ activity }) => (
              <PlaceRow key={activity.id} activity={activity} crewId={crewId} status={openLabel(activity, now).text} open />
            ))}
            {pick?.unknown.map((activity) => (
              <PlaceRow key={activity.id} activity={activity} crewId={crewId} status={openLabel(activity, now).text} open={false} />
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-muted">{tx.source}</p>
        </>
      )}
    </section>
  );
}

function PlaceRow({ activity, crewId, status, open }: { activity: Activity; crewId: string; status: string; open: boolean }) {
  return (
    <li className="flex items-center gap-3 rounded-[18px] bg-raised py-2 pl-3.5 pr-2" data-testid="open-now-place" data-open={open ? "true" : "false"}>
      <div className="min-w-0 flex-1">
        <Link to={`/activities/${activity.id}`} className="block truncate text-[15px] font-bold text-fg underline-offset-2 hover:underline">
          {activity.name}
        </Link>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] font-medium text-muted">
          <span>{t.enums.category[activity.category]}</span>
          <span className={open ? "ask-open-pill" : "inline-flex items-center gap-1"}>
            <IconClock className="size-3.5" aria-hidden />
            {status}
          </span>
          {activity.is_demo && <span className="rounded-full border border-line-strong px-1.5 text-[11px] font-bold uppercase text-fg">{t.states.demo}</span>}
        </p>
      </div>
      <Link
        to={`/plans/new?crew=${crewId}&activity=${activity.id}&soon=1`}
        className="ask-open-link shrink-0"
        aria-label={tx.planHereLabel(activity.name)}
      >
        <IconCalendarPlus className="size-4" aria-hidden />
        {tx.planHere}
      </Link>
    </li>
  );
}
