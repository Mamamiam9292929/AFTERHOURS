import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Person } from "@/components/ui/Avatar";
import { useAuth } from "@/features/auth/AuthProvider";
import { qk } from "@/lib/query";
import { supabase } from "@/lib/supabase";
import type { Profile, UserSettings } from "@/lib/types";

export function useProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: qk.profile(user?.id ?? "anonymous"),
    enabled: Boolean(user),
    staleTime: 60_000,
    queryFn: async (): Promise<Profile> => {
      const { data, error } = await supabase.from("profiles").select("*").eq("id", user?.id ?? "").single();
      if (error) throw error;
      return data as Profile;
    },
  });
}

export type ProfileUpdate = Partial<Pick<Profile, "display_name" | "avatar_url" | "city" | "interests" | "favorite_categories" | "onboarded_at">>;

export function useUpdateProfile() {
  const { user } = useAuth();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (update: ProfileUpdate): Promise<Profile> => {
      const { data, error } = await supabase.from("profiles").update(update).eq("id", user?.id ?? "").select("*").single();
      if (error) throw error;
      return data as Profile;
    },
    onSuccess: (profile) => {
      client.setQueryData(qk.profile(profile.id), profile);
      void client.invalidateQueries({ queryKey: qk.people });
    },
  });
}

export function useSettings() {
  const { user } = useAuth();
  return useQuery({
    queryKey: qk.settings(user?.id ?? "anonymous"),
    enabled: Boolean(user),
    staleTime: 60_000,
    queryFn: async (): Promise<UserSettings> => {
      const { data, error } = await supabase.from("user_settings").select("*").eq("user_id", user?.id ?? "").single();
      if (error) throw error;
      return data as UserSettings;
    },
  });
}

export type SettingsUpdate = Partial<
  Pick<UserSettings, "location_sharing_mode" | "location_sharing_crew_id" | "typical_budget_cents" | "preferred_distance_km" | "notification_preferences" | "privacy_preferences">
>;

export function useUpdateSettings() {
  const { user } = useAuth();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (update: SettingsUpdate): Promise<UserSettings> => {
      const { data, error } = await supabase.from("user_settings").update(update).eq("user_id", user?.id ?? "").select("*").single();
      if (error) throw error;
      return data as UserSettings;
    },
    onSuccess: (settings) => client.setQueryData(qk.settings(settings.user_id), settings),
  });
}

/**
 * Alle Profile, die die angemeldete Person sehen darf: sie selbst und alle, mit denen sie eine Crew
 * teilt (so entscheidet es die RLS-Policy). Einmal geladen, überall per ID nachgeschlagen.
 */
export function usePeople() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: qk.people,
    enabled: Boolean(user),
    staleTime: 60_000,
    queryFn: async (): Promise<Map<string, Person & { city: string | null }>> => {
      const { data, error } = await supabase.from("profiles").select("id, display_name, avatar_url, city");
      if (error) throw error;
      return new Map((data as (Person & { city: string | null })[]).map((p) => [p.id, p]));
    },
  });
  const lookup = (id: string | null | undefined): Person | null => (id ? (query.data?.get(id) ?? null) : null);
  return { ...query, lookup };
}

export function useIsAdmin() {
  const { user } = useAuth();
  return useQuery({
    queryKey: qk.isAdmin(user?.id ?? "anonymous"),
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.rpc("is_admin");
      if (error) throw error;
      return data === true;
    },
  });
}
