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
      /** P24 Etappe 2: `note` fehlt, solange es keinen Zusatz gibt. */
      me: { name: string; status: GuestAnswer; note?: string } | null;
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

/** P24 Etappe 2: Zusatz zur eigenen Gast-Antwort setzen (null = entfernen). Liefert den gespeicherten Zusatz. */
export function useGuestNote(token: string, secret: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (note: string | null): Promise<string | null> => {
      const { data, error } = await supabase.rpc("guest_note_shared_plan", { p_token: token, p_secret: secret, p_note: note ?? "" });
      if (error) throw error;
      return (data as string | null) ?? null;
    },
    onSuccess: (saved) =>
      client.setQueryData<SharedPlanRsvp>(rsvpKey(token), (old) =>
        old?.status === "valid" && old.me ? { ...old, me: saved ? { ...old.me, note: saved } : { name: old.me.name, status: old.me.status } } : old,
      ),
    onSettled: () => void client.invalidateQueries({ queryKey: rsvpKey(token) }),
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

/**
 * W10 Etappe 2 · Geheimnis eines früheren Gast-Besuchs auf diesem Gerät – ohne ein neues anzulegen.
 * Die Planseite fragt damit, ob die angemeldete Person hier schon als Gast geantwortet hat.
 */
export function storedPlanGuestSecret(token: string | null | undefined): string | null {
  if (!token) return null;
  try {
    const stored = localStorage.getItem(secretKey(token));
    return stored && /^[0-9a-f]{64}$/.test(stored) ? stored : null;
  } catch {
    return null;
  }
}

function forgetPlanGuestSecret(token: string) {
  try {
    localStorage.removeItem(secretKey(token));
  } catch {
    // nichts zu tun
  }
}

export type PlanGuestClaimPreview = { status: "none" } | { status: "found"; name: string; answer: GuestAnswer; own: GuestAnswer | null };

const claimKey = (planId: string) => ["plan-guest-claim", planId] as const;

export function usePlanGuestClaimPreview(planId: string, secret: string | null) {
  return useQuery({
    queryKey: [...claimKey(planId), secret ? "secret" : "none"] as const,
    enabled: Boolean(secret),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async (): Promise<PlanGuestClaimPreview> => {
      const { data, error } = await supabase.rpc("plan_guest_claim_preview", { p_plan_id: planId, p_secret: secret });
      if (error) throw error;
      return data as PlanGuestClaimPreview;
    },
  });
}

/** `keep`: true übernimmt die Gast-Antwort (eigene Antwort hat Vorrang), false löscht sie. */
export function useClaimPlanGuest(planId: string, token: string, secret: string | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (keep: boolean): Promise<{ claimed: boolean; status: GuestAnswer | null }> => {
      const { data, error } = await supabase.rpc("claim_plan_guest", { p_plan_id: planId, p_secret: secret, p_keep: keep });
      if (error) throw error;
      return data as { claimed: boolean; status: GuestAnswer | null };
    },
    onSuccess: () => forgetPlanGuestSecret(token),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: claimKey(planId) });
      void client.invalidateQueries({ queryKey: qk.plan(planId) });
      void client.invalidateQueries({ queryKey: qk.plans });
    },
  });
}
