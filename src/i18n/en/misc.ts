import type {
  notifications as deNotifications,
  profile as deProfile,
} from "../de/misc";

export const notifications = {
  title: "Notifications",
  bellUnread: (n: number) => (n === 1 ? "Notifications, 1 unread" : `Notifications, ${n} unread`),
  markAllRead: "Mark all as read",
  empty: { title: "All caught up", body: "New polls, plan changes and replies from your crew show up here." },
  unread: "Unread",
  delete: "Delete notification",
  someone: "Someone",
  pushNote: "On your phone too, even when the app is closed: turn on push notifications per device in Settings.",
  /** P4: Text im Service Worker, wenn ein Push unbekannt oder unvollständig ist. */
  push: { fallbackTitle: "AFTERHOURS", fallbackBody: "Something new in your crew" },
  manage: "Notification settings",
  statusUnread: (n: number) => `${n} new`,
  statusAllRead: "All caught up",
  statusTotal: (n: number) => (n === 1 ? "1 item" : `${n} items`),
  groups: { today: "Today", yesterday: "Yesterday", week: "This week", older: "Earlier" },
  areas: { poll: "Poll", plan: "Plan", crew: "Crew", money: "Costs", spontaneous: "Anyone out tonight?", reward: "Points" },
} satisfies typeof deNotifications;

export const profile = {
  title: "Profile",
  edit: "Edit profile",
  noCity: "No city given",
  interests: "Interests",
  noInterests: "No interests chosen yet.",
  stats: { crews: "Crews", planned: "Planned", completed: "Done", points: "Points" },
  crews: "Your crews",
  pass: {
    label: "Regular's card",
    evenings: (n: number) => (n === 1 ? "evening out" : "evenings out"),
    since: (monthYear: string) => `Member since ${monthYear}`,
  },
  signOut: "Log out",
  links: { settings: "Settings", notifications: "Notifications", privacy: "Privacy and your data", admin: "Admin area", assistant: "Planning assistant" },
} satisfies typeof deProfile;
