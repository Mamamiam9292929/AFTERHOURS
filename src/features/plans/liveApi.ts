import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/query";
import { useRealtime } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";
import type { PlanLiveLocation } from "@/lib/types";

/**
 * P13 · Live-Standort: Positionen der Crew beim Plan (RLS liefert nur Laufendes und nur an Personen, die
 * selbst kommen). Eigener Chunk wie die Mitbring-Liste – nur die Planseite braucht ihn.
 */
export function usePlanLiveLocations(planId: string, enabled: boolean) {
  const client = useQueryClient();
  useRealtime(
    enabled ? `plan-live:${planId}` : null,
    [{ table: "plan_live_locations", filter: `plan_id=eq.${planId}` }],
    () => void client.invalidateQueries({ queryKey: qk.planLive(planId) }),
  );
  return useQuery({
    queryKey: qk.planLive(planId),
    enabled,
    refetchInterval: 30_000,
    queryFn: async (): Promise<PlanLiveLocation[]> => {
      const { data, error } = await supabase.from("plan_live_locations").select("*").eq("plan_id", planId).order("updated_at", { ascending: false }).limit(60);
      if (error) throw error;
      return data as PlanLiveLocation[];
    },
  });
}

/** Position senden; liefert, bis wann die Freigabe gilt. */
export function useShareLiveLocation(planId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { latitude: number; longitude: number; accuracy: number | null }): Promise<string> => {
      const { data, error } = await supabase.rpc("share_plan_live_location", {
        p_plan_id: planId,
        p_latitude: input.latitude,
        p_longitude: input.longitude,
        p_accuracy_m: input.accuracy,
      });
      if (error) throw error;
      return data as string;
    },
    onSettled: () => void client.invalidateQueries({ queryKey: qk.planLive(planId) }),
  });
}

export function useStopLiveLocation(planId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("stop_plan_live_location", { p_plan_id: planId });
      if (error) throw error;
    },
    onSettled: () => void client.invalidateQueries({ queryKey: qk.planLive(planId) }),
  });
}

/** P13 Etappe 2b · „Bin gleich da“: Ankunft in Minuten ansagen (`null` nimmt sie zurück); liefert die Uhrzeit vom Server. */
export function useSetLiveArrival(planId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (minutes: number | null): Promise<string | null> => {
      const { data, error } = await supabase.rpc("set_plan_live_arrival", { p_plan_id: planId, p_minutes: minutes });
      if (error) throw error;
      return (data as string | null) ?? null;
    },
    onSettled: () => void client.invalidateQueries({ queryKey: qk.planLive(planId) }),
  });
}
