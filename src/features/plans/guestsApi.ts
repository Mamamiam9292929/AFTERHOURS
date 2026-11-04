import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/query";
import { supabase } from "@/lib/supabase";
import type { AttendanceStatus, PlanStatus } from "@/lib/types";

/**
 * W10 · Zusagen ohne Konto beim geteilten Plan. Wie bei den Gast-Stimmen (W3) ist ein Gast ein zufälliges
 * Geheimnis (64 Hex-Zeichen), das nur auf diesem Gerät liegt – je Teilen-Link eins. Die Datenbank speichert
 * davon nur den Hash. Den Namen bringt der Gast vom letzten Link mit (`rememberedGuestName`, S2).
 */
export type GuestAnswer = Exclude<AttendanceStatus, "invited">;

const secretKey = (token: string) => `afterhours.planguest.${token}`;

export function planGuestSecret(token: string): string {
  try {
    const stored = localStorage.getItem(secretKey(token));
    if (stored && /^[0-9a-f]{64}$/.test(stored)) return stored;
  } catch {
    // Privates Fenster o. Ä.: Geheimnis gilt dann nur für diesen Besuch.
  }
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  try {
    localStorage.setItem(secretKey(token), secret);
  } catch {
    // siehe oben
  }
  return secret;
}

export type SharedPlanRsvp =
  | {
      status: "valid";
      plan: {
        title: string;
        starts_at: string;
        ends_at: string | null;
        status: PlanStatus;
        open: boolean;
        place: string | null;
        address: string | null;
        meeting_point: string | null;
      };
      counts: { going: number; maybe: number };
      me: { name: string; status: GuestAnswer } | null;
    }
  | { status: "not_found" | "expired" | "guests_off" };

const rsvpKey = (token: string) => ["plan-guest-rsvp", token] as const;

export function useSharedPlanRsvp(token: string | undefined, secret: string | null, enabled = true) {
  return useQuery({
    queryKey: rsvpKey(token ?? "none"),
    enabled: Boolean(token && secret) && enabled,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async (): Promise<SharedPlanRsvp> => {
      const { data, error } = await supabase.rpc("shared_plan_rsvp", { p_token: token ?? "", p_secret: secret });
      if (error) throw error;
      return data as SharedPlanRsvp;
    },
  });
}

/** Antwort setzen; `status: null` zieht sie zurück (der Gast verschwindet aus dem Plan). */
export function useGuestRsvp(token: string, secret: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string | null; status: GuestAnswer | null }) => {
      const { error } = await supabase.rpc("guest_rsvp_shared_plan", { p_token: token, p_secret: secret, p_name: input.name, p_status: input.status });
      if (error) throw error;
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: rsvpKey(token) });
      void client.invalidateQueries({ queryKey: ["plan-share-preview", token] });
    },
  });
}

/** Für die Crew: Schalter „Freunde ohne Konto dürfen zusagen“ (Organisator:in, Owner, Admins). */
export function useSetPlanGuests(planId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (allowed: boolean) => {
      const { error } = await supabase.rpc("set_plan_guests", { p_plan_id: planId, p_allowed: allowed });
      if (error) throw error;
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: qk.plan(planId) });
      void client.invalidateQueries({ queryKey: qk.plans });
    },
  });
}

export function useRemovePlanGuest(planId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (guestId: string) => {
      const { error } = await supabase.rpc("remove_plan_guest", { p_guest_id: guestId });
      if (error) throw error;
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: qk.plan(planId) });
      void client.invalidateQueries({ queryKey: qk.plans });
    },
  });
}
