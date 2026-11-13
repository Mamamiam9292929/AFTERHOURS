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
        /** W11: Gäste mit Antwort dürfen der Crew beitreten (Owner/Admin hat freigeschaltet). */
        can_join?: boolean;
        /** P50 Etappe 2b: weitere Stationen in der Reihenfolge des Abends (fehlt bei älterem Server). */
        stops?: { title: string; at: string | null; address: string | null }[];
      };
      counts: { going: number; maybe: number };
      /**
       * P24 Etappe 2: `note` fehlt, solange es keinen Zusatz gibt. P26 Etappe 3b: `waitlist` = eigener Platz auf der
       * Nachrückliste (1 = als Nächstes), `promoted` = über die Liste nachgerückt; beide fehlen sonst.
       */
      me: {
        name: string;
        status: GuestAnswer;
        note?: string;
        waitlist?: number;
        promoted?: true;
        /** P51 Etappe 2: Begleitung (1–3); fehlt ohne Begleitung. */
        plus_ones?: number;
      } | null;
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

/**
 * P26 Etappe 3b · Bei voller Runde auf die Nachrückliste (`join: true`) oder herunter. Liefert den Platz (1 = als
 * Nächstes) bzw. null. Wer noch nicht geantwortet hat, braucht einen Namen und steht danach mit „Vielleicht“ da.
 */
export function useGuestWaitlist(token: string, secret: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string | null; join: boolean }): Promise<number | null> => {
      const { data, error } = await supabase.rpc("guest_waitlist_shared_plan", { p_token: token, p_secret: secret, p_name: input.name, p_join: input.join });
      if (error) throw error;
      return (data as number | null) ?? null;
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

/**
 * P51 Etappe 2 · „Ich bring wen mit“ als Gast: 0–3 Begleitungen zur eigenen Zusage. Liefert die gespeicherte Zahl;
 * die Zahlen der Karte (und die Vorschau mit den freien Plätzen) laden danach neu.
 */
export function useGuestPlusOnes(token: string, secret: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (count: number): Promise<number> => {
      const { data, error } = await supabase.rpc("guest_plus_ones_shared_plan", { p_token: token, p_secret: secret, p_count: count });
      if (error) throw error;
      return (data as number | null) ?? 0;
    },
    onSuccess: (saved) =>
      client.setQueryData<SharedPlanRsvp>(rsvpKey(token), (old) => {
        if (old?.status !== "valid" || !old.me) return old;
        const { plus_ones: _previous, ...rest } = old.me;
        return { ...old, me: saved > 0 ? { ...rest, plus_ones: saved } : rest };
      }),
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

/** W11: Gäste dürfen der Crew vom Plan-Link aus beitreten (nur Owner/Admin). */
export function useSetPlanGuestJoin(planId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (allowed: boolean) => {
      const { error } = await supabase.rpc("set_plan_guest_join", { p_plan_id: planId, p_allowed: allowed });
      if (error) throw error;
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: qk.plan(planId) });
      void client.invalidateQueries({ queryKey: qk.plans });
    },
  });
}

/**
 * W11 · Persönlichen Einladungslink holen (einmal gültig, 7 Tage). Nur für Gäste, die mit diesem Gerät schon
 * geantwortet haben; der Link führt auf die normale Einladung (/invite/<token>).
 */
export function useGuestJoinPlan(token: string, secret: string) {
  return useMutation({
    mutationFn: async (): Promise<{ token: string; expires_at: string }> => {
      const { data, error } = await supabase.rpc("guest_join_shared_plan", { p_token: token, p_secret: secret });
      if (error) throw error;
      return data as { token: string; expires_at: string };
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
