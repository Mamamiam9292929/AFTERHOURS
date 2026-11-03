import { formatDateTime, formatEuro, formatTime } from "./format";
import type { NotificationType } from "@/lib/types";
import { localizedServerTitle } from "@/lib/servertitle";
import type {
  notifications as deNotifications,
  profile as deProfile,
  settings as deSettings,
} from "../de/misc";

type Payload = Record<string, unknown>;
const str = (payload: Payload, key: string, fallback = "") => (typeof payload[key] === "string" ? (payload[key] as string) : fallback);
/** P11 Etappe 2e: Titel aus dem Server, „Stichwahl: …“ wird zu „Runoff: …“ (sonst unverändert). */
const serverTitle = (payload: Payload) => localizedServerTitle(str(payload, "title"), "en");

/** Texte für Benachrichtigungen. `actor` ist der Anzeigename der auslösenden Person (falls bekannt). */
const notificationText: Record<NotificationType, (actor: string, payload: Payload) => { title: string; body?: string }> = {
  crew_member_joined: (actor) => ({ title: `${actor} joined your crew` }),
  crew_member_removed: (_actor, p) => ({ title: `You were removed from “${str(p, "crew_name", "a crew")}”` }),
  crew_role_changed: (_actor, p) => ({
    title: p.role === "owner" ? "You're now the crew's owner" : p.role === "admin" ? "You're now a crew admin" : "Your role in the crew has changed",
    body: p.reason === "succession" ? "The previous owner left the crew." : undefined,
  }),
  poll_created: (actor, p) => ({
    title: p.repeat
      ? "New round – what's on this week?"
      : p.auto && p.runoff
        ? "It's a tie – the runoff is on"
        : p.runoff
          ? `${actor} started a runoff`
          : `${actor} started a poll`,
    body: serverTitle(p),
  }),
  poll_reminder: (actor, p) =>
    p.closing
      ? { title: str(p, "ends_at") ? `Closes at ${formatTime(str(p, "ends_at"))} – your vote is missing` : "Closing soon – your vote is missing", body: serverTitle(p) }
      : { title: `${actor} is reminding you about a poll`, body: serverTitle(p) },
  poll_vote: (actor, p) => ({ title: p.guest ? `${str(p, "guest")} (guest) voted` : `${actor} voted`, body: serverTitle(p) }),
  poll_result: (_actor, p) => ({
    title: p.winner_title ? `Result: ${str(p, "winner_title")}` : p.is_tie ? "Poll ended in a tie" : "Poll ended with no yes votes",
    body: serverTitle(p),
  }),
  plan_created: (actor, p) =>
    p.repeat
      ? { title: "The next date is set – are you in?", body: str(p, "starts_at") ? `${serverTitle(p)} · ${formatDateTime(str(p, "starts_at"))}` : serverTitle(p) }
      : p.auto
        ? { title: "Decided – the plan is set", body: str(p, "starts_at") ? `${serverTitle(p)} · ${formatDateTime(str(p, "starts_at"))}` : serverTitle(p) }
        : { title: `${actor} created a plan`, body: serverTitle(p) },
  plan_changed: (actor, p) => {
    const labels: Record<string, string> = { starts_at: "time", address: "place", meeting_point: "meeting point", cost: "cost" };
    const changed = Array.isArray(p.changed) ? (p.changed as string[]).map((key) => labels[key] ?? key).join(", ") : "";
    return { title: `${actor} changed a plan${changed ? `: ${changed}` : ""}`, body: serverTitle(p) };
  },
  plan_cancelled: (actor, p) =>
    p.skipped
      ? {
          title: `${actor} is skipping this one: ${serverTitle(p)}`,
          body: str(p, "next_starts_at") ? `Next date: ${formatDateTime(str(p, "next_starts_at"))}` : "The regular carries on.",
        }
      : { title: `${actor} cancelled a plan`, body: serverTitle(p) },
  plan_attendance: (actor, p) => ({
    title: p.status === "going" ? `${actor} is in` : p.status === "maybe" ? `${actor} might come` : `${actor} can't make it`,
    body: serverTitle(p),
  }),
  booking_status: (_actor, p) => {
    const status: Record<string, string> = { confirmed: "Booking confirmed", unavailable: "Booking not possible: nothing available", failed: "Booking failed", cancelled_by_user: "Booking cancelled" };
    return { title: status[str(p, "status")] ?? "Booking status changed", body: serverTitle(p) };
  },
  ride_request: (actor, p) => ({ title: `${actor} would like a ride with you`, body: serverTitle(p) }),
  ride_confirmed: (actor, p) => ({ title: p.accepted ? `${actor} will give you a ride` : `${actor} can't give you a ride`, body: serverTitle(p) }),
  plan_expense: (actor, p) => ({
    title: p.you_paid ? `${actor} noted that you paid for “${str(p, "description")}”` : `${actor} added “${str(p, "description")}”`,
    body: [typeof p.share_cents === "number" ? `Your share: ${formatEuro(p.share_cents)}` : typeof p.amount_cents === "number" ? formatEuro(p.amount_cents) : "", serverTitle(p)].filter(Boolean).join(" · "),
  }),
  plan_settlement: (actor, p) => {
    const amount = typeof p.amount_cents === "number" ? formatEuro(p.amount_cents) : "";
    if (p.bundle) {
      const count = typeof p.plan_count === "number" ? p.plan_count : 0;
      const body = [count > 0 ? (count === 1 ? "1 evening settled" : `${count} evenings settled`) : "", str(p, "crew_name")].filter(Boolean).join(" · ");
      if (p.direction === "offset") return { title: `${actor} offset your open balances – you're even`, body };
      return { title: p.direction === "received" ? `${actor} confirmed you paid back ${amount}` : `${actor} paid you back ${amount} in one go`, body };
    }
    return { title: p.direction === "received" ? `${actor} confirmed your repayment of ${amount}` : `${actor} paid you back ${amount}`, body: serverTitle(p) };
  },
  spontaneous_ask: (actor, p) => ({
    title: `${actor}: Anyone out tonight?`,
    body: [str(p, "note"), str(p, "crew_name"), str(p, "expires_at") ? `until ${formatTime(str(p, "expires_at"))}` : ""].filter(Boolean).join(" · "),
  }),
  spontaneous_answer: (actor, p) => ({ title: `${actor} is up for it`, body: [str(p, "note"), str(p, "crew_name")].filter(Boolean).join(" · ") }),
  spontaneous_match: (_actor, p) => ({
    title: typeof p.in_count === "number" ? `There are ${p.in_count} of you – tonight's on!` : "There are enough of you – tonight's on!",
    body: [str(p, "note"), str(p, "crew_name")].filter(Boolean).join(" · "),
  }),
  plan_expense_reminder: (_actor, p) => {
    const balance = typeof p.balance_cents === "number" ? p.balance_cents : 0;
    const title = str(p, "title", "your evening");
    return balance > 0
      ? { title: `You're still owed ${formatEuro(balance)} for “${title}”`, body: "Already paid back? Then tap “Done” under “Split costs”." }
      : { title: `You still owe ${formatEuro(-balance)} for “${title}”`, body: "Already sorted? Then tap “Done” under “Split costs”." };
  },
  plan_photo_reported: (_actor, p) => ({
    title: `Photo reported for “${serverTitle(p)}”`,
    body: p.own
      ? "It's your photo: it's hidden from the crew until someone else decides. You can delete it any time."
      : "Hidden from the crew until you decide: show it again or delete it.",
  }),
  plan_photo_nudge: (_actor, p) => ({
    title: p.yesterday ? "Photos from last night? Share them with the crew" : "Photos from the night? Share them with the crew",
    body: serverTitle(p),
  }),
  plan_day_reminder: (_actor, p) => ({
    title: str(p, "starts_at") ? `Today ${formatTime(str(p, "starts_at"))}: ${serverTitle(p)}` : `Today: ${serverTitle(p)}`,
    body:
      p.attendance === "going"
        ? "You're in – see you later!"
        : p.attendance === "maybe"
          ? "You said “maybe” – are you in?"
          : "Are you in? One tap is enough.",
  }),
  reward_earned: (_actor, p) => ({
    title: `+${typeof p.points === "number" ? p.points : ""} points`,
    body: `${p.reason === "plan_organized" ? "For organising" : "For taking part"}: ${serverTitle(p)}`,
  }),
};

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
  text: notificationText,
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
  links: { settings: "Settings", notifications: "Notifications", privacy: "Privacy and your data", admin: "Admin area", assistant: "Planning assistant" },
} satisfies typeof deProfile;

export const settings = {
  title: "Settings",
  back: "Profile",
  jumpLabel: "Settings sections",
  profile: { title: "Profile", saved: "Profile saved." },
  language: {
    title: "Language",
    label: "App language",
    lead: "Applies to your account: also to the calendar subscription, notifications on your phone and emails (such as “forgot password”), and new devices pick it up. The page reloads afterwards. Dates, times and amounts stay in Berlin time and euros.",
    notTranslated: "Not everything is translated: places only get an English description once their city has been reloaded from OpenStreetMap (after 30 days at the earliest), and texts your crew writes stay as written.",
  },
  preferences: { title: "Preferences", saved: "Preferences saved." },
  location: {
    title: "Location sharing",
    lead: "You decide whether and with whom you share your location. The default: not at all.",
    notLive: {
      title: "Live only during a plan",
      body: "Permanent sharing isn't built in yet – your choice here is only noted. So far you can share live only around a plan: on the plan page under “Where are you?”, from 2 hours before the start, only when you tap and only with the people who are coming too. Sharing ends after 3 hours at most, at the latest with the plan, and is then deleted.",
    },
    crew: "Crew",
    crewNone: "You're not in any crew.",
    selectedFriendsNote: "Choosing individual people will come together with the location feature.",
    saved: "Location sharing saved.",
    statusOff: "Off",
    statusNoted: "Noted",
    whatIsShared: "What would be shared? Your approximate position while sharing is on – never your address, never permanently.",
  },
  notifications: {
    title: "Notifications",
    lead: "Choose what the app tells you about.",
    saved: "Notifications saved.",
    status: (on: number, all: number) => (on === 0 ? "All off" : on === all ? "All on" : `${on} of ${all} on`),
    groups: {
      polls: { title: "New polls", body: "When someone in your crew starts a poll." },
      reminders: { title: "Reminders", body: "When you still haven't answered a poll – sent by hand or shortly before it closes." },
      answers: { title: "New replies", body: "When someone replies to your poll or your plan." },
      results: { title: "Results", body: "When a poll ends." },
      plans: { title: "Plans", body: "New plans, changes to time, place or cost, and cancellations." },
      dayReminders: { title: "On the day of the plan", body: "Once in the morning, e.g. “Today 20:00: Bowling” – unless you can't make it." },
      photoNudges: { title: "Photos from the night", body: "Once the morning after, if you went and hardly any photos have been shared yet." },
      bookings: { title: "Bookings", body: "When the status of a booking changes." },
      rides: { title: "Rides", body: "Requests and confirmations for carpools." },
      costs: { title: "Split costs", body: "New expenses you're part of, and repayments." },
      costReminders: { title: "Reminder about open balances", body: "Once per evening, if you still have money open a week later." },
      crew: { title: "Crew", body: "New members and changes to your role." },
      spontaneous: { title: "Anyone out tonight?", body: "Spontaneous asks from your crew, people up for your ask, and when there are enough of you." },
      rewards: { title: "Rewards", body: "When you earn points." },
    },
  },
  /** P4: Push-Mitteilungen auf diesem Gerät. */
  push: {
    title: "Push notifications on this device",
    on: "Arrives on your device even when the app is closed – choose exactly what below.",
    off: "Get notified even when the app is closed – for everything you've turned on below.",
    statusOn: "On",
    statusOff: "Off",
    statusBlocked: "Blocked",
    statusUnavailable: "Not available",
    enabled: "Push notifications are on.",
    disabled: "Push notifications on this device are off.",
    unsupported: "This browser can't receive push notifications. They work in Chrome, Edge, Firefox or Safari (Mac).",
    iosInstall: "On iPhone and iPad, push notifications only work in the installed app: in Safari tap Share, then “Add to Home Screen” – then turn them on here.",
    notConfigured: "Push notifications aren't set up on this server yet. Notifications appear in the app.",
    blocked: "Notifications for AFTERHOURS are blocked in your browser. Allow them in your browser's site settings, then turn them on here.",
    privacy: "The content of every notification is encrypted – your browser's push service (Google, Apple, Mozilla or Microsoft) only sees that something is coming. The lock screen shows the title and text, just like in the app.",
    otherDevices: (n: number) => (n === 1 ? "Also on for 1 other device." : `Also on for ${n} other devices.`),
    device: (browser: string, platform: string) => `${browser} on ${platform}`,
    deviceBrowser: "Browser",
    devicePlatform: "Device",
    /** P4 Etappe 3: je Gerät wählen, was als Mitteilung ankommt. */
    pick: {
      title: "What arrives here",
      lead: "Tap what should come through as a push notification on this device. You'll still see everything in the app.",
      all: "Everything",
      essentials: "Just the essentials",
      count: (on: number, total: number) => (on === total ? "Everything" : on === 0 ? "Nothing" : `${on} of ${total}`),
      saved: "Saved for this device.",
      none: "Nothing is coming through to this device right now – the app still shows everything.",
      offInApp: (n: number) => (n === 1 ? "1 area is turned off for the app below, so it won't arrive here either." : `${n} areas are turned off for the app below, so they won't arrive here either.`),
    },
  },
  /** P2 Etappe 2: persönlicher Abo-Link für Kalender-Apps. */
  calendar: {
    title: "Calendar subscription",
    lead: "All your crews' plans in your phone's calendar – new plans, changes and cancellations come through by themselves.",
    statusOn: "Subscribed",
    statusOff: "No subscription",
    create: "Create subscription link",
    created: "Subscription link created. Now subscribe to it in your calendar.",
    inactive: "No subscription yet. With the link you can subscribe to AFTERHOURS in Apple Calendar, Google Calendar or Outlook.",
    whatsIn: "It includes the title, time, place, meeting point and crew of your plans – going back 60 days. Plans you can't make are left out; cancelled plans show up as “Cancelled”. No names of other people.",
    linkLabel: "Your subscription link",
    apple: "Open in Apple Calendar",
    google: "Google Calendar",
    googleNote: "Google then fetches the link by itself.",
    copy: "Copy link",
    copied: "Subscription link copied.",
    copyFailed: "Copying didn't work – select the link and copy it by hand.",
    secret: "Anyone with this link can see your plans, including place and meeting point. Don't share it with anyone – not even in the group chat.",
    delay: "Calendar apps usually only check every few hours. So changes won't arrive to the second.",
    lastUsed: (ago: string) => `Last fetched ${ago}.`,
    neverUsed: "Not fetched by any calendar yet.",
    renew: "Create new link",
    renewTitle: "Create a new subscription link?",
    renewBody: "The current link will stop working. Calendars subscribed to it won't get any more plans – you'll need to add the new link there.",
    renewConfirm: "Create new link",
    renewed: "New subscription link created. The old one no longer works.",
    revoke: "End subscription",
    revokeTitle: "End calendar subscription?",
    revokeBody: "The link will stop working. Calendars subscribed to it won't show new plans; it's best to remove the subscription there too.",
    revokeConfirm: "End subscription",
    revoked: "Calendar subscription ended.",
  },
  account: {
    title: "Account",
    email: "Email address",
    passwordTitle: "Change password",
    passwordSaved: "Password changed.",
    passwordSubmit: "Change password",
    exportTitle: "Your data",
    exportBody: "Download everything AFTERHOURS has stored about you – as a JSON file.",
    exportAction: "Download data",
    exportDone: "Download started.",
    deleteTitle: "Delete account",
    deleteBody: "Your profile, settings, memberships, votes, replies, points and notifications are deleted immediately and permanently. Polls and plans you started stay for the crew, but without your name.",
    deleteAction: "Delete account",
    deleteDialogTitle: "Permanently delete your account?",
    deleteConfirmLabel: "Type DELETE to confirm",
    deleteConfirmWord: "DELETE",
    deleteSubmit: "Permanently delete account",
    deleted: "Your account has been deleted.",
    signOut: "Log out",
  },
} satisfies typeof deSettings;
