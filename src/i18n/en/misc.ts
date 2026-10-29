import { formatDateTime, formatEuro, formatTime } from "./format";
import type { NotificationType } from "@/lib/types";
import type {
  notifications as deNotifications,
  rewards as deRewards,
  profile as deProfile,
  settings as deSettings,
  privacy as dePrivacy,
  admin as deAdmin,
  assistant as deAssistant,
} from "../de/misc";

type Payload = Record<string, unknown>;
const str = (payload: Payload, key: string, fallback = "") => (typeof payload[key] === "string" ? (payload[key] as string) : fallback);

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
    body: str(p, "title"),
  }),
  poll_reminder: (actor, p) => ({ title: `${actor} is reminding you about a poll`, body: str(p, "title") }),
  poll_vote: (actor, p) => ({ title: p.guest ? `${str(p, "guest")} (guest) voted` : `${actor} voted`, body: str(p, "title") }),
  poll_result: (_actor, p) => ({
    title: p.winner_title ? `Result: ${str(p, "winner_title")}` : p.is_tie ? "Poll ended in a tie" : "Poll ended with no yes votes",
    body: str(p, "title"),
  }),
  plan_created: (actor, p) =>
    p.repeat
      ? { title: "The next date is set – are you in?", body: str(p, "starts_at") ? `${str(p, "title")} · ${formatDateTime(str(p, "starts_at"))}` : str(p, "title") }
      : p.auto
        ? { title: "Decided – the plan is set", body: str(p, "starts_at") ? `${str(p, "title")} · ${formatDateTime(str(p, "starts_at"))}` : str(p, "title") }
        : { title: `${actor} created a plan`, body: str(p, "title") },
  plan_changed: (actor, p) => {
    const labels: Record<string, string> = { starts_at: "time", address: "place", meeting_point: "meeting point", cost: "cost" };
    const changed = Array.isArray(p.changed) ? (p.changed as string[]).map((key) => labels[key] ?? key).join(", ") : "";
    return { title: `${actor} changed a plan${changed ? `: ${changed}` : ""}`, body: str(p, "title") };
  },
  plan_cancelled: (actor, p) =>
    p.skipped
      ? {
          title: `${actor} is skipping this one: ${str(p, "title")}`,
          body: str(p, "next_starts_at") ? `Next date: ${formatDateTime(str(p, "next_starts_at"))}` : "The regular carries on.",
        }
      : { title: `${actor} cancelled a plan`, body: str(p, "title") },
  plan_attendance: (actor, p) => ({
    title: p.status === "going" ? `${actor} is in` : p.status === "maybe" ? `${actor} might come` : `${actor} can't make it`,
    body: str(p, "title"),
  }),
  booking_status: (_actor, p) => {
    const status: Record<string, string> = { confirmed: "Booking confirmed", unavailable: "Booking not possible: nothing available", failed: "Booking failed", cancelled_by_user: "Booking cancelled" };
    return { title: status[str(p, "status")] ?? "Booking status changed", body: str(p, "title") };
  },
  ride_request: (actor, p) => ({ title: `${actor} would like a ride with you`, body: str(p, "title") }),
  ride_confirmed: (actor, p) => ({ title: p.accepted ? `${actor} will give you a ride` : `${actor} can't give you a ride`, body: str(p, "title") }),
  plan_expense: (actor, p) => ({
    title: p.you_paid ? `${actor} noted that you paid for “${str(p, "description")}”` : `${actor} added “${str(p, "description")}”`,
    body: [typeof p.share_cents === "number" ? `Your share: ${formatEuro(p.share_cents)}` : typeof p.amount_cents === "number" ? formatEuro(p.amount_cents) : "", str(p, "title")].filter(Boolean).join(" · "),
  }),
  plan_settlement: (actor, p) => {
    const amount = typeof p.amount_cents === "number" ? formatEuro(p.amount_cents) : "";
    if (p.bundle) {
      const count = typeof p.plan_count === "number" ? p.plan_count : 0;
      const body = [count > 0 ? (count === 1 ? "1 evening settled" : `${count} evenings settled`) : "", str(p, "crew_name")].filter(Boolean).join(" · ");
      if (p.direction === "offset") return { title: `${actor} offset your open balances – you're even`, body };
      return { title: p.direction === "received" ? `${actor} confirmed you paid back ${amount}` : `${actor} paid you back ${amount} in one go`, body };
    }
    return { title: p.direction === "received" ? `${actor} confirmed your repayment of ${amount}` : `${actor} paid you back ${amount}`, body: str(p, "title") };
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
  plan_day_reminder: (_actor, p) => ({
    title: str(p, "starts_at") ? `Today ${formatTime(str(p, "starts_at"))}: ${str(p, "title")}` : `Today: ${str(p, "title")}`,
    body:
      p.attendance === "going"
        ? "You're in – see you later!"
        : p.attendance === "maybe"
          ? "You said “maybe” – are you in?"
          : "Are you in? One tap is enough.",
  }),
  reward_earned: (_actor, p) => ({
    title: `+${typeof p.points === "number" ? p.points : ""} points`,
    body: `${p.reason === "plan_organized" ? "For organising" : "For taking part"}: ${str(p, "title")}`,
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

export const rewards = {
  title: "Rewards",
  lead: "You earn points for outings that actually happened.",
  points: (n: number) => (n === 1 ? "1 point" : `${n} points`),
  balanceLabel: "Your points",
  levels: ["Newcomer", "Regular joiner", "Regular", "Organising talent", "Legend"],
  /** V2 Etappe 3o: Stufen als Leiter auf der Punktekarte. */
  levelsLabel: "Levels",
  levelFrom: (points: number) => (points === 0 ? "from the start" : `from ${points}`),
  levelReached: "reached",
  levelCurrent: "your level",
  historyCount: (n: number) => (n === 1 ? "1 item" : `${n} items`),
  milestonesCount: (done: number, all: number) => `${done} of ${all}`,
  partnersStatus: "Examples",
  nextLevel: (points: number, level: string) => (points === 1 ? `1 more point to “${level}”` : `${points} more points to “${level}”`),
  maxLevel: "Top level reached.",
  rulesTitle: "How you earn points",
  rules: [
    { points: 30, title: "Organised a plan", body: "You created a plan that happened and was completed." },
    { points: 10, title: "Were there", body: "You said yes to a completed plan." },
  ],
  rulesFine: "Points are only awarded for plans with at least two people in, once per plan, and for at most three attended and two organised plans per day. They're awarded on the server when a plan is completed.",
  milestonesTitle: "Milestones",
  milestones: {
    firstAttended: "First outing",
    fiveAttended: "Been there five times",
    firstOrganized: "Organised for the first time",
    fiveOrganized: "Organised five plans",
  },
  milestoneDone: "Reached",
  milestoneProgress: (current: number, target: number) => `${current} of ${target}`,
  historyTitle: "History",
  historyEmpty: { title: "No points yet", body: "Complete your first plan together – then it shows up here." },
  reason: { plan_organized: "Organised a plan", plan_attended: "Were there", partner_bonus: "Partner bonus", admin_adjustment: "Correction" },
  showPlan: "View plan",
  partnersTitle: "Partner rewards",
  partnersNotice: {
    title: "No partners yet",
    body: "The rewards below are examples of what offers could look like. They don't exist, and nothing can be redeemed.",
  },
  partnerExamples: [
    { title: "2-for-1 on your second round of bowling", partner: "Example bowling alley", cost: 150 },
    { title: "Free nachos with your cinema ticket", partner: "Example cinema", cost: 100 },
    { title: "10% off the group bill", partner: "Example restaurant", cost: 300 },
  ],
  redeem: "Can't be redeemed",
  cost: (n: number) => (n === 1 ? "1 point" : `${n} points`),
} satisfies typeof deRewards;

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
    lead: "Applies to your account: also to the calendar subscription and notifications on your phone, and new devices pick it up. The page reloads afterwards. Dates, times and amounts stay in Berlin time and euros.",
    notTranslated: "Still in German for now: link previews in messengers, emails and date titles set by the server.",
  },
  preferences: { title: "Preferences", saved: "Preferences saved." },
  location: {
    title: "Location sharing",
    lead: "You decide whether and with whom you share your location. The default: not at all.",
    notLive: {
      title: "Not active yet",
      body: "Live locations aren't built into this version. The app doesn't request your location, doesn't store it and doesn't show it to anyone. Your choice is noted and only applies once the feature is available – you'll be asked again explicitly then.",
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
      reminders: { title: "Reminders", body: "When you still haven't answered a poll." },
      answers: { title: "New replies", body: "When someone replies to your poll or your plan." },
      results: { title: "Results", body: "When a poll ends." },
      plans: { title: "Plans", body: "New plans, changes to time, place or cost, and cancellations." },
      dayReminders: { title: "On the day of the plan", body: "Once in the morning, e.g. “Today 20:00: Bowling” – unless you can't make it." },
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

export const privacy = {
  title: "Privacy and your data",
  /** V2 Etappe 3o: Kopf als Karte – Kennzeile, Kurzfassung als Pillen (stehen so auch unten im Text). */
  label: "In plain words",
  facts: ["No tracking", "No ads", "Location off"],
  jumpLabel: "Jump to",
  disclaimer: "This page describes in plain words how the app handles data. It doesn't replace a legally reviewed privacy policy – the operator must add one before the public launch.",
  sections: [
    {
      title: "What is stored",
      items: [
        "Account: your email address and an encrypted password (with Supabase Auth).",
        "Profile: display name, optionally a profile picture, city and interests.",
        "Activity: crews, messages in the crew chat, polls, votes, plans, replies, booking notes, rides, points and notifications.",
        "Settings: budget, distance, notifications and your choice on location sharing.",
        "Push notifications (only if you turn them on): per device, the address at your browser's push service, two public keys for encryption and a device name like “Chrome on Android”.",
      ],
    },
    {
      title: "Who sees what",
      items: [
        "Your profile is only visible to people you share at least one crew with.",
        "A crew's content is only visible to its members. The database itself enforces this, not just the interface.",
        "Only you can see your settings, your email address and your points.",
        "Calendar subscription: if you create a subscription link, any calendar app (and any person) that knows it can read your plans – without logging in. You can replace or end it at any time.",
        "Nothing can be accessed without logging in – except what you deliberately share via link: invites, shared plans and polls, your calendar subscription.",
      ],
    },
    {
      title: "Location",
      items: [
        "Location sharing is off by default.",
        "This version doesn't request or store any device location.",
        "Distances are estimated from the city in your profile (straight line from the city centre).",
        "Maps only load when you tap “Load map” – then a request goes to OpenStreetMap.",
        "The map in Discover first shows places only as dots. It only loads the OpenStreetMap street map after “Load street map” (applies to this device; “Street map off” undoes it).",
      ],
    },
    {
      title: "Your rights",
      items: [
        "Access: in Settings you can download all your data as a file.",
        "Rectification: you can change your profile and settings at any time.",
        "Erasure: in Settings you can delete your account immediately and permanently.",
      ],
    },
    {
      title: "Third parties",
      items: [
        "Fonts and icons are part of the app itself; nothing is loaded from font or tracking services.",
        "Photos of places only load when you tap “Show photo” or turn on “Always load photos of places” (applies only on this device). Then requests without cookies go to Wikimedia Commons and Wikidata – Wikimedia learns your IP address and which photo is being loaded.",
        "Push notifications only exist if you turn them on for a device. Then every notification goes through your browser's push service (Google, Apple, Mozilla or Microsoft) – end-to-end encrypted; the service only sees that something is going to your device. Turning them off or logging out unregisters the device.",
        "There are no ads and no tracking.",
        "Data is stored with Supabase (database and login) in the region the operator chooses.",
      ],
    },
  ],
  toSettings: "Go to Settings",
  toLogin: "Go to login",
} satisfies typeof dePrivacy;

export const admin = {
  title: "Admin",
  lead: "Only for accounts with the administrator role. Access is checked in the database.",
  denied: { title: "No access", body: "This area is reserved for administrators." },
  tabs: { overview: "Overview", activities: "Activities", reports: "Reports", audit: "Log", label: "Section" },
  metrics: { users: "Accounts", crews: "Crews", polls: "Polls", plans: "Plans", activities_total: "Activities", activities_demo: "of which demo", open_reports: "Open reports", reward_points_total: "Points awarded" },
  activities: {
    active: "Active",
    inactive: "Hidden",
    deactivate: "Hide",
    activate: "Show",
    verify: "Mark as checked",
    verified: (date: string) => `checked on ${date}`,
    unverified: "unchecked",
    saved: "Activity updated.",
    demoHint: "Demo data comes from supabase/seed.sql. To remove: delete from activities where data_source = 'demo'.",
    osmNote: "Places from OpenStreetMap aren't in this list – they're corrected on OpenStreetMap and picked up with the next import.",
    partnerNote: "Creating and editing individual places, as well as the partner portal, are prepared (permissions and tables exist) but don't have an interface yet.",
  },
  reports: {
    empty: "No reports.",
    resolve: "Resolved",
    dismiss: "Dismiss",
    saved: "Report updated.",
    status: { open: "Open", resolved: "Resolved", dismissed: "Dismissed" },
    target: (type: string) => `Concerns: ${type}`,
    openCount: (n: number) => (n === 0 ? "Nothing open" : `${n} open`),
  },
  audit: { empty: "No entries yet.", actor: "Triggered by", system: "System" },
  placeSync: {
    title: "Place import from OpenStreetMap",
    period: (days: number) => (days === 1 ? "Last day" : `Last ${days} days`),
    empty: "No imports in this period yet. As soon as someone picks a new city in Discover, it shows up here.",
    runs: "Imports",
    failed: "failed",
    rate: "Failure rate",
    fallback: "via fallback server",
    rateValue: (pct: string) => `${pct}%`,
    overThreshold: (threshold: number) =>
      `More than ${threshold}% of imports have failed. Per the decision of 14 Oct 2026, this is the point at which a dedicated OSM service or a commercial provider should be considered.`,
    lastFailure: (when: string) => `Last failure: ${when}`,
    errorsTitle: "Errors by type",
    endpointsTitle: "Overpass servers",
    geocodeFallback: "City found via fallback",
    stages: (geocode: number, overpass: number) => `Failed at city lookup: ${geocode} · at Overpass: ${overpass}`,
    geocodersTitle: "City lookup",
    geocoderDb: "stored city",
    endpointLine: (ok: number, attempts: number) => `${ok} of ${attempts} attempts successful`,
    errors: {
      osm_busy: "OSM overloaded",
      osm_unavailable: "OSM unreachable",
      database_error: "Database",
      internal_error: "Internal error",
      unknown: "Unknown",
    } as Record<string, string>,
  },
} satisfies typeof deAdmin;

export const assistant = {
  title: "Planning assistant",
  lead: "Describe in one sentence what you're up to – the assistant suggests places that fit.",
  disabled: {
    title: "The assistant isn't set up yet",
    body: "The interface is ready: the Edge Function “assistant” is in the project, but it needs an AI key as a server secret. Until that's there, the assistant stays off – it doesn't make up answers.",
    how: "Setup: see the README, section “KI-Assistent”.",
    alternative: "Until then, you can find places via Discover and its filters.",
    toDiscover: "Go to Discover",
  },
  inputLabel: "Your request",
  placeholder: "There are six of us and we want to do something tonight for at most €30 per person.",
  examples: ["Something active for 5 people, at most €20 per person", "Two hours indoors, ages 14 and up", "Bowling and then dinner"],
  submit: "Find suggestions",
  thinking: "The assistant is searching …",
  understood: "Here's how I understood you",
  missing: "I still need one more detail",
  suggestions: "Suggestions",
  noSuggestions: "There's no matching place in the available data for this request.",
  why: "Why",
  caveat: "Prices and opening hours come from the stored data and may differ. Availability isn't checked. The assistant doesn't book or pay for anything.",
  addToPoll: "Prepare a poll",
  unavailable: "The assistant can't be reached right now. Use Discover in the meantime.",
} satisfies typeof deAssistant;
