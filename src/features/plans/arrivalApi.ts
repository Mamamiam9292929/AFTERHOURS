import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ArrivalEntry } from "@/lib/arrival";
import { supabase } from "@/lib/supabase";

/**
 * P43 · „Seid ihr schon da?“ – Abfrage und Ansage, geteilt von der Karte auf der Planseite und der Kachel in der
 * „Heute Abend“-Leiste auf Home (gleicher Schlüssel, also gleicher Stand an beiden Stellen). Ohne Texte, damit beide
 * Stellen ihre Texte erst mit sich selbst laden (F7).
 */
export interface PlanArrivalStatus {
  open: boolean;
  can_answer: boolean;
  mine: Omit<ArrivalEntry, "user_id"> | null;
  people: ArrivalEntry[];
  missing: number;
}

export type ArrivalChoice = { state: "here" } | { state: "late"; minutes: number } | { state: "none" };

const arrivalKey = (planId: string) => ["plan-arrival", planId] as const;

export function usePlanArrival(planId: string) {
  return useQuery({
    queryKey: arrivalKey(planId),
    queryFn: async (): Promise<PlanArrivalStatus> => {
      const { data, error } = await supabase.rpc("plan_arrival_status", { p_plan_id: planId });
      if (error) throw error;
      return data as PlanArrivalStatus;
    },
    // Rund um den Beginn kommen die Ansagen schnell nacheinander – beim Draufschauen soll der Stand frisch sein.
    refetchInterval: 30_000,
  });
}

/** P44 · „Wo sitzt ihr?“ – Hinweis zur eigenen Ansage „Bin da“ setzen; leer löscht. Gibt den gespeicherten Text zurück. */
export function useSetPlanArrivalSpot(planId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (spot: string): Promise<string | null> => {
      const { data, error } = await supabase.rpc("set_plan_arrival_spot", { p_plan_id: planId, p_spot: spot });
      if (error) throw error;
      return (data as string | null) ?? null;
    },
    onSettled: () => void client.invalidateQueries({ queryKey: arrivalKey(planId) }),
  });
}

export function useSetPlanArrival(planId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (choice: ArrivalChoice): Promise<string | null> => {
      const { data, error } = await supabase.rpc("set_plan_arrival", {
        p_plan_id: planId,
        p_state: choice.state,
        p_minutes: choice.state === "late" ? choice.minutes : null,
      });
      if (error) throw error;
      return (data as string | null) ?? null;
    },
    onSettled: () => void client.invalidateQueries({ queryKey: arrivalKey(planId) }),
  });
}
