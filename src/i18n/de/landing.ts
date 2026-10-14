/**
 * W6 · Öffentliche Startseite („/“ ohne Anmeldung). Nur Aussagen über Funktionen, die es wirklich gibt –
 * keine Nutzerzahlen, Bewertungen oder Preise. Beispielinhalte sind sichtbar als „Beispiel“ markiert.
 */
export const landing = {
  pageTitle: "Abende mit deiner Crew planen",
  nav: { login: "Anmelden", start: "Crew gründen" },
  hero: {
    eyebrow: "Die App für Freundesgruppen",
    title: ["Ein Abend.", "Eine Crew."],
    titleAccent: "Kein Chat-Chaos.",
    body: "Abstimmen, Ort finden, Plan festmachen – an einer Stelle statt in fünf Chats. Wer dabei ist, siehst du auf einen Blick.",
    cta: "Crew gründen",
    login: "Ich habe schon ein Konto",
    note: "Freunde kommen per Link dazu – direkt im Browser, ohne App Store.",
  },
  sample: {
    label: "Beispiel",
    ticketLabel: "Beispiel: ein Plan als Ticket",
    ticketTitle: "Bowling",
    ticketPlace: "Treffpunkt am Eingang",
    ticketStamp: "Dabei",
    goingOf: (going: number, total: number) => `${going} von ${total} dabei`,
    pollLabel: "Beispiel: eine Abstimmung",
    pollQuestion: "Was machen wir am",
    pollQuestionAccent: "Samstag?",
    pollMeta: "4 von 5 haben abgestimmt · noch 6 Std.",
    leading: "Vorn",
    yes: (n: number) => (n === 1 ? "1 Zusage" : `${n} Zusagen`),
    options: [
      { title: "Bowling", meta: "Sa · 20:00 Uhr", yes: 4 },
      { title: "Biergarten", meta: "Sa · 18:00 Uhr", yes: 2 },
      { title: "Kino", meta: "Sa · 21:15 Uhr", yes: 1 },
    ],
    people: ["Lea", "Jonas", "Mira", "Tarik", "Sophie", "Ben"],
  },
  steps: {
    title: "So wird aus einer Frage",
    titleAccent: "ein Abend",
    items: [
      { title: "Crew gründen", body: "Name, Symbol, fertig. Den Einladungslink schickst du in euren Gruppenchat – wer drauftippt, ist mit einem Tipp dabei." },
      { title: "Abstimmen", body: "Bis zu zehn Vorschläge: echte Orte aus deiner Stadt oder „Grillen bei Bob“. Jeder antwortet mit „Bin dabei“, „Vielleicht“ oder „Bin nicht dabei“." },
      { title: "Plan steht", body: "Aus dem Ergebnis wird ein Plan: Zeit, Ort, Treffpunkt, Kosten pro Person und wer zugesagt hat – als Ticket für alle." },
    ],
  },
  features: {
    title: "Alles, was ein Abend",
    titleAccent: "braucht",
    items: [
      { key: "places" as const, title: "Echte Orte in jeder Stadt", body: "Restaurants, Bars, Bowling, Kinos und mehr aus OpenStreetMap – mit Quelle. Was nicht bekannt ist, steht als unbekannt da." },
      { key: "answer" as const, title: "Zusagen mit einem Tipp", body: "Bin dabei, Vielleicht oder Kann nicht – direkt auf der Startseite. Dein Ticket zeigt deine Antwort in Farbe." },
      { key: "share" as const, title: "Ab in den Gruppenchat", body: "Plan oder Abstimmung mit einem Tipp teilen: Titel, Zeit und Link – ohne Namen oder Adressen." },
      { key: "calendar" as const, title: "Im Kalender", body: "Steht der Plan, landet er mit Ort und Treffpunkt in deinem Kalender." },
      { key: "rides" as const, title: "Fahrgemeinschaften", body: "Wer fährt, wer fährt mit – mit Platzkontrolle, damit niemand am Straßenrand steht." },
      { key: "app" as const, title: "Wie eine App", body: "Auf den Homescreen legen, Pläne auch im Funkloch lesen." },
    ],
  },
  privacy: {
    title: "Deine Daten bleiben bei dir",
    body: "Standortfreigabe ist aus, bis du sie selbst einschaltest. Budget und Entfernung siehst nur du. Export und Löschen deines Kontos gehen jederzeit in den Einstellungen.",
    link: "Was wir speichern",
  },
  final: {
    question: "Wer fragt diesmal in der Gruppe?",
    answer: "Du.",
    body: "Crew gründen, Link teilen, abstimmen – in drei Schritten zum ersten Plan.",
    cta: "Crew gründen",
    stub: "Einlass",
  },
  footer: { privacy: "Datenschutz", login: "Anmelden" },
};
