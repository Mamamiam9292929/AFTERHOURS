import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { cityCenter } from "@/data/cities";
import { CATEGORIES, INTEREST_CATEGORIES } from "@/data/options";
import { useActivitySearch, usePlaceRegion } from "@/features/discover/api";
import { placesProvider } from "@/features/discover/provider";
import { useProfile, useSettings } from "@/features/profile/api";
import { t } from "@/i18n";
import { formatEuro } from "@/lib/format";
import { distanceKm } from "@/lib/geo";
import { qk } from "@/lib/query";
import type { Activity, ActivityCategory } from "@/lib/types";

export interface Ideas {
  activities: { activity: Activity; distanceKm: number | null }[];
  reasons: string[];
}

/**
 * Vorschläge: je ein Ort aus bis zu drei Kategorien in der eigenen Stadt – bevorzugt passend zu
 * Interessen und Budget. Fehlen Angaben, wird der jeweilige Filter weggelassen, und die Begründung
 * nennt nur, was wirklich berücksichtigt wurde. Innerhalb einer Kategorie wechselt der Vorschlag täglich.
 */
export function useIdeas(): { ideas: Ideas | null; isPending: boolean; city: string | null; importing: boolean } {
  const profile = useProfile();
  const settings = useSettings();
  const city = profile.data?.city?.trim() || null;
  const places = usePlaceRegion(city);
  const overview = useActivitySearch(city ? { city, limit: 1 } : null);

  const wanted = useMemo(
    () => new Set<ActivityCategory>([...(profile.data?.favorite_categories ?? []), ...(profile.data?.interests ?? []).flatMap((i) => INTEREST_CATEGORIES[i])]),
    [profile.data],
  );
  const counts = overview.data?.categories;
  const { chosen, usedInterests } = useMemo(() => {
    const available = CATEGORIES.filter((c) => (counts?.[c] ?? 0) > 0);
    const preferred = available.filter((c) => wanted.has(c));
    const usedInterests = preferred.length > 0;
    const rest = available.filter((c) => !wanted.has(c)).sort((a, b) => (counts?.[b] ?? 0) - (counts?.[a] ?? 0));
    return { chosen: [...preferred, ...rest].slice(0, 3), usedInterests };
  }, [counts, wanted]);

  const perCategory = useQueries({
    queries: chosen.map((category) => ({
      queryKey: qk.activitySearch(city ?? "", category, "", 30),
      enabled: Boolean(city),
      staleTime: 5 * 60_000,
      queryFn: () => placesProvider.search({ city: city ?? "", category, limit: 30 }),
    })),
  });

  const loaded = perCategory.every((q) => q.data);
  const ideas = useMemo<Ideas | null>(() => {
    if (!city || !overview.data || !loaded) return null;
    const reasons = [t.home.ideasReason.city(city)];
    if (usedInterests) reasons.push(t.home.ideasReason.interests);
    const budget = settings.data?.typical_budget_cents;
    let budgetUsed = false;
    const day = Math.floor(Date.now() / 86_400_000);
    const origin = cityCenter(city);
    const picked = perCategory.flatMap((q) => {
      let pool: Activity[] = q.data?.items ?? [];
      if (budget != null) {
        const affordable = pool.filter((a) => a.price_min_cents != null && a.price_min_cents <= budget);
        if (affordable.length > 0) {
          pool = affordable;
          budgetUsed = true;
        }
      }
      // Die vollständigsten Einträge stehen vorn; daraus täglich ein anderer.
      const top = pool.slice(0, 10);
      const activity = top[day % Math.max(top.length, 1)];
      if (!activity) return [];
      const distance = origin && activity.latitude != null && activity.longitude != null ? distanceKm(origin, { latitude: activity.latitude, longitude: activity.longitude }) : null;
      return [{ activity, distanceKm: distance }];
    });
    if (budgetUsed && budget != null) reasons.push(t.home.ideasReason.budget(formatEuro(budget)));
    return { activities: picked, reasons };
    // perCategory ändert bei jedem Render die Identität; loaded + Daten genügen als Auslöser.
  }, [city, overview.data, loaded, usedInterests, settings.data, perCategory.map((q) => q.dataUpdatedAt).join()]);

  const isPending = profile.isPending || (Boolean(city) && (overview.isPending || !loaded) && !(overview.data && chosen.length === 0));
  return { ideas, isPending: isPending && !places.importing, city, importing: places.importing };
}
