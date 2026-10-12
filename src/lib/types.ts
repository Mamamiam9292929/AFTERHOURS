/**
 * Zeilentypen der Datenbank (siehe supabase/migrations). Von Hand gepflegt, damit das Projekt ohne
 * laufende Supabase-CLI baut. Alternative: `supabase gen types typescript` und diese Datei ersetzen.
 */
export type CrewRole = "owner" | "admin" | "member";
export type LocationSharingMode = "off" | "during_activity" | "selected_friends" | "crew";
export type ActivityCategory =
  | "restaurant" | "cafe" | "bar" | "cinema" | "bowling" | "minigolf" | "swimming" | "lasertag"
  | "escape_room" | "karting" | "sport" | "outdoor" | "concert" | "event" | "trip" | "other";
export type ActivitySource = "demo" | "provider" | "partner" | "manual";
export type ActivitySetting = "indoor" | "outdoor" | "both";
export type PollStatus = "open" | "closed";
export type VoteResponse = "yes" | "maybe" | "no";
export type PlanStatus = "proposed" | "confirmed" | "booking_pending" | "booked" | "completed" | "cancelled";
export type AttendanceStatus = "invited" | "going" | "maybe" | "declined";
export type BookingStatus =
  | "not_started" | "in_progress" | "awaiting_response" | "confirmed" | "unavailable" | "failed" | "cancelled_by_user";
export type RideOfferStatus = "open" | "cancelled" | "completed";
export type RideRequestStatus = "requested" | "accepted" | "declined" | "cancelled";
export type ReportStatus = "open" | "resolved" | "dismissed";
export type Interest =
  | "food" | "sport" | "cinema" | "outdoor" | "nightlife" | "music" | "gaming" | "adventure" | "culture" | "relax";

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
/** Pro Wochentag eine Liste von [von, bis]-Paaren ("HH:MM"). Leere Liste = geschlossen. */
export type OpeningHours = Partial<Record<Weekday, [string, string][]>>;

export interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  city: string | null;
  interests: Interest[];
  favorite_categories: ActivityCategory[];
  onboarded_at: string | null;
  created_at: string;
  updated_at: string;
}

export type NotificationType =
  | "crew_member_joined" | "crew_member_removed" | "crew_role_changed"
  | "poll_created" | "poll_reminder" | "poll_vote" | "poll_result"
  | "plan_created" | "plan_changed" | "plan_cancelled" | "plan_attendance"
  | "booking_status" | "ride_request" | "ride_confirmed" | "reward_earned";

export interface UserSettings {
  user_id: string;
  location_sharing_mode: LocationSharingMode;
  location_sharing_crew_id: string | null;
  typical_budget_cents: number | null;
  preferred_distance_km: number | null;
  notification_preferences: Partial<Record<NotificationType, boolean>>;
  privacy_preferences: Record<string, unknown>;
  updated_at: string;
}

export interface Crew {
  id: string;
  name: string;
  emoji: string;
  image_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrewMember {
  crew_id: string;
  user_id: string;
  role: CrewRole;
  joined_at: string;
}

export interface CrewInvitation {
  id: string;
  crew_id: string;
  invited_by: string | null;
  expires_at: string;
  revoked_at: string | null;
  max_uses: number;
  use_count: number;
  created_at: string;
}

export interface CrewMessage {
  id: string;
  crew_id: string;
  user_id: string | null;
  body: string;
  created_at: string;
}

export interface Activity {
  id: string;
  provider_id: string;
  external_id: string | null;
  name: string;
  category: ActivityCategory;
  description: string | null;
  address: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  price_min_cents: number | null;
  price_max_cents: number | null;
  currency: string;
  opening_hours: OpeningHours | null;
  booking_url: string | null;
  website_url: string | null;
  phone: string | null;
  image_url: string | null;
  duration_minutes: number | null;
  setting: ActivitySetting | null;
  min_age: number | null;
  group_min: number | null;
  group_max: number | null;
  rating: number | null;
  rating_count: number | null;
  rating_source: string | null;
  data_source: ActivitySource;
  is_demo: boolean;
  is_active: boolean;
  last_verified_at: string | null;
  /** Öffnungszeiten im OSM-Originalformat, wenn sie sich nicht sicher übersetzen ließen. */
  opening_hours_raw: string | null;
  /** Link zum Eintrag bei der Datenquelle (z. B. OpenStreetMap). */
  source_url: string | null;
  quality: number;
  created_at: string;
  updated_at: string;
}

export interface Poll {
  id: string;
  crew_id: string;
  created_by: string | null;
  parent_poll_id: string | null;
  title: string;
  description: string | null;
  meeting_point: string | null;
  budget_cents: number | null;
  min_participants: number | null;
  ends_at: string;
  status: PollStatus;
  winning_option_id: string | null;
  is_tie: boolean;
  closed_at: string | null;
  closed_by: string | null;
  last_reminded_at: string | null;
  created_at: string;
}

export interface PollOption {
  id: string;
  poll_id: string;
  activity_id: string | null;
  title: string;
  proposed_date: string | null;
  proposed_time: string | null;
  estimated_price_cents: number | null;
  position: number;
}

export interface PollVote {
  id: string;
  poll_id: string;
  poll_option_id: string;
  user_id: string;
  response: VoteResponse;
  updated_at: string;
}

export interface Plan {
  id: string;
  crew_id: string;
  created_by: string | null;
  poll_id: string | null;
  activity_id: string | null;
  title: string;
  starts_at: string;
  ends_at: string | null;
  address: string | null;
  meeting_point: string | null;
  notes: string | null;
  estimated_cost_per_person_cents: number | null;
  estimated_total_cost_cents: number | null;
  currency: string;
  status: PlanStatus;
  booking_status: BookingStatus;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlanParticipant {
  plan_id: string;
  user_id: string;
  attendance_status: AttendanceStatus;
  responded_at: string | null;
  joined_at: string;
}

export interface BookingRequest {
  id: string;
  plan_id: string;
  activity_id: string | null;
  provider_id: string | null;
  channel: "manual" | "online" | "phone_agent";
  is_test: boolean;
  requested_date: string;
  requested_time: string;
  party_size: number;
  special_requests: string | null;
  status: BookingStatus;
  provider_confirmation_reference: string | null;
  confirmed_by_user_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RideOffer {
  id: string;
  plan_id: string;
  driver_user_id: string;
  departure_area: string;
  departure_time: string;
  available_seats: number;
  destination: string | null;
  return_trip: boolean;
  note: string | null;
  status: RideOfferStatus;
  created_at: string;
}

export interface RideRequest {
  id: string;
  ride_offer_id: string;
  passenger_user_id: string;
  seats_requested: number;
  status: RideRequestStatus;
  created_at: string;
  updated_at: string;
}

export interface RewardTransaction {
  id: string;
  user_id: string;
  points_delta: number;
  reason: "plan_organized" | "plan_attended" | "partner_bonus" | "admin_adjustment";
  related_entity_id: string | null;
  created_at: string;
}

export interface AppNotification {
  id: string;
  user_id: string;
  type: NotificationType;
  actor_id: string | null;
  crew_id: string | null;
  entity_type: "crew" | "poll" | "plan" | "ride_offer" | "reward" | null;
  related_entity_id: string | null;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface Report {
  id: string;
  reporter_id: string | null;
  entity_type: string;
  entity_id: string;
  reason: string;
  status: ReportStatus;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface AuditLogEntry {
  id: number;
  actor_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  crew_id: string | null;
  meta: Record<string, unknown>;
  created_at: string;
}
