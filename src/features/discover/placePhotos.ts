import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { hasPhotoRef, loadPlacePhotos, type PlacePhoto, type PlaceRef } from "@/lib/commons";
import type { Activity } from "@/lib/types";

const NONE: ReadonlyMap<string, PlacePhoto> = new Map();

/**
 * P7 Etappe 2 · Fotos für alle Orte in Discover auf einmal – nur wenn „Fotos von Orten immer laden“ auf diesem
 * Gerät an ist. Ohne Einwilligung geht keine Anfrage an Wikimedia; Orte ohne Foto zeigen ihre Kategorie-Grafik.
 */
export function usePlacePhotos(activities: Activity[], enabled: boolean): ReadonlyMap<string, PlacePhoto> {
  const refs = useMemo<PlaceRef[]>(
    () =>
      activities
        .filter(hasPhotoRef)
        .map((a) => ({ id: a.id, commons_file: a.commons_file ?? null, wikidata_id: a.wikidata_id ?? null }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    [activities],
  );
  const key = refs.map((r) => `${r.id}:${r.commons_file ?? ""}:${r.wikidata_id ?? ""}`).join(",");
  const photos = useQuery({
    queryKey: ["place-photos", key],
    enabled: enabled && refs.length > 0,
    staleTime: 60 * 60_000,
    retry: false,
    placeholderData: (previous) => previous,
    queryFn: () => loadPlacePhotos(refs),
  });
  return (enabled && photos.data) || NONE;
}
