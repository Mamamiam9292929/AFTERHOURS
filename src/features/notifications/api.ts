import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/AuthProvider";
import { qk } from "@/lib/query";
import { useRealtime } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";
import type { AppNotification } from "@/lib/types";

/** Die letzten 60 Benachrichtigungen. Aktualisiert sich per Realtime, ersatzweise alle 45 Sekunden. */
export function useNotifications() {
  const { user } = useAuth();
  const client = useQueryClient();
  useRealtime(user ? `notifications:${user.id}` : null, [{ table: "notifications", filter: `user_id=eq.${user?.id}` }], () => {
    void client.invalidateQueries({ queryKey: qk.notifications });
  });
  return useQuery({
    queryKey: qk.notifications,
    enabled: Boolean(user),
    refetchInterval: 45_000,
    queryFn: async (): Promise<AppNotification[]> => {
      const { data, error } = await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(60);
      if (error) throw error;
      return data as AppNotification[];
    },
  });
}

export function useUnreadCount(): number {
  const { data } = useNotifications();
  return data?.filter((n) => !n.read_at).length ?? 0;
}

export function useMarkNotificationsRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[] | null) => {
      const { error } = await supabase.rpc("mark_notifications_read", { p_ids: ids });
      if (error) throw error;
    },
    onMutate: async (ids) => {
      await client.cancelQueries({ queryKey: qk.notifications });
      const previous = client.getQueryData<AppNotification[]>(qk.notifications);
      const now = new Date().toISOString();
      client.setQueryData<AppNotification[]>(qk.notifications, (list) =>
        list?.map((n) => (!n.read_at && (ids === null || ids.includes(n.id)) ? { ...n, read_at: now } : n)),
      );
      return { previous };
    },
    onError: (_error, _ids, context) => client.setQueryData(qk.notifications, context?.previous),
    onSettled: () => void client.invalidateQueries({ queryKey: qk.notifications }),
  });
}

export function useDeleteNotification() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("notifications").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.notifications }),
  });
}
