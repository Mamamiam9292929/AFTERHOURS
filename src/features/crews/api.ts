import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/query";
import { useRealtime } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";
import type { Crew, CrewInvitation, CrewMember, CrewMessage, CrewRole } from "@/lib/types";

export interface CrewWithMembers extends Crew {
  members: CrewMember[];
}

const CREW_SELECT = "*, members:crew_members(crew_id, user_id, role, joined_at)";

const ROLE_ORDER: Record<CrewRole, number> = { owner: 0, admin: 1, member: 2 };
function sortMembers(crew: CrewWithMembers): CrewWithMembers {
  return { ...crew, members: [...crew.members].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.joined_at.localeCompare(b.joined_at)) };
}

export function useCrews() {
  return useQuery({
    queryKey: qk.crews,
    queryFn: async (): Promise<CrewWithMembers[]> => {
      const { data, error } = await supabase.from("crews").select(CREW_SELECT).order("created_at", { ascending: true });
      if (error) throw error;
      return (data as unknown as CrewWithMembers[]).map(sortMembers);
    },
  });
}

export function useCrew(crewId: string | undefined) {
  return useQuery({
    queryKey: qk.crew(crewId ?? "none"),
    enabled: Boolean(crewId),
    queryFn: async (): Promise<CrewWithMembers | null> => {
      const { data, error } = await supabase.from("crews").select(CREW_SELECT).eq("id", crewId ?? "").maybeSingle();
      if (error) throw error;
      return data ? sortMembers(data as unknown as CrewWithMembers) : null;
    },
  });
}

export function myRole(crew: CrewWithMembers | null | undefined, userId: string): CrewRole | null {
  return crew?.members.find((m) => m.user_id === userId)?.role ?? null;
}

export const canManageCrew = (role: CrewRole | null) => role === "owner" || role === "admin";

/** Nach jeder Änderung an Crews hängen auch sichtbare Profile, Abstimmungen und Pläne davon ab. */
function useInvalidateCrews() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: qk.crews });
    void client.invalidateQueries({ queryKey: qk.people });
    void client.invalidateQueries({ queryKey: qk.polls });
    void client.invalidateQueries({ queryKey: qk.plans });
  };
}

export function useCreateCrew() {
  const invalidate = useInvalidateCrews();
  return useMutation({
    mutationFn: async (input: { name: string; emoji: string }): Promise<string> => {
      const { data, error } = await supabase.rpc("create_crew", { p_name: input.name, p_emoji: input.emoji });
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateCrew(crewId: string) {
  const invalidate = useInvalidateCrews();
  return useMutation({
    mutationFn: async (input: { name: string; emoji: string }) => {
      const { data, error } = await supabase.from("crews").update({ name: input.name, emoji: input.emoji }).eq("id", crewId).select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw { code: "42501", message: "forbidden" };
    },
    onSuccess: invalidate,
  });
}

export function useDeleteCrew(crewId: string) {
  const invalidate = useInvalidateCrews();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.from("crews").delete().eq("id", crewId).select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw { code: "42501", message: "forbidden" };
    },
    onSuccess: invalidate,
  });
}

export function useLeaveCrew(crewId: string) {
  const invalidate = useInvalidateCrews();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("leave_crew", { p_crew_id: crewId });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useRemoveMember(crewId: string) {
  const invalidate = useInvalidateCrews();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc("remove_crew_member", { p_crew_id: crewId, p_user_id: userId });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useSetMemberRole(crewId: string) {
  const invalidate = useInvalidateCrews();
  return useMutation({
    mutationFn: async (input: { userId: string; role: CrewRole }) => {
      const { error } = await supabase.rpc("set_crew_member_role", { p_crew_id: crewId, p_user_id: input.userId, p_role: input.role });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

// ---- Einladungen ------------------------------------------------------------------------------------

export type InvitationState = "active" | "revoked" | "expired" | "exhausted";

export function invitationState(inv: CrewInvitation, now: Date = new Date()): InvitationState {
  if (inv.revoked_at) return "revoked";
  if (new Date(inv.expires_at) <= now) return "expired";
  if (inv.use_count >= inv.max_uses) return "exhausted";
  return "active";
}

export function useCrewInvitations(crewId: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.crewInvitations(crewId),
    enabled,
    queryFn: async (): Promise<CrewInvitation[]> => {
      // Spalten ausdrücklich nennen: token_hash ist per Spaltenrecht gesperrt.
      const { data, error } = await supabase
        .from("crew_invitations")
        .select("id, crew_id, invited_by, expires_at, revoked_at, max_uses, use_count, created_at")
        .eq("crew_id", crewId)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data as CrewInvitation[];
    },
  });
}

export interface CreatedInvitation {
  id: string;
  token: string;
  expires_at: string;
  max_uses: number;
}

export function useCreateInvitation(crewId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { expiresInHours: number; maxUses: number }): Promise<CreatedInvitation> => {
      const { data, error } = await supabase.rpc("create_crew_invitation", {
        p_crew_id: crewId,
        p_expires_in_hours: input.expiresInHours,
        p_max_uses: input.maxUses,
      });
      if (error) throw error;
      const row = (data as CreatedInvitation[])[0];
      if (!row) throw new Error("no invitation returned");
      return row;
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.crewInvitations(crewId) }),
  });
}

export function useRevokeInvitation(crewId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (invitationId: string) => {
      const { error } = await supabase.rpc("revoke_crew_invitation", { p_invitation_id: invitationId });
      if (error) throw error;
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.crewInvitations(crewId) }),
  });
}

export type InvitationPreview =
  | { status: "valid"; crew: { id: string; name: string; emoji: string; member_count: number }; invited_by: string | null; expires_at: string }
  | { status: "already_member"; crew_id: string }
  | { status: "not_found" | "revoked" | "expired" | "exhausted" };

export function useInvitationPreview(token: string | undefined) {
  return useQuery({
    queryKey: qk.invitationPreview(token ?? "none"),
    enabled: Boolean(token),
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<InvitationPreview> => {
      const { data, error } = await supabase.rpc("preview_crew_invitation", { p_token: token ?? "" });
      if (error) throw error;
      return data as InvitationPreview;
    },
  });
}

export type AcceptResult = { status: "joined" | "already_member"; crew_id: string } | { status: "not_found" | "revoked" | "expired" | "exhausted" | "crew_full" | "crew_limit_reached" };

export function useAcceptInvitation() {
  const invalidate = useInvalidateCrews();
  return useMutation({
    mutationFn: async (token: string): Promise<AcceptResult> => {
      const { data, error } = await supabase.rpc("accept_crew_invitation", { p_token: token });
      if (error) throw error;
      return data as AcceptResult;
    },
    onSuccess: invalidate,
  });
}

/** Zieht den Token aus einem eingefügten Link oder Code. */
export function extractInviteToken(input: string): string | null {
  const match = /([a-f0-9]{64})/i.exec(input.trim());
  return match?.[1]?.toLowerCase() ?? null;
}

// ---- Crew-Chat ---------------------------------------------------------------------------------------

export function useCrewMessages(crewId: string, enabled: boolean) {
  const client = useQueryClient();
  useRealtime(enabled ? `crew-messages:${crewId}` : null, [{ table: "crew_messages", filter: `crew_id=eq.${crewId}` }], () => {
    void client.invalidateQueries({ queryKey: qk.crewMessages(crewId) });
  });
  return useQuery({
    queryKey: qk.crewMessages(crewId),
    enabled,
    refetchInterval: 10_000,
    queryFn: async (): Promise<CrewMessage[]> => {
      const { data, error } = await supabase.from("crew_messages").select("*").eq("crew_id", crewId).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data as CrewMessage[]).reverse();
    },
  });
}

export function useSendMessage(crewId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: string) => {
      const { error } = await supabase.rpc("send_crew_message", { p_crew_id: crewId, p_body: body });
      if (error) throw error;
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.crewMessages(crewId) }),
  });
}

export function useDeleteMessage(crewId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (messageId: string) => {
      const { error } = await supabase.from("crew_messages").delete().eq("id", messageId);
      if (error) throw error;
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.crewMessages(crewId) }),
  });
}
