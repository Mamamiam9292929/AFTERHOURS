import type { plans as dePlans } from "../de/plans";

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const plans = {
  title: "Plans",
  lead: "What's coming up, what's still being decided and what you've already done together.",
  /** Plakat-Überschrift (D0) aus den eigenen Daten; `key` in Lime. */
  poster: {
    upcoming: (n: number) => ({ lead: "", key: n === 1 ? "1 evening" : `${n} evenings`, tail: " in sight" }),
    voting: (n: number) => ({ lead: "", key: n === 1 ? "1 question" : `${n} questions`, tail: " open" }),
    none: { lead: "Your ", key: "plans", tail: "" },
  },
  tabs: { upcoming: "Upcoming", voting: "Voting", past: "Past", label: "View" },
  newPlan: "Create plan",
  newPoll: "Start a poll",
  empty: {
    upcomingTitle: "Nothing planned yet",
    upcomingBody: "Start a poll or create a plan straight away – your crew gets notified.",
    votingTitle: "No poll running",
    votingBody: "If you can't agree, let the crew vote.",
    pastTitle: "No past plans yet",
    pastBody: "Completed and cancelled plans show up here.",
  },
  /** D6: Gruppe der Antwort-Knöpfe unter einem Ticket auf Home. */
  quickAnswer: (title: string) => `Your answer for “${title}”`,
  ticket: {
    going: (n: number) => `${n} in`,
    goingOf: (total: number) => `of ${total} in`,
    yourAnswerOpen: "Your answer is missing",
    /** P46: Antwortfrist hinter „Deine Antwort fehlt“. */
    answerBy: (when: string) => `by ${when}`,
    youGoing: "You're in",
    youMaybe: "You: maybe",
    youDeclined: "You can't make it",
    /** Stempel im Abriss des großen Tickets, sobald du geantwortet hast. */
    stamp: { going: "In", maybe: "Maybe", declined: "Out" },
    /** P8 Etappe 3: Kennzeichen für Termine eines Stammtischs. */
    series: "Regular",
    /** P25 Etappe 2: Mindestzahl am Ticket (Home, Pläne, Crew). */
    quorum: { missing: (n: number) => (n === 1 ? "1 more needed" : `${n} more needed`), reached: "It's on" },
    /** P26 Etappe 2: Höchstzahl am Ticket (Home, Pläne, Crew); eigener Platz auf der Nachrückliste. */
    capacity: {
      left: (n: number) => (n === 1 ? "1 spot left" : `${n} spots left`),
      full: "Full – waitlist",
      you: (n: number) => (n === 1 ? "You're next on the waitlist" : `You: #${n} on the waitlist`),
    },
    countdown: {
      today: "Today",
      tonight: "Tonight",
      tomorrow: "Tomorrow",
      days: (n: number) => `In ${n} days`,
    },
  },
  create: {
    title: "Create plan",
    lead: "If you already know what you're doing: create a plan and the crew says whether they're in.",
    crew: "Which crew is it for?",
    /** V2 Etappe 3m: Abschnitte des Formulars als Glas-Karten. */
    sections: {
      what: "What & when",
      where: "Where",
      money: "Costs",
      more: "Anything else?",
    },
    whenMissing: "Day and time are still missing.",
    planTitle: "What are you doing?",
    planTitlePlaceholder: "e.g. Bowling night",
    date: "Date",
    time: "Time",
    address: "Address",
    meetingPoint: "Meeting point",
    meetingPointPlaceholder: "e.g. outside the entrance",
    cost: "Cost per person",
    costHint: "Estimate in euros.",
    totalCost: "Total cost",
    totalCostHint: "Only fill in if there's a fixed total price (e.g. lane hire).",
    notes: "Notes",
    notesPlaceholder: "What should the crew know?",
    mode: "How fixed is it?",
    modeProposed: "Suggestion",
    modeProposedHint: "The crew sees the plan and can say they're in. You confirm it later.",
    modeConfirmed: "Locked in",
    modeConfirmedHint: "The plan counts as confirmed straight away.",
    place: "Place",
    submit: "Create plan",
    created: "Plan created. The crew has been notified.",
  },
  /** P5: Wettervorhersage für Beginn und Ort des Plans (Open-Meteo). */
  weather: {
    label: "Weather",
    loading: "Loading forecast …",
    kinds: {
      clear: "Clear",
      partly: "Partly cloudy",
      cloudy: "Cloudy",
      fog: "Fog",
      drizzle: "Drizzle",
      rain: "Rain",
      freezing: "Freezing rain",
      snow: "Snow",
      showers: "Showers",
      thunder: "Thunderstorms",
      unknown: "Conditions unknown",
    },
    at: (hour: number) => `at ${String(hour).padStart(2, "0")}:00`,
    rain: (percent: number) => `${percent}% chance of rain`,
    rainUnknown: "Chance of rain unknown",
    wind: (kmh: number) => `Wind ${kmh} km/h`,
    tooFar: (date: string) => `Forecast available from ${date} – two weeks before the plan.`,
    error: "Weather not available right now.",
    retry: "Try again",
    /** Quelle: „Vorhersage von <Open-Meteo>, Stand 04:53 Uhr. Kann sich noch ändern.“ – der Name ist der Link. */
    sourceLead: "Forecast by",
    sourceLink: "Open-Meteo",
    sourceTail: (time: string) => `, as of ${time}. May still change.`,
    hints: {
      rain: "Outdoors and rain is possible – maybe think about a plan B?",
      thunder: "Outdoors and thunderstorms forecast – better think about a plan B.",
      snow: "Outdoors and snow or ice possible – wrap up warm or think about a plan B.",
      cold: "Outdoors and cold – wrap up warm.",
    },
  },
  /** P2 Etappe 1: Plan als Kalenderdatei (.ics). */
  calendar: {
    add: "Add to calendar",
    done: "Calendar file downloaded – open it to add the event.",
    meetingPoint: (value: string) => `Meeting point: ${value}`,
    /** P50 Etappe 2b: weitere Station des Abends. */
    stop: (time: string | null, title: string, address: string | null) => `Then: ${time ? `${time} ` : ""}${title}${address ? ` (${address})` : ""}`,
    link: (url: string) => `Plan in AFTERHOURS: ${url}`,
    /** P2 Etappe 2: Hinweis auf das Abo. */
    subscribe: "All plans automatically: Calendar subscription",
  },
  /** P8: wiederkehrende Pläne („Stammtisch“). Wochentage als ISO-Nummer (1 = Montag). */
  repeat: {
    title: "Repeats",
    label: "Repeat",
    none: "Just this once",
    rule: (rule: "weekly" | "biweekly" | "monthly_nth" | "monthly_last", weekday: number, nth: number | null) => {
      const day = WEEKDAY_NAMES[weekday - 1] ?? "day";
      if (rule === "weekly") return `Every ${day}`;
      if (rule === "biweekly") return `Every other ${day}`;
      if (rule === "monthly_nth") {
        const n = nth ?? 1;
        const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
        return `Every ${n}${suffix} ${day} of the month`;
      }
      return `Last ${day} of every month`;
    },
    save: "Save",
    saved: "Repeat saved.",
    stopped: "The plan no longer repeats.",
    next: (date: string) => `A week before, the next date on ${date} appears in the app by itself – with this one's title, place and time.`,
    hasNext: "The next date is already set:",
    intro: "For regulars: a week before the next date, the app creates it – and everyone is asked whether they're in.",
    /** P8 Etappe 2: einen Termin aussetzen, ohne die Serie zu beenden. */
    skip: "Skip this one",
    skipHint: "Only this evening is off? The series carries on.",
    skipTitle: "Skip this one?",
    skipBody: (date: string) => `The evening on ${date} is off and everyone gets notified. The regular carries on – the next date appears in the app straight away.`,
    skipped: "Skipped – the next date is already set.",
    skippedNote: "This date was skipped. The regular carries on.",
    skippedNext: "Next date:",
    badge: "Skipped",
    stoppedNote: "This series has ended – no new dates will be added.",
  },
  detail: {
    back: "Plans",
    what: "What are we doing?",
    when: "When?",
    where: "Where?",
    meetingPoint: "Meeting point",
    who: "Who's coming?",
    cost: "What does it cost?",
    booking: "Booking",
    rides: "How is everyone getting there?",
    notes: "Notes",
    organizer: (name: string) => `Organised by ${name}`,
    organizerYou: "Organised by you",
    fromPoll: "Result of the poll",
    showPlace: "View place",
    route: {
      open: "How do I get there?",
      label: "Open directions in",
      apps: { device: "Maps app", apple: "Apple Maps", google: "Google Maps", osm: "OpenStreetMap" },
      hint: "The place is only sent to the provider when you tap.",
    },
    noAddress: "No place set yet",
    noMeetingPoint: "No meeting point set yet",
    startsIn: (relative: string) => `Starts ${relative}`,
    started: (relative: string) => `Started ${relative}`,
    costPerPerson: (v: string) => `${v} per person`,
    costTotal: (v: string, n: number) => `${v} in total with ${n} in`,
    costTotalFixed: (v: string) => `${v} in total`,
    costUnknown: "No cost estimate yet",
    costEstimate: "Estimate, not binding.",
    attendance: {
      question: "Are you in?",
      going: "I'm in",
      maybe: "Maybe",
      declined: "Can't make it",
      saved: "Answer saved.",
      locked: "Answers can no longer be changed.",
      groups: { going: "In", maybe: "Maybe", invited: "No answer yet", declined: "Out" },
      guest: (name: string) => `${name} (guest)`,
      guestsTitle: "Friends without an account",
      remind: "Ask",
      remindLabel: (n: number) => (n === 1 ? "Ask – check whether the person without an answer is in" : `Ask – check whether all ${n} without an answer are in`),
      reminded: (n: number) => (n === 0 ? "Everyone has answered – nobody was asked." : n === 1 ? "Asked 1 person." : `Asked ${n} people.`),
      remindMaybeLabel: (n: number) => (n === 1 ? "Ask – check whether the person who said maybe is in now" : `Ask – check whether all ${n} who said maybe are in now`),
      remindedMaybe: (n: number) => (n === 0 ? "Nobody is on maybe any more – nobody was asked." : n === 1 ? "Asked 1 person." : `Asked ${n} people.`),
      askedAgain: (previous: string) => `New time – does it still work for you? Before: ${previous}`,
      waitlist: "Waitlist",
      waitlistLabel: "Join the waiting list – if someone drops out, you're in automatically",
      waitlistJoined: (n: number) => (n === 1 ? "You're next in line." : `You're number ${n} on the waiting list.`),
      note: {
        add: "Add a note for the crew",
        label: "Note on your answer",
        placeholder: "e.g. won't be there before 9",
        hint: "Only your crew sees it. If your answer changes, the note is gone.",
        save: "Save",
        cancel: "Cancel",
        edit: "Edit note",
        remove: "Remove note",
        saved: "Note saved.",
        removed: "Note removed.",
        presets: {
          going: ["Coming later", "Have to leave early", "Just for one drink"],
          maybe: ["Will confirm by noon", "Depends on the weather", "Might come later"],
          declined: ["Next time!", "Sorry, have fun!"],
        },
        mine: (note: string) => `Your note: “${note}”`,
        quoted: (note: string) => `“${note}”`,
      },
    },
    manage: {
      title: "Organise",
      edit: "Edit plan",
      editTitle: "Edit plan",
      editBody: "If the time, place, meeting point or costs change, the crew gets notified.",
      saved: "Plan updated.",
      askAgain: "Ask everyone again",
      askAgainBody: (n: number, guests: number) =>
        `${n === 1 ? "1 answer is" : `${n} answers are`} for the old time. If this is on, everyone is back to "No answer yet" and gets asked whether it still works.` +
        (guests > 0 ? ` ${guests === 1 ? "The answer of the guest" : `The ${guests} answers of guests`} without an account ${guests === 1 ? "is" : "are"} deleted – they answer again via the link.` : ""),
      askedAgain: (n: number) => (n === 0 ? "Plan updated – there were no answers to reset." : n === 1 ? "Plan updated – 1 person is asked again." : `Plan updated – ${n} people are asked again.`),
      confirm: "Confirm plan",
      confirmed: "Plan confirmed.",
      complete: "Mark as completed",
      completeTitle: "Complete plan?",
      completeBody: "After that the plan can't be changed any more. Everyone who said they're in gets points – as long as at least two people were there.",
      completed: "Plan completed.",
      completeTooEarly: "You can only complete the plan once it has started.",
      cancel: "Cancel plan",
      cancelTitle: "Cancel plan?",
      cancelBody: "Everyone taking part gets notified. This can't be undone.",
      cancelled: "Plan cancelled.",
    },
    statusNote: {
      proposed: "This plan is a suggestion and hasn't been confirmed yet.",
      cancelled: "This plan was cancelled.",
      completed: "This plan is completed.",
    },
    again: {
      title: "Again?",
      leadPlace: (place: string) => `Good night at ${place}? One tap and the crew finds the next date there.`,
      lead: "Good night? One tap and the crew finds the next date.",
      went: (n: number) => (n === 1 ? "1 was there" : `${n} were there`),
      findDatePlace: "Same place – find a date",
      findDate: "Find a date to do it again",
    },
    /** P32: "Try again?" on cancelled plans. */
    retry: {
      title: "Try again?",
      leadPlace: (place: string) => `Cancelled doesn’t mean off. One tap and the crew finds a new date at ${place}.`,
      lead: "Cancelled doesn’t mean off. One tap and the crew finds a new date.",
      findDate: "Find a new date",
    },
    followUp: {
      title: "What's next?",
      body: "Ideas for your next outing.",
      startPoll: "Start the next poll",
    },
    notFoundTitle: "This plan doesn't exist",
    notFoundBody: "It was deleted or you're no longer in the crew.",
  },
  /** W2 · Geteilter Plan (/s/<token>): Karte für Freunde ohne Konto bzw. außerhalb der Crew. */
  shared: {
    pageTitle: (title: string) => `${title} – shared plan`,
    kicker: "An evening with AFTERHOURS",
    going: (n: number, over: boolean): string =>
      over ? (n === 0 ? "Nobody went" : n === 1 ? "was there" : "were there") : n === 0 ? "Nobody in yet" : n === 1 ? "is in" : "are in",
    /** P25 Etappe 2: Mindestzahl auf der geteilten Karte. */
    quorumAsk: (n: number) => (n === 1 ? "1 more needed – are you in?" : `${n} more needed – are you in?`),
    /** P26 Etappe 2: Höchstzahl auf der geteilten Karte. */
    capacityLeft: (n: number) => (n === 1 ? "1 spot left" : `${n} spots left`),
    capacityFull: "Full – a spot opens if someone drops out",
    guestTitle: "Are you in?",
    guestIntro: "Your friends are planning this evening with AFTERHOURS. You can say you're in once you're in their crew – ask for the invite link in the group chat.",
    register: "Create account",
    hasAccount: "Already have an account?",
    toLogin: "Log in",
    outsiderTitle: "Not in the crew yet",
    outsiderIntro: "This plan belongs to a crew you're not in yet. Ask for the invite link – then you'll see everything and can say you're in.",
    toHome: "Go to your overview",
    privacy: "The link only shows the title, time and how many people are in. Who's in and where it's happening is only visible to the crew.",
    status: {
      not_found: { title: "Plan not found", body: "The link is incomplete or wrong. Ask for a new one in the group chat." },
      expired: { title: "This evening is over", body: "Shared plans can be viewed until three days after the evening." },
    },
    toStart: "Go to AFTERHOURS",
  },
} satisfies typeof dePlans;
