import type { landing as deLanding } from "../de/landing";

/**
 * W6 · Öffentliche Startseite („/“ ohne Anmeldung), englische Fassung. Nur Aussagen über Funktionen, die es
 * wirklich gibt – keine Nutzerzahlen, Bewertungen oder Preise. Beispielinhalte sind sichtbar als „Example“ markiert.
 */
export const landing = {
  pageTitle: "Plan nights out with your crew",
  nav: { login: "Log in", start: "Start a crew" },
  hero: {
    eyebrow: "Faster than the group chat",
    title: ["One sentence.", "One poll."],
    titleAccent: "One night out.",
    body: "Write what you're up to – like in a chat. AFTERHOURS turns it into a poll, your friends vote via the link, and once there's a clear majority the plan sets itself.",
    cta: "Start a crew",
    login: "I already have an account",
    note: "Friends vote right in the browser – no app store, no account.",
  },
  sample: {
    label: "Example",
    people: ["Lea", "Jonas", "Mira", "Tarik", "Sophie", "Ben"],
  },
  demo: {
    label: "Try it: one sentence becomes a poll",
    badge: "Runs only here in your browser",
    input: "What are you up to?",
    initial: "bowling or cinema, fri or sat, 8 pm",
    examples: ["bar tonight?", "barbecue by the lake at the weekend", "climbing thu or fri from 7 pm"],
    exampleLabel: "Use example",
    preview: "This becomes",
    empty: "Write what you want to do – I'll pick up days and times too.",
    options: (n: number) => (n === 1 ? "1 option" : `${n} options`),
    privacy: "None of this is saved or sent.",
    cta: "Send it to the group like this",
  },
  steps: {
    title: "Three moves",
    titleAccent: "to a night out",
    items: [
      { title: "One sentence", body: "Tap “What's on?” and write what you're up to. The app picks out activities, days and times – no AI, right on your phone." },
      { title: "Link to the group", body: "The link goes into the group chat. Friends vote without the app and without an account – type a name, done." },
      { title: "Swipe, match, plan", body: "Right for in, left for rather not. Once the crew has a clear majority, the poll creates the plan itself – nobody has to tidy up afterwards." },
    ],
  },
  deck: {
    label: "Example: options as a card stack",
    cards: [
      { title: "Cinema", when: "Sat, 8 pm", going: "3 are in" },
      { title: "Bowling", when: "Fri, 8 pm", going: "2 are in" },
      { title: "Bar", when: "Sat, 10 pm", going: "1 is in" },
    ],
    hint: "Right: in · left: rather not",
  },
  answers: {
    title: "Your answer,",
    titleAccent: "your colour",
    body: "Every plan is a card – and the whole card shows your answer. One look at the stack and you know where you're in.",
    label: "Example: plan cards in the answer colours",
    cards: [
      { answer: "going" as const, title: "Bowling", place: "Meeting point at the entrance", stamp: "In", weekday: "sat" as const, time: "20:00" },
      { answer: "maybe" as const, title: "Flea market", place: "Meeting point at the courtyard gate", stamp: "Maybe", weekday: "sun" as const, time: "11:00" },
      { answer: "declined" as const, title: "Karaoke", place: "Meeting point at the bar", stamp: "Out", weekday: "fri" as const, time: "21:30" },
    ],
  },
  features: {
    title: "Everything a night out",
    titleAccent: "needs",
    items: [
      { key: "guests" as const, title: "Vote without the app", body: "Anyone with the link votes in the browser. Join the crew later and take your vote with you." },
      { key: "auto" as const, title: "Decides itself", body: "Clear majority or deadline passed: the plan is set and everyone gets notified. A tie? Then a quick runoff." },
      { key: "places" as const, title: "Real places in every city", body: "Bars, bowling, cinemas and more from OpenStreetMap – with the source. Anything we don't know is shown as unknown." },
      { key: "weather" as const, title: "Weather while you vote", body: "Beer garden or bowling? The forecast sits right next to the option – with a heads-up when it gets grim outside." },
      { key: "repeat" as const, title: "A regular without an organiser", body: "“Friday, what's on?” starts by itself every week – or the whole plan just repeats." },
      { key: "money" as const, title: "Split costs", body: "Who paid for what, who pays whom? With as few transfers as possible – pay however you like." },
      { key: "calendar" as const, title: "In your calendar", body: "One subscription link, and every plan from your crews is in your calendar – including changes." },
      { key: "app" as const, title: "Like an app", body: "Add it to your home screen and read plans even without signal. No app store." },
    ],
  },
  privacy: {
    title: "Your data stays with you",
    body: "Location sharing is off until you turn it on yourself. Only you see your budget and distance. You can export or delete your account at any time in Settings.",
    link: "What we store",
  },
  final: {
    question: "Who's asking the group this time?",
    answer: "You.",
    body: "Start a crew, write one sentence, share the link – the rest almost takes care of itself.",
    cta: "Start a crew",
  },
  footer: { privacy: "Privacy", login: "Log in" },
} satisfies typeof deLanding;
