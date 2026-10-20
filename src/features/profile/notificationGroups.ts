import { t } from "@/i18n";
import type { NotificationType, UserSettings } from "@/lib/types";

/** Einstellbare Gruppen. Jede schaltet einen oder mehrere Benachrichtigungstypen. */
export const NOTIFICATION_GROUPS: { key: keyof typeof t.settings.notifications.groups; types: NotificationType[] }[] = [
  { key: "polls", types: ["poll_created"] },
  { key: "reminders", types: ["poll_reminder"] },
  { key: "answers", types: ["poll_vote", "plan_attendance"] },
  { key: "results", types: ["poll_result"] },
  { key: "plans", types: ["plan_created", "plan_changed", "plan_cancelled"] },
  { key: "bookings", types: ["booking_status"] },
  { key: "rides", types: ["ride_request", "ride_confirmed"] },
  { key: "costs", types: ["plan_expense", "plan_settlement"] },
  { key: "spontaneous", types: ["spontaneous_ask", "spontaneous_answer", "spontaneous_match"] },
  { key: "crew", types: ["crew_member_joined", "crew_role_changed", "crew_member_removed"] },
  { key: "rewards", types: ["reward_earned"] },
];

type Preferences = UserSettings["notification_preferences"];

export function isGroupEnabled(preferences: Preferences, types: NotificationType[]): boolean {
  return types.every((type) => preferences[type] !== false);
}

export function setGroup(preferences: Preferences, types: NotificationType[], enabled: boolean): Preferences {
  const next = { ...preferences };
  for (const type of types) next[type] = enabled;
  return next;
}
