import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/query";
import { useRealtime } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";
import type { PlanStop } from "@/lib/types";

/**
 * P50 · „Danach noch wohin?“ – Stationen des Abends. Eigene Datei, damit nur der Chunk der Karte sie lädt.
 * Lesen über RLS (nur die Crew), Schreiben über `add_plan_stop`/`remove_plan_stop`.
 */
export function usePlanStops(planId: string) {
  const client = useQueryClient();
  useRealtime(
    `plan-stops:${planId}`,
    [{ table: "plan_stops", filter: `plan_id=eq.${planId}` }],
    () => void client.invalidateQueries({ queryKey: qk.planStops(planId) }),
  );
  return useQuery({
    queryKey: qk.planStops(planId),
    queryFn: async (): Promise<PlanStop[]> => {
      const { data, error } = await supabase.from("plan_stops").select("*").eq("plan_id", planId).order("created_at", { ascending: true }).limit(10);
      if (error) throw error;
      return data as PlanStop[];
    },
  });
}

export function useAddPlanStop(planId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { title: string; at: string | null; address: string | null }) => {
      const { error } = await supabase.rpc("add_plan_stop", { p_plan_id: planId, p_title: input.title, p_at: input.at, p_address: input.address });
      if (error) throw error;
    },
    onSettled: () => void client.invalidateQueries({ queryKey: qk.planStops(planId) }),
  });
}

export function useRemovePlanStop(planId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (stopId: string) => {
      const { error } = await supabase.rpc("remove_plan_stop", { p_stop_id: stopId });
      if (error) throw error;
    },
    onSettled: () => void client.invalidateQueries({ queryKey: qk.planStops(planId) }),
  });
}
