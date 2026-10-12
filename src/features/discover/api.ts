import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { cityCenter } from "@/data/cities";
import { distanceKm, type LatLng } from "@/lib/geo";
import { openStateAt } from "@/lib/hours";
import { qk } from "@/lib/query";
import type { Activity, ActivityCategory } from "@/lib/types";
import { placesProvider, type ActivitySearch } from "./provider";

/** Orte einer Stadt (serverseitig gefiltert und sortiert). Ohne Stadt wird nichts geladen. */
export function useActivitySearch(search: ActivitySearch | null) {
  const city = search?.city.trim() ?? "";
  const category = search?.category ?? null;
  const query = search?.query?.trim() ?? "";
  const limit = search?.limit ?? 300;
  return useQuery({
    queryKey: qk.activitySearch(city, category, query, limit),
    enabled: city.length >= 2,
    staleTime: 5 * 60_000,
    placeholderData: (previous) => previous,
    queryFn: () => placesProvider.search({ city, category, query, limit }),
  });
}

export function useActivity(id: string | null | undefined) {
  return useQuery({
    queryKey: qk.activity(id ?? "none"),
    enabled: Boolean(id),
    staleTime: 5 * 60_000,
    queryFn: () => placesProvider.get(id ?? ""),
  });
}

// Pro Sitzung wird jede Stadt höchstens einmal automatisch importiert – Fehler führen nicht zu Schleifen.
const autoSynced = new Set<string>();

/**
 * Stand der echten Orte einer Stadt. Fehlen sie oder sind sie älter als 30 Tage, wird der Import
 * automatisch angestoßen (`autoSync`). Läuft gerade ein Import (auch von jemand anderem), wird der
 * Stand alle 4 Sekunden neu abgefragt.
 */
export function usePlaceRegion(city: string | null, { autoSync = true }: { autoSync?: boolean } = {}) {
  const queryClient = useQueryClient();
  const key = city?.trim() ?? "";
  const region = useQuery({
    queryKey: qk.placeRegion(key),
    enabled: key.length >= 2,
    staleTime: 60_000,
    queryFn: () => placesProvider.region(key),
    refetchInterval: (query) => (query.state.data?.busy ? 4000 : false),
  });
  const sync = useMutation({
    mutationFn: (name: string) => placesProvider.sync(name),
    onSettled: (_data, _error, name) => {
      void queryClient.invalidateQueries({ queryKey: qk.placeRegion(name) });
      void queryClient.invalidateQueries({ queryKey: ["activities", "search"] });
    },
  });

  const data = region.data;
  useEffect(() => {
    if (!autoSync || !data || key.length < 2) return;
    const needed = data.status === "none" || (data.stale && !data.busy);
    const id = key.toLocaleLowerCase("de");
    if (needed && !autoSynced.has(id)) {
      autoSynced.add(id);
      sync.mutate(key);
    }
    // sync ist stabil genug; nur auf Stadt und Stand reagieren.
  }, [autoSync, data, key]);

  // Hat jemand anderes importiert, frische Orte laden, sobald der Import fertig ist.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (data?.busy) wasBusy.current = true;
    else if (wasBusy.current && data) {
      wasBusy.current = false;
      void queryClient.invalidateQueries({ queryKey: ["activities", "search"] });
    }
  }, [data, queryClient]);

  // Der Import-Zustand gehört zu der Stadt, für die er gestartet wurde.
  const forThisCity = (sync.variables ?? "").toLocaleLowerCase("de") === key.toLocaleLowerCase("de");
  const importing = (forThisCity && (sync.isPending || sync.data?.status === "busy")) || Boolean(data?.busy);
  return {
    region,
    importing,
    syncError: forThisCity && sync.isError ? sync.error : null,
    /** Stadtmitte für Entfernungsangaben: laut OSM, sonst aus der eingebauten Städteliste. */
    center: (data?.latitude != null && data.longitude != null ? { latitude: data.latitude, longitude: data.longitude } : cityCenter(key)) as LatLng | null,
    /** Kanonischer Stadtname laut OSM (z. B. "Frankfurt am Main" für "frankfurt"). */
    canonicalName: (forThisCity ? sync.data?.region.name : undefined) ?? data?.name ?? null,
    retry: () => {
      if (key.length >= 2) sync.mutate(key);
    },
  };
}

export interface ActivityFilters {
  search: string;
  category: ActivityCategory | null;
  /** null = alle Städte */
  city: string | null;
  maxPriceCents: number | null;
  maxDistanceKm: number | null;
  groupSize: number | null;
  setting: "indoor" | "outdoor" | null;
  maxDurationMinutes: number | null;
  /** Zeigt nur Orte, die für dieses Alter zugänglich sind (Mindestalter <= Wert). */
  age: number | null;
  openNow: boolean;
}

export const EMPTY_FILTERS: ActivityFilters = {
  search: "", category: null, city: null, maxPriceCents: null, maxDistanceKm: null, groupSize: null,
  setting: null, maxDurationMinutes: null, age: null, openNow: false,
};

export function countActiveFilters(f: ActivityFilters): number {
  return [f.maxPriceCents, f.maxDistanceKm, f.groupSize, f.setting, f.maxDurationMinutes, f.age].filter((v) => v != null).length + (f.openNow ? 1 : 0);
}

export interface RankedActivity {
  activity: Activity;
  /** Luftlinie ab der Stadtmitte des Profils; null, wenn unbekannt. */
  distanceKm: number | null;
}

/**
 * Filtert und sortiert im Browser. Stadt, Kategorie und Suchtext filtert bereits der Server.
 * Grundsatz: Ein Filter blendet Orte aus, zu denen die nötige Angabe fehlt – "höchstens 20 €"
 * zeigt also keine Orte mit unbekanntem Preis.
 */
export function applyFilters(activities: Activity[], filters: ActivityFilters, origin: LatLng | null, now: Date = new Date()): RankedActivity[] {
  const ranked: RankedActivity[] = [];
  for (const activity of activities) {
    if (filters.maxPriceCents != null && (activity.price_min_cents == null || activity.price_min_cents > filters.maxPriceCents)) continue;
    if (filters.groupSize != null) {
      if (activity.group_min != null && filters.groupSize < activity.group_min) continue;
      if (activity.group_max != null && filters.groupSize > activity.group_max) continue;
    }
    if (filters.setting && (activity.setting == null || (activity.setting !== filters.setting && activity.setting !== "both"))) continue;
    if (filters.maxDurationMinutes != null && (activity.duration_minutes == null || activity.duration_minutes > filters.maxDurationMinutes)) continue;
    if (filters.age != null && activity.min_age != null && activity.min_age > filters.age) continue;
    if (filters.openNow && openStateAt(activity.opening_hours, now).state !== "open") continue;

    const distance = origin && activity.latitude != null && activity.longitude != null ? distanceKm(origin, { latitude: activity.latitude, longitude: activity.longitude }) : null;
    if (filters.maxDistanceKm != null && (distance == null || distance > filters.maxDistanceKm)) continue;
    ranked.push({ activity, distanceKm: distance });
  }
  // Mit Entfernungsfilter nach Nähe sortieren, sonst die Reihenfolge des Servers (Vollständigkeit) behalten.
  if (filters.maxDistanceKm == null) return ranked;
  return ranked.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
}

export { cityCenter };

/** Mittlerer Richtpreis einer Aktivität – Startwert für die Kostenschätzung in Abstimmungen. */
export function typicalPriceCents(activity: Pick<Activity, "price_min_cents" | "price_max_cents">): number | null {
  if (activity.price_min_cents == null && activity.price_max_cents == null) return null;
  if (activity.price_min_cents != null && activity.price_max_cents != null) return Math.round((activity.price_min_cents + activity.price_max_cents) / 200) * 100;
  return activity.price_min_cents ?? activity.price_max_cents;
}
