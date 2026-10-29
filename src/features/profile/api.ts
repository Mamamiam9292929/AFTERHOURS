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

/** P11 Etappe 2a: Sprache im Profil speichern (gilt für Kalender-Abo, Push und neue Geräte). */
export async function saveMyLocale(locale: "de" | "en"): Promise<void> {
  const { error } = await supabase.rpc("set_my_locale", { p_locale: locale });
  if (error) throw error;
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

/** P2 Etappe 2 · Kalender-Abo: der eigene Link (oder null, solange keiner angelegt ist). */
export interface CalendarFeed {
  token: string;
  created_at: string;
  last_used_at: string | null;
}

export function useCalendarFeed() {
  const { user } = useAuth();
  return useQuery({
    queryKey: qk.calendarFeed(user?.id ?? "anonymous"),
    enabled: Boolean(user),
    staleTime: 30_000,
    queryFn: async (): Promise<CalendarFeed | null> => {
      const { data, error } = await supabase.rpc("my_calendar_feed");
      if (error) throw error;
      return (data as CalendarFeed | null) ?? null;
    },
  });
}

/** Legt den Link an oder ersetzt ihn – der alte funktioniert danach nicht mehr. */
export function useRenewCalendarFeed() {
  const { user } = useAuth();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<CalendarFeed> => {
      const { data, error } = await supabase.rpc("renew_calendar_feed");
      if (error) throw error;
      return data as CalendarFeed;
    },
    onSuccess: (feed) => client.setQueryData(qk.calendarFeed(user?.id ?? "anonymous"), feed),
  });
}

export function useRevokeCalendarFeed() {
  const { user } = useAuth();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<void> => {
      const { error } = await supabase.rpc("revoke_calendar_feed");
      if (error) throw error;
    },
    onSuccess: () => client.setQueryData(qk.calendarFeed(user?.id ?? "anonymous"), null),
  });
}

/** P4: Geräte, auf denen die Person Push-Mitteilungen bekommt (ohne Schlüssel – die liest die App nie). */
export interface PushDevice {
  id: string;
  endpoint: string;
  label: string | null;
  created_at: string;
  last_success_at: string | null;
  /** P4 Etappe 3: Benachrichtigungsarten, die auf diesem Gerät nicht als Push kommen. */
  muted_types: string[];
}

export function usePushDevices() {
  const { user } = useAuth();
  return useQuery({
    queryKey: qk.pushDevices(user?.id ?? "anonymous"),
    enabled: Boolean(user),
    queryFn: async (): Promise<PushDevice[]> => {
      const { data, error } = await supabase.from("push_subscriptions").select("id, endpoint, label, created_at, last_success_at, muted_types").order("created_at");
      if (error) throw error;
      return (data ?? []) as PushDevice[];
    },
  });
}

/** P4 Etappe 3: Auswahl für ein eigenes Gerät speichern; der Server gibt die bereinigte Liste zurück. */
export function useSetPushMutedTypes() {
  const { user } = useAuth();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ endpoint, mutedTypes }: { endpoint: string; mutedTypes: string[] }): Promise<{ endpoint: string; mutedTypes: string[] }> => {
      const { data, error } = await supabase.rpc("set_push_muted_types", { p_endpoint: endpoint, p_muted_types: mutedTypes });
      if (error) throw error;
      return { endpoint, mutedTypes: (data ?? []) as string[] };
    },
    onSuccess: ({ endpoint, mutedTypes }) =>
      client.setQueryData<PushDevice[]>(qk.pushDevices(user?.id ?? "anonymous"), (devices) =>
        devices?.map((device) => (device.endpoint === endpoint ? { ...device, muted_types: mutedTypes } : device)),
      ),
  });
}
