import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/AuthProvider";
import { qk } from "@/lib/query";
import { useRealtime } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";
import type { AttendanceStatus, BookingRequest, BookingStatus, Plan, PlanExpense, PlanExpenseShare, PlanParticipant, PlanStatus, RideOffer, RideRequest } from "@/lib/types";

export interface PlanWithParticipants extends Plan {
  participants: PlanParticipant[];
}

const PLAN_SELECT = "*, participants:plan_participants(*)";

export const ACTIVE_PLAN_STATUSES: PlanStatus[] = ["proposed", "confirmed", "booking_pending", "booked"];

/** Anstehend = aktiv und noch nicht länger als sechs Stunden vorbei (so bleibt ein laufender Abend sichtbar). */
export function isUpcoming(plan: Plan, now: Date = new Date()): boolean {
  return ACTIVE_PLAN_STATUSES.includes(plan.status) && new Date(plan.starts_at).getTime() > now.getTime() - 6 * 3600_000;
}

export function hasStarted(plan: Plan, now: Date = new Date()): boolean {
  return new Date(plan.starts_at) <= now;
}

export interface CostEstimate {
  perPersonCents: number | null;
  totalCents: number | null;
  goingCount: number;
}

/** Kosten pro Person und gesamt; fehlt eine der beiden Angaben, wird sie aus den Zusagen berechnet. */
export function estimateCosts(plan: PlanWithParticipants): CostEstimate {
  const goingCount = plan.participants.filter((p) => p.attendance_status === "going").length;
  const perPerson = plan.estimated_cost_per_person_cents;
  const total = plan.estimated_total_cost_cents;
  return {
    goingCount,
    perPersonCents: perPerson ?? (total != null && goingCount > 0 ? Math.round(total / goingCount) : null),
    totalCents: total ?? (perPerson != null && goingCount > 0 ? perPerson * goingCount : null),
  };
}

export function usePlans() {
  return useQuery({
    queryKey: qk.plans,
    queryFn: async (): Promise<PlanWithParticipants[]> => {
      const { data, error } = await supabase.from("plans").select(PLAN_SELECT).order("starts_at", { ascending: true }).limit(200);
      if (error) throw error;
      return data as unknown as PlanWithParticipants[];
    },
  });
}

export function usePlan(planId: string | undefined) {
  const client = useQueryClient();
  useRealtime(
    planId ? `plan:${planId}` : null,
    [
      { table: "plans", filter: `id=eq.${planId}` },
      { table: "plan_participants", filter: `plan_id=eq.${planId}` },
    ],
    () => void client.invalidateQueries({ queryKey: qk.plan(planId ?? "none") }),
  );
  return useQuery({
    queryKey: qk.plan(planId ?? "none"),
    enabled: Boolean(planId),
    refetchInterval: 20_000,
    // Kommt man aus einer Liste, steht der Plan dort schon (gleiche Spalten): Seite sofort zeigen,
    // im Hintergrund frisch laden. Ohne Ladezustand kann das Ticket zur Planseite hinübergleiten.
    placeholderData: () => client.getQueryData<PlanWithParticipants[]>(qk.plans)?.find((p) => p.id === planId),
    queryFn: async (): Promise<PlanWithParticipants | null> => {
      const { data, error } = await supabase.from("plans").select(PLAN_SELECT).eq("id", planId ?? "").maybeSingle();
      if (error) throw error;
      return (data as unknown as PlanWithParticipants | null) ?? null;
    },
  });
}

function useInvalidatePlans() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: qk.plans });
    void client.invalidateQueries({ queryKey: qk.rewards });
  };
}

export interface PlanFormValues {
  title: string;
  startsAt: Date;
  endsAt?: Date | null;
  address?: string | null;
  meetingPoint?: string | null;
  notes?: string | null;
  costPerPersonCents?: number | null;
  totalCostCents?: number | null;
}

export function useCreatePlan() {
  const invalidate = useInvalidatePlans();
  return useMutation({
    mutationFn: async (input: PlanFormValues & { crewId: string; activityId?: string | null; confirmed: boolean }): Promise<string> => {
      const { data, error } = await supabase.rpc("create_plan", {
        p_crew_id: input.crewId,
        p_title: input.title,
        p_starts_at: input.startsAt.toISOString(),
        p_activity_id: input.activityId ?? null,
        p_address: input.address ?? null,
        p_meeting_point: input.meetingPoint ?? null,
        p_notes: input.notes ?? null,
        p_cost_per_person_cents: input.costPerPersonCents ?? null,
        p_total_cost_cents: input.totalCostCents ?? null,
        p_ends_at: input.endsAt?.toISOString() ?? null,
        p_confirmed: input.confirmed,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });
}

export function useCreatePlanFromPoll() {
  const invalidate = useInvalidatePlans();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { pollId: string; optionId: string; startsAt: Date; title: string; address: string | null; meetingPoint: string | null; notes: string | null; costPerPersonCents: number | null }): Promise<string> => {
      const { data, error } = await supabase.rpc("create_plan_from_poll", {
        p_poll_id: input.pollId,
        p_option_id: input.optionId,
        p_starts_at: input.startsAt.toISOString(),
        p_title: input.title,
        p_address: input.address,
        p_meeting_point: input.meetingPoint,
        p_notes: input.notes,
        p_cost_per_person_cents: input.costPerPersonCents,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      invalidate();
      void client.invalidateQueries({ queryKey: qk.polls });
    },
  });
}

export function useUpdatePlan(planId: string) {
  const invalidate = useInvalidatePlans();
  return useMutation({
    mutationFn: async (input: PlanFormValues) => {
      const { error } = await supabase.rpc("update_plan", {
        p_plan_id: planId,
        p_title: input.title,
        p_starts_at: input.startsAt.toISOString(),
        p_ends_at: input.endsAt?.toISOString() ?? null,
        p_address: input.address ?? null,
        p_meeting_point: input.meetingPoint ?? null,
        p_notes: input.notes ?? null,
        p_cost_per_person_cents: input.costPerPersonCents ?? null,
        p_total_cost_cents: input.totalCostCents ?? null,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useSetPlanStatus(planId: string) {
  const invalidate = useInvalidatePlans();
  return useMutation({
    mutationFn: async (status: PlanStatus) => {
      const { error } = await supabase.rpc("set_plan_status", { p_plan_id: planId, p_status: status });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useSetAttendance(planId: string) {
  const client = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (status: Exclude<AttendanceStatus, "invited">) => {
      const { error } = await supabase.rpc("set_attendance", { p_plan_id: planId, p_status: status });
      if (error) throw error;
    },
    onMutate: async (status) => {
      await client.cancelQueries({ queryKey: qk.plan(planId) });
      const previous = client.getQueryData<PlanWithParticipants | null>(qk.plan(planId));
      if (previous && user) {
        client.setQueryData<PlanWithParticipants | null>(qk.plan(planId), (old) =>
          old
            ? { ...old, participants: old.participants.map((p) => (p.user_id === user.id ? { ...p, attendance_status: status, responded_at: new Date().toISOString() } : p)) }
            : old,
        );
      }
      return { previous };
    },
    onError: (_error, _status, context) => {
      if (context?.previous !== undefined) client.setQueryData(qk.plan(planId), context.previous);
    },
    onSettled: () => void client.invalidateQueries({ queryKey: qk.plans }),
  });
}

// ---- Reservierungen ------------------------------------------------------------------------------

export const ACTIVE_BOOKING_STATUSES: BookingStatus[] = ["not_started", "in_progress", "awaiting_response"];

export function useBookings(planId: string) {
  return useQuery({
    queryKey: qk.planBookings(planId),
    queryFn: async (): Promise<BookingRequest[]> => {
      const { data, error } = await supabase.from("booking_requests").select("*").eq("plan_id", planId).order("created_at", { ascending: false });
      if (error) throw error;
      return data as BookingRequest[];
    },
  });
}

function useBookingAction<TInput>(planId: string, fn: (input: TInput) => Promise<void>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.plans }),
    onSettled: () => void client.invalidateQueries({ queryKey: qk.planBookings(planId) }),
  });
}

export function useCreateBooking(planId: string) {
  return useBookingAction(planId, async (input: { date: string; time: string; partySize: number; specialRequests: string | null }) => {
    const { error } = await supabase.rpc("create_booking_request", {
      p_plan_id: planId,
      p_requested_date: input.date,
      p_requested_time: input.time,
      p_party_size: input.partySize,
      p_special_requests: input.specialRequests,
    });
    if (error) throw error;
  });
}

export function useConfirmBooking(planId: string) {
  return useBookingAction(planId, async (bookingId: string) => {
    const { error } = await supabase.rpc("confirm_booking_request", { p_booking_id: bookingId });
    if (error) throw error;
  });
}

export function useRecordBookingOutcome(planId: string) {
  return useBookingAction(planId, async (input: { bookingId: string; status: "awaiting_response" | "confirmed" | "unavailable" | "failed"; reference?: string | null }) => {
    const { error } = await supabase.rpc("record_booking_outcome", { p_booking_id: input.bookingId, p_status: input.status, p_reference: input.reference ?? null });
    if (error) throw error;
  });
}

export function useCancelBooking(planId: string) {
  return useBookingAction(planId, async (bookingId: string) => {
    const { error } = await supabase.rpc("cancel_booking_request", { p_booking_id: bookingId });
    if (error) throw error;
  });
}

// ---- Fahrgemeinschaften --------------------------------------------------------------------------

export interface RideOfferWithRequests extends RideOffer {
  requests: RideRequest[];
}

export function useRides(planId: string) {
  return useQuery({
    queryKey: qk.planRides(planId),
    refetchInterval: 30_000,
    queryFn: async (): Promise<RideOfferWithRequests[]> => {
      const { data, error } = await supabase.from("ride_offers").select("*, requests:ride_requests(*)").eq("plan_id", planId).order("departure_time", { ascending: true });
      if (error) throw error;
      return data as unknown as RideOfferWithRequests[];
    },
  });
}

function useRideAction<TInput>(planId: string, fn: (input: TInput) => Promise<void>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => void client.invalidateQueries({ queryKey: qk.planRides(planId) }),
  });
}

export function useOfferRide(planId: string) {
  return useRideAction(planId, async (input: { departureArea: string; departureTime: Date; seats: number; returnTrip: boolean; note: string | null }) => {
    const { error } = await supabase.rpc("create_ride_offer", {
      p_plan_id: planId,
      p_departure_area: input.departureArea,
      p_departure_time: input.departureTime.toISOString(),
      p_available_seats: input.seats,
      p_destination: null,
      p_return_trip: input.returnTrip,
      p_note: input.note,
    });
    if (error) throw error;
  });
}

export function useCancelRideOffer(planId: string) {
  return useRideAction(planId, async (offerId: string) => {
    const { error } = await supabase.rpc("cancel_ride_offer", { p_offer_id: offerId });
    if (error) throw error;
  });
}

export function useRequestRide(planId: string) {
  return useRideAction(planId, async (offerId: string) => {
    const { error } = await supabase.rpc("request_ride", { p_offer_id: offerId, p_seats: 1 });
    if (error) throw error;
  });
}

export function useRespondRide(planId: string) {
  return useRideAction(planId, async (input: { requestId: string; accept: boolean }) => {
    const { error } = await supabase.rpc("respond_ride_request", { p_request_id: input.requestId, p_accept: input.accept });
    if (error) throw error;
  });
}

export function useCancelRideRequest(planId: string) {
  return useRideAction(planId, async (requestId: string) => {
    const { error } = await supabase.rpc("cancel_ride_request", { p_request_id: requestId });
    if (error) throw error;
  });
}

// ---- Kosten aufteilen (P3) ------------------------------------------------------------------------

export interface PlanExpenseWithShares extends PlanExpense {
  shares: Pick<PlanExpenseShare, "user_id" | "amount_cents">[];
}

export function usePlanExpenses(planId: string) {
  const client = useQueryClient();
  useRealtime(
    `plan-expenses:${planId}`,
    [{ table: "plan_expenses", filter: `plan_id=eq.${planId}` }],
    () => void client.invalidateQueries({ queryKey: qk.planExpenses(planId) }),
  );
  return useQuery({
    queryKey: qk.planExpenses(planId),
    refetchInterval: 30_000,
    queryFn: async (): Promise<PlanExpenseWithShares[]> => {
      const { data, error } = await supabase
        .from("plan_expenses")
        .select("*, shares:plan_expense_shares(user_id, amount_cents)")
        .eq("plan_id", planId)
        .order("created_at", { ascending: false })
        .limit(250);
      if (error) throw error;
      return data as unknown as PlanExpenseWithShares[];
    },
  });
}

function useExpenseAction<TInput>(planId: string, fn: (input: TInput) => Promise<void>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => void client.invalidateQueries({ queryKey: qk.planExpenses(planId) }),
  });
}

export function useAddExpense(planId: string) {
  return useExpenseAction(planId, async (input: { description: string; amountCents: number; paidBy: string; splitWith: string[] }) => {
    const { error } = await supabase.rpc("add_plan_expense", {
      p_plan_id: planId,
      p_description: input.description,
      p_amount_cents: input.amountCents,
      p_paid_by: input.paidBy,
      p_split_with: input.splitWith,
    });
    if (error) throw error;
  });
}

export function useRecordSettlement(planId: string) {
  return useExpenseAction(planId, async (input: { from: string; to: string; cents: number }) => {
    const { error } = await supabase.rpc("record_plan_settlement", { p_plan_id: planId, p_from: input.from, p_to: input.to, p_amount_cents: input.cents });
    if (error) throw error;
  });
}

export function useDeleteExpense(planId: string) {
  return useExpenseAction(planId, async (expenseId: string) => {
    const { error } = await supabase.rpc("delete_plan_expense", { p_expense_id: expenseId });
    if (error) throw error;
  });
}

/*
 * W2 · Teilen-Karte: Ein Plan bekommt beim ersten Teilen einen eigenen Link /s/<token>. Messenger
 * zeigen dazu eine Vorschau, Freunde ohne Konto eine Karte in der App, Mitglieder landen beim Plan.
 * Der Token wird beim Öffnen der Planseite geholt, damit das Teilen-Menü ohne Wartezeit aufgeht.
 */
export function usePlanShareToken(planId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["plan-share-token", planId ?? "none"] as const,
    enabled: Boolean(planId) && enabled,
    staleTime: Infinity,
    gcTime: 60 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async (): Promise<string> => {
      const { data, error } = await supabase.rpc("plan_share_token", { p_plan_id: planId });
      if (error) throw error;
      return data as string;
    },
  });
}

export type SharedPlanPreview =
  | {
      status: "valid";
      plan: { title: string; starts_at: string; ends_at: string | null; status: PlanStatus; going_count: number };
      /** Nur für Mitglieder der Crew – sonst null. */
      plan_id: string | null;
    }
  | { status: "not_found" | "expired" };

/** `viewer`: angemeldete Person oder null – die Antwort hängt davon ab (Plan-ID nur für Mitglieder). */
export function useSharedPlanPreview(token: string | undefined, viewer: string | null, enabled = true) {
  return useQuery({
    queryKey: ["plan-share-preview", token ?? "none", viewer ?? "anon"] as const,
    enabled: Boolean(token) && enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async (): Promise<SharedPlanPreview> => {
      const { data, error } = await supabase.rpc("preview_shared_plan", { p_token: token ?? "" });
      if (error) throw error;
      return data as SharedPlanPreview;
    },
  });
}
