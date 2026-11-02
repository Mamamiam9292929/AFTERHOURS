import { useQuery } from "@tanstack/react-query";
import { qk } from "@/lib/query";
import type { RecapPhotoStack } from "@/lib/recap";
import { supabase } from "@/lib/supabase";

/**
 * P10 Etappe 2c · Fotostapel im Crew-Rückblick. Welche Fotos die Person sehen darf, entscheidet der Server
 * (`crew_photo_stacks`: nur abgeschlossene Abende, nichts Gemeldetes); die Dateien kommen wie auf der
 * Planseite über signierte Adressen aus dem privaten Bucket, die eine Stunde gelten.
 */
const BUCKET = "plan-photos";
const URL_SECONDS = 60 * 60;

export interface RecapPhotoStackWithUrls extends RecapPhotoStack {
  photos: (RecapPhotoStack["photos"][number] & { url: string | null })[];
}

export function useCrewPhotoStacks(crewId: string, enabled = true) {
  return useQuery({
    queryKey: qk.crewPhotoStacks(crewId),
    enabled,
    // Signierte Adressen laufen nach einer Stunde ab – vorher neu holen.
    refetchInterval: 45 * 60_000,
    queryFn: async (): Promise<RecapPhotoStackWithUrls[]> => {
      const { data, error } = await supabase.rpc("crew_photo_stacks", { p_crew_id: crewId });
      if (error) throw error;
      const stacks = (data ?? []) as RecapPhotoStack[];
      const paths = stacks.flatMap((s) => s.photos.map((p) => p.path));
      if (paths.length === 0) return stacks.map((s) => ({ ...s, photos: [] }));
      const signed = await supabase.storage.from(BUCKET).createSignedUrls(paths, URL_SECONDS);
      if (signed.error) throw signed.error;
      const urls = new Map(signed.data.map((s) => [s.path, s.signedUrl]));
      return stacks.map((s) => ({ ...s, photos: s.photos.map((p) => ({ ...p, url: urls.get(p.path) ?? null })) }));
    },
  });
}
