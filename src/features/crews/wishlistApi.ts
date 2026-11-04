import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/query";
import { supabase } from "@/lib/supabase";
import type { CrewWish } from "@/lib/wishlist";

/**
 * P22 · „Wollen wir mal hin“ – Merkliste der Crew. Lesen und Schreiben nur über RPCs: `crew_wishes`
 * (Liste, nur für Mitglieder), `my_wish_crews` (auf welchen eigenen Listen ein Ort steht), `add_crew_wish`
 * und `remove_crew_wish` (wer gemerkt hat, Owner, Admins).
 */
export function useCrewWishes(crewId: string) {
  return useQuery({
    queryKey: qk.crewWishes(crewId),
    queryFn: async (): Promise<CrewWish[]> => {
      const { data, error } = await supabase.rpc("crew_wishes", { p_crew_id: crewId });
      if (error) throw error;
      return (data ?? []) as CrewWish[];
    },
  });
}

export function useWishCrews(activityId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.wishCrews(activityId ?? ""),
    enabled: Boolean(activityId) && enabled,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase.rpc("my_wish_crews", { p_activity_id: activityId });
      if (error) throw error;
      return ((data ?? []) as { crew_id: string }[]).map((row) => row.crew_id);
    },
  });
}

export function useToggleCrewWish() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ crewId, activityId, add }: { crewId: string; activityId: string; add: boolean }): Promise<void> => {
      const { error } = add
        ? await supabase.rpc("add_crew_wish", { p_crew_id: crewId, p_activity_id: activityId })
        : await supabase.rpc("remove_crew_wish", { p_crew_id: crewId, p_activity_id: activityId });
      if (error) throw error;
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.wishesAll }),
  });
}
