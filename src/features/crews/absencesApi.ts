import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/AuthProvider";
import type { Absence } from "@/lib/absences";
import { qk } from "@/lib/query";
import { supabase } from "@/lib/supabase";

/**
 * P21 · „Bin weg“. Lesen und Schreiben nur über RPCs: `my_absences` (eigene laufende und kommende),
 * `add_my_absence`, `remove_my_absence` und `crew_absences` (nur für Mitglieder der Crew).
 */
export interface MyAbsence {
  id: string;
  starts_on: string;
  ends_on: string;
}

export function useMyAbsences() {
  const { user } = useAuth();
  return useQuery({
    queryKey: qk.myAbsences(user?.id ?? "anonymous"),
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<MyAbsence[]> => {
      const { data, error } = await supabase.rpc("my_absences");
      if (error) throw error;
      return (data ?? []) as MyAbsence[];
    },
  });
}

export function useAddAbsence() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ startsOn, endsOn }: { startsOn: string; endsOn: string }): Promise<void> => {
      const { error } = await supabase.rpc("add_my_absence", { p_starts_on: startsOn, p_ends_on: endsOn });
      if (error) throw error;
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.absencesAll }),
  });
}

export function useRemoveAbsence() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.rpc("remove_my_absence", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.absencesAll }),
  });
}

/** Laufende und kommende Abwesenheiten der Crew – nur geladen, wenn `enabled` (z. B. offene Termin-Abstimmung). */
export function useCrewAbsences(crewId: string, enabled = true) {
  return useQuery({
    queryKey: qk.crewAbsences(crewId),
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Absence[]> => {
      const { data, error } = await supabase.rpc("crew_absences", { p_crew_id: crewId });
      if (error) throw error;
      return (data ?? []) as Absence[];
    },
  });
}
