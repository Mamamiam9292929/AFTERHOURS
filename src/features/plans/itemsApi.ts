import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/query";
import { useRealtime } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";
import type { PlanItem } from "@/lib/types";

/**
 * P14 · Datenzugriff der Mitbring-Liste. Liegt bewusst nicht in api.ts: nur die Planseite (eigener Chunk)
 * braucht ihn, so wächst das Start-Bundle nicht.
 */
export function usePlanItems(planId: string) {
  const client = useQueryClient();
  useRealtime(
    `plan-items:${planId}`,
    [{ table: "plan_items", filter: `plan_id=eq.${planId}` }],
    () => void client.invalidateQueries({ queryKey: qk.planItems(planId) }),
  );
  return useQuery({
    queryKey: qk.planItems(planId),
    refetchInterval: 30_000,
    queryFn: async (): Promise<PlanItem[]> => {
      const { data, error } = await supabase.from("plan_items").select("*").eq("plan_id", planId).order("created_at", { ascending: true }).limit(60);
      if (error) throw error;
      return data as PlanItem[];
    },
  });
}

function useItemAction<TInput>(planId: string, fn: (input: TInput) => Promise<void>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => void client.invalidateQueries({ queryKey: qk.planItems(planId) }),
  });
}

/** Etwas auf die Liste setzen; `claim`: „Bring ich selbst mit“. */
export function useAddPlanItem(planId: string) {
  return useItemAction(planId, async (input: { label: string; claim: boolean }) => {
    const { error } = await supabase.rpc("add_plan_item", { p_plan_id: planId, p_label: input.label, p_claim: input.claim });
    if (error) throw error;
  });
}

/** „Bring ich“ (`claim: true`) oder „Doch nicht“ (`claim: false`). */
export function useClaimPlanItem(planId: string) {
  return useItemAction(planId, async (input: { itemId: string; claim: boolean }) => {
    const { error } = await supabase.rpc("claim_plan_item", { p_item_id: input.itemId, p_claim: input.claim });
    if (error) throw error;
  });
}

export function useRemovePlanItem(planId: string) {
  return useItemAction(planId, async (itemId: string) => {
    const { error } = await supabase.rpc("remove_plan_item", { p_item_id: itemId });
    if (error) throw error;
  });
}
