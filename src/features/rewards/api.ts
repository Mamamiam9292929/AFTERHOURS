import { useQuery } from "@tanstack/react-query";
import { qk } from "@/lib/query";
import { supabase } from "@/lib/supabase";
import type { RewardTransaction } from "@/lib/types";

/** Punkte-Verlauf der angemeldeten Person (Profil und Punkteseite). Eigene Datei, damit das Profil die Punkteseite nicht mitlädt (F7). */
export function useRewards() {
  return useQuery({
    queryKey: qk.rewards,
    queryFn: async (): Promise<RewardTransaction[]> => {
      const { data, error } = await supabase.from("reward_transactions").select("*").order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data as RewardTransaction[];
    },
  });
}

export const totalPoints = (transactions: RewardTransaction[] | undefined) => (transactions ?? []).reduce((sum, tx) => sum + tx.points_delta, 0);
