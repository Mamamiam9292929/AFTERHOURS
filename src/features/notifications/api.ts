import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/AuthProvider";
import { kickPush } from "@/lib/push";
import { qk } from "@/lib/query";
import { useRealtime } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";
import type { AppNotification } from "@/lib/types";

/**
 * Einmal je Sitzung (und Person) fragt die App den Server, ob Erinnerungen fällig sind; der Server legt
 * sie dann als Benachrichtigungen an:
 * - P3 Etappe 3b: offene Beträge (nur die eigenen),
 * - P4 Etappe 2: Pläne, die heute stattfinden (für alle in den eigenen Crews – deshalb danach Push).
 * - P10 Etappe 3: Fotos aufräumen – abgelaufene (12 Monate nach dem Abend) und gelöschte Plan-Fotos
 *   verschwinden auch als Datei aus dem Speicher (Edge Function `photo-cleanup`, Fehler sind egal).
 * - P16: am Morgen nach einem Abend „Fotos von gestern?“ an alle, die zugesagt hatten (eigene Crews, danach Push).
 * - P20 Etappe 2: eine Woche vor einem Geburtstag in den eigenen Crews an alle außer das Geburtstagskind (danach Push).
 * - P15: Abstimmungen in ihren letzten drei Stunden (an alle ohne Stimme). Das Fenster ist kurz, deshalb
 *   fragt die App danach höchstens alle 15 Minuten erneut (beim Aktualisieren der Liste).
 * - P46 Etappe 2: Antwortfristen von Plänen – am letzten Tag davor an alle ohne Antwort, danach der Stand an die
 *   Person, die den Plan angelegt hat. Im selben 15-Minuten-Takt wie P15.
 * Scheitert das (Netz, Rate Limit), bleibt es bei der Liste – beim nächsten Start versucht es die App wieder.
 */
let expenseRemindersCheckedFor: string | null = null;
let closingCheckedAt: { userId: string; at: number } | null = null;
const CLOSING_CHECK_MS = 15 * 60_000;

async function checkClosingPolls(userId: string) {
  const now = Date.now();
  if (closingCheckedAt?.userId === userId && now - closingCheckedAt.at < CLOSING_CHECK_MS) return;
  closingCheckedAt = { userId, at: now };
  const [polls, plans] = await Promise.all([supabase.rpc("send_poll_closing_reminders"), supabase.rpc("send_plan_answer_by_reminders")]);
  if ([polls.data, plans.data].some((n) => typeof n === "number" && n > 0)) kickPush();
}

async function checkExpenseReminders(userId: string) {
  if (expenseRemindersCheckedFor === userId) {
    await checkClosingPolls(userId).catch(() => undefined);
    return;
  }
  expenseRemindersCheckedFor = userId;
  closingCheckedAt = { userId, at: Date.now() };
  // Fehler kommen als Ergebnis zurück, nicht als Ausnahme; ohne Netz kommt die Erinnerung beim nächsten Start.
  await Promise.allSettled([
    supabase.rpc("send_my_expense_reminders"),
    supabase.rpc("send_plan_day_reminders"),
    supabase.rpc("send_poll_closing_reminders"),
    supabase.rpc("send_plan_answer_by_reminders"),
    supabase.rpc("send_plan_photo_nudges"),
    supabase.rpc("send_birthday_reminders"),
  ]);
  // P4: Beim Start einmal die Push-Warteschlange anstoßen – falls seit dem letzten Mal etwas liegen blieb.
  kickPush();
  kickPhotoCleanup();
}

/**
 * P10 Etappe 3: Was zu löschen ist, entscheidet der Server; die App stößt nur an – je Gerät höchstens alle
 * 6 Stunden (der Server begrenzt zusätzlich je Person). Fehler sind egal, der nächste Anstoß holt es nach.
 */
const PHOTO_CLEANUP_KEY = "afterhours.photoCleanupAt";
const PHOTO_CLEANUP_MS = 6 * 60 * 60_000;
function kickPhotoCleanup() {
  try {
    const last = Number(window.localStorage.getItem(PHOTO_CLEANUP_KEY) ?? 0);
    if (Date.now() - last < PHOTO_CLEANUP_MS) return;
    window.localStorage.setItem(PHOTO_CLEANUP_KEY, String(Date.now()));
  } catch {
    // Ohne Speicher (privates Fenster): trotzdem anstoßen, das Rate Limit des Servers greift.
  }
  void supabase.functions.invoke("photo-cleanup", { body: {} }).catch(() => undefined);
}

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
      if (user) await checkExpenseReminders(user.id);
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
