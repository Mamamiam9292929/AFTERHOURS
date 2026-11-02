import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { shrinkPhoto } from "@/lib/photo";
import { qk } from "@/lib/query";
import { useRealtime } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";
import type { PlanPhoto } from "@/lib/types";

/**
 * P10 · Datenzugriff der Plan-Fotos (nur Planseite, eigener Chunk). Die Bilder liegen im privaten Bucket
 * `plan-photos`; angezeigt werden sie über signierte Adressen, die eine Stunde gelten.
 */
const BUCKET = "plan-photos";
const URL_SECONDS = 60 * 60;

export interface PlanPhotoWithUrl extends PlanPhoto {
  /** null, wenn die Datei fehlt oder keine Adresse kam */
  url: string | null;
}

export function usePlanPhotos(planId: string) {
  const client = useQueryClient();
  useRealtime(
    `plan-photos:${planId}`,
    [{ table: "plan_photos", filter: `plan_id=eq.${planId}` }],
    () => void client.invalidateQueries({ queryKey: qk.planPhotos(planId) }),
  );
  return useQuery({
    queryKey: qk.planPhotos(planId),
    // Signierte Adressen laufen nach einer Stunde ab – vorher neu holen.
    refetchInterval: 45 * 60_000,
    queryFn: async (): Promise<PlanPhotoWithUrl[]> => {
      const { data, error } = await supabase
        .from("plan_photos")
        .select("*")
        .eq("plan_id", planId)
        .not("uploaded_at", "is", null)
        .order("created_at", { ascending: true })
        .limit(60);
      if (error) throw error;
      const photos = data as PlanPhoto[];
      if (photos.length === 0) return [];
      const signed = await supabase.storage.from(BUCKET).createSignedUrls(
        photos.map((p) => p.path),
        URL_SECONDS,
      );
      if (signed.error) throw signed.error;
      const urls = new Map(signed.data.map((s) => [s.path, s.signedUrl]));
      return photos.map((p) => ({ ...p, url: urls.get(p.path) ?? null }));
    },
  });
}

/** Ein Foto: verkleinern (ohne Metadaten) → Platz reservieren → hochladen → bestätigen. */
export function useUploadPlanPhoto(planId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const photo = await shrinkPhoto(file);
      const reserved = await supabase.rpc("reserve_plan_photo", { p_plan_id: planId, p_width: photo.width, p_height: photo.height, p_type: photo.type });
      if (reserved.error) throw reserved.error;
      const { id, path } = reserved.data as { id: string; path: string };
      const upload = await supabase.storage.from(BUCKET).upload(path, photo.blob, { contentType: photo.type, upsert: false, cacheControl: "31536000" });
      if (upload.error) throw upload.error;
      const confirmed = await supabase.rpc("confirm_plan_photo", { p_photo_id: id });
      if (confirmed.error) throw confirmed.error;
    },
    onSettled: () => void client.invalidateQueries({ queryKey: qk.planPhotos(planId) }),
  });
}

/** Erst die Datei (Storage-Policy prüft die Berechtigung), dann die Zeile. */
export function useDeletePlanPhoto(planId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (photo: PlanPhoto) => {
      const removed = await supabase.storage.from(BUCKET).remove([photo.path]);
      if (removed.error) throw removed.error;
      const { error } = await supabase.rpc("delete_plan_photo", { p_photo_id: photo.id });
      if (error) throw error;
    },
    onSettled: () => void client.invalidateQueries({ queryKey: qk.planPhotos(planId) }),
  });
}

/** P10 Etappe 2a · Offene Meldung zu einem Foto, wie `plan_photo_reports` sie liefert. */
export interface PlanPhotoReport {
  photo_id: string;
  count: number;
  /** Gründe ohne Namen – nur für Verwaltende, sonst leer */
  reasons: string[];
  /** darf „Wieder zeigen“ (Verwaltende, nicht für eigene Fotos) */
  can_review: boolean;
}

/** Meldungen der Fotos dieses Plans – nur für Verwaltende und für die eigenen Fotos, sonst leer. */
export function usePlanPhotoReports(planId: string) {
  return useQuery({
    queryKey: [...qk.planPhotos(planId), "reports"],
    queryFn: async (): Promise<PlanPhotoReport[]> => {
      const { data, error } = await supabase.rpc("plan_photo_reports", { p_plan_id: planId });
      if (error) throw error;
      return (data ?? []) as PlanPhotoReport[];
    },
  });
}

export function useReportPlanPhoto(planId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { photoId: string; reason: string }) => {
      const { error } = await supabase.rpc("report_plan_photo", { p_photo_id: input.photoId, p_reason: input.reason });
      if (error) throw error;
    },
    onSettled: () => void client.invalidateQueries({ queryKey: qk.planPhotos(planId) }),
  });
}

export function useKeepPlanPhoto(planId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (photoId: string) => {
      const { error } = await supabase.rpc("keep_plan_photo", { p_photo_id: photoId });
      if (error) throw error;
    },
    onSettled: () => void client.invalidateQueries({ queryKey: qk.planPhotos(planId) }),
  });
}
