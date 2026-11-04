import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/AuthProvider";
import type { Birthday, CrewBirthday } from "@/lib/birthdays";
import { qk } from "@/lib/query";
import { supabase } from "@/lib/supabase";

/**
 * P20 · Geburtstage in der Crew. Lesen und Schreiben nur über RPCs: `my_birthday` (eigener),
 * `set_my_birthday` (setzen bzw. mit `null, null` entfernen), `crew_birthdays` (nur für Mitglieder) und – für Home –
 * `my_crew_birthdays` (alle eigenen Crews, ohne die eigene Person).
 */
export interface MyBirthday {
  month: number;
  day: number;
}

export function useMyBirthday() {
  const { user } = useAuth();
  return useQuery({
    queryKey: qk.myBirthday(user?.id ?? "anonymous"),
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<MyBirthday | null> => {
      const { data, error } = await supabase.rpc("my_birthday");
      if (error) throw error;
      const row = ((data ?? []) as MyBirthday[])[0];
      return row ? { month: row.month, day: row.day } : null;
    },
  });
}

export function useSetMyBirthday() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (birthday: MyBirthday | null): Promise<void> => {
      const { error } = await supabase.rpc("set_my_birthday", { p_month: birthday?.month ?? null, p_day: birthday?.day ?? null });
      if (error) throw error;
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.birthdaysAll }),
  });
}

export function useCrewBirthdays(crewId: string) {
  return useQuery({
    queryKey: qk.crewBirthdays(crewId),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Birthday[]> => {
      const { data, error } = await supabase.rpc("crew_birthdays", { p_crew_id: crewId });
      if (error) throw error;
      return (data ?? []) as Birthday[];
    },
  });
}

/** P20 Etappe 2: Geburtstage aller eigenen Crews für Home (eine Zeile je Person und Crew). */
export function useMyCrewBirthdays(enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: qk.myCrewBirthdays(user?.id ?? "anonymous"),
    enabled: Boolean(user) && enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<CrewBirthday[]> => {
      const { data, error } = await supabase.rpc("my_crew_birthdays");
      if (error) throw error;
      return (data ?? []) as CrewBirthday[];
    },
  });
}
