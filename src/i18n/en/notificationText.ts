/** F9 · Englische Texte der Benachrichtigungen – Gegenstück zu `src/i18n/de/notificationText.ts`. */
import { formatDateTime, formatEuro, formatPlainDateLong, formatTime } from "./format";
import type { NotificationType } from "@/lib/types";
import { localizedServerTitle } from "@/lib/servertitle";

type Payload = Record<string, unknown>;
const str = (payload: Payload, key: string, fallback = "") => (typeof payload[key] === "string" ? (payload[key] as string) : fallback);
/** P11 Etappe 2e: Titel aus dem Server, „Stichwahl: …“ wird zu „Runoff: …“ (sonst unverändert). */
const serverTitle = (payload: Payload) => localizedServerTitle(str(payload, "title"), "en");

/** Texte für Benachrichtigungen. `actor` ist der Anzeigename der auslösenden Person (falls bekannt). */
/** Gleiche Arten wie Deutsch – `Record<NotificationType, …>` lässt keine fehlen. */
export const notificationText: Record<NotificationType, (actor: string, payload: Payload) => { title: string; body?: string }> = {
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
  poll_reminder: (actor, p) => {
    if (p.removed) {
      const what = str(p, "date")
        ? `${formatPlainDateLong(str(p, "date"))}${str(p, "time") ? `, ${str(p, "time")}` : ""}`
        : str(p, "place", "your suggestion");
      return { title: `${actor} took ${what} back out of the poll`, body: serverTitle(p) };
    }
    if (p.added && str(p, "date")) {
      const time = str(p, "time") ? `, ${str(p, "time")}` : "";
      return { title: `${actor} suggested ${formatPlainDateLong(str(p, "date"))}${time} too – can you make it?`, body: serverTitle(p) };
    }
    if (p.added && str(p, "place")) return { title: `${actor} suggested ${str(p, "place")} too – are you in?`, body: serverTitle(p) };
    if (p.extended && str(p, "ends_at")) return { title: `Extended until ${formatDateTime(str(p, "ends_at"))} – your vote is still missing`, body: serverTitle(p) };
    return p.closing
      ? { title: str(p, "ends_at") ? `Closes at ${formatTime(str(p, "ends_at"))} – your vote is missing` : "Closing soon – your vote is missing", body: serverTitle(p) }
      : { title: `${actor} is reminding you about a poll`, body: serverTitle(p) };
  },
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
    if (p.asked_again) {
      return { title: `New time: ${serverTitle(p)} – are you still in?`, body: str(p, "starts_at") ? `${actor} moved it to ${formatDateTime(str(p, "starts_at"))}` : `${actor} moved the plan` };
    }
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
  plan_attendance: (actor, p) => {
    const who = p.guest ? `${str(p, "guest")} (guest)` : actor;
    return {
      title: p.status === "going" ? `${who} is in` : p.status === "maybe" ? `${who} might come` : `${who} can't make it`,
      body: serverTitle(p),
    };
  },
  booking_status: (_actor, p) => {
    const status: Record<string, string> = { confirmed: "Booking confirmed", unavailable: "Booking not possible: nothing available", failed: "Booking failed", cancelled_by_user: "Booking cancelled" };
    return { title: status[str(p, "status")] ?? "Booking status changed", body: serverTitle(p) };
  },
  ride_request: (actor, p) => ({ title: p.cancelled ? `${actor} won't ride with you after all` : `${actor} would like a ride with you`, body: serverTitle(p) }),
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
  plan_reminder: (actor, p) => {
    const plan = str(p, "starts_at") ? `${serverTitle(p)} · ${formatDateTime(str(p, "starts_at"))}` : serverTitle(p);
    if (p.deadline_over) {
      const n = (key: string) => (typeof p[key] === "number" ? (p[key] as number) : 0);
      const parts = [`${n("going")} in`, n("unsure") > 0 ? `${n("unsure")} maybe` : "", n("open") > 0 ? `${n("open")} haven't replied` : ""].filter(Boolean);
      return { title: n("open") > 0 ? `Deadline passed: ${parts.join(", ")}` : `Deadline passed – everyone replied: ${parts.join(", ")}`, body: plan };
    }
    if (p.deadline) {
      return { title: str(p, "answer_by") ? `Reply by ${formatDateTime(str(p, "answer_by"))} – yours is still missing` : "The reply deadline is almost up – yours is still missing", body: plan };
    }
    return p.maybe
      ? { title: `${actor} asks: are you in now?`, body: `You said maybe · ${plan}` }
      : { title: `${actor} asks: are you in?`, body: plan };
  },
  plan_quorum: (_actor, p) => ({
    title: `It's on: ${serverTitle(p)}`,
    body: [typeof p.going === "number" ? `${p.going} are in` : "", str(p, "starts_at") ? formatDateTime(str(p, "starts_at")) : "", p.answered === false ? "Are you in too?" : ""]
      .filter(Boolean)
      .join(" · "),
  }),
  plan_waitlist_promoted: (_actor, p) => ({
    title: `You're in: ${serverTitle(p)}`,
    body: [str(p, "starts_at") ? formatDateTime(str(p, "starts_at")) : "", "A spot opened up – you moved up from the waiting list."].filter(Boolean).join(" · "),
  }),
  plan_arrival_late: (actor, p) => ({
    title: str(p, "eta") ? `${actor} is running ${p.later ? "even " : ""}late – there around ${formatTime(str(p, "eta"))}` : `${actor} is running ${p.later ? "even " : ""}late`,
    body: str(p, "title") ? `${serverTitle(p)} · You're already there` : "You're already there",
  }),
  birthday_reminder: (actor, p) => ({
    title: str(p, "date") ? `${actor}'s birthday is on ${formatPlainDateLong(str(p, "date"))}` : `${actor}'s birthday is coming up`,
    body: str(p, "crew_name") ? `Plan a party with “${str(p, "crew_name")}”?` : "Plan a party?",
  }),
  plan_photo_nudge: (_actor, p) =>
    p.close === true
      ? {
          title: p.yesterday ? "Did last night happen? Finish it with one tap" : "Did the night happen? Finish it with one tap",
          body: [serverTitle(p), "Then we'll ask the crew how it was"].filter(Boolean).join(" · "),
        }
      : p.feedback === true
      ? {
          title: p.yesterday ? "How was last night? One tap to say" : "How was the night? One tap to say",
          body: [serverTitle(p), p.photos === false ? "The crew only sees the numbers" : "And share your photos with the crew"].filter(Boolean).join(" · "),
        }
      : {
          title: p.yesterday ? "Photos from last night? Share them with the crew" : "Photos from the night? Share them with the crew",
          body: serverTitle(p),
        },
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
