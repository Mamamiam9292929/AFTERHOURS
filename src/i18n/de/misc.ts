export const notifications = {
  title: "Benachrichtigungen",
  bellUnread: (n: number) => (n === 1 ? "Benachrichtigungen, 1 ungelesen" : `Benachrichtigungen, ${n} ungelesen`),
  markAllRead: "Alle als gelesen markieren",
  empty: { title: "Alles gelesen", body: "Neue Abstimmungen, Planänderungen und Antworten deiner Crew erscheinen hier." },
  unread: "Ungelesen",
  delete: "Benachrichtigung löschen",
  someone: "Jemand",
  pushNote: "Auch aufs Handy, wenn die App zu ist: Push-Mitteilungen schaltest du in den Einstellungen je Gerät ein.",
  /** P4: Text im Service Worker, wenn ein Push unbekannt oder unvollständig ist. */
  push: { fallbackTitle: "AFTERHOURS", fallbackBody: "Neues in deiner Crew" },
  manage: "Benachrichtigungen einstellen",
  // V2 Etappe 3l: Stand oben, Tagesgruppen und Bereich je Karte.
  statusUnread: (n: number) => (n === 1 ? "1 neu" : `${n} neu`),
  statusAllRead: "Alles gelesen",
  statusTotal: (n: number) => (n === 1 ? "1 Eintrag" : `${n} Einträge`),
  groups: { today: "Heute", yesterday: "Gestern", week: "Diese Woche", older: "Früher" },
  areas: { poll: "Abstimmung", plan: "Plan", crew: "Crew", money: "Kosten", spontaneous: "Heute noch wer?", reward: "Punkte" },
};

export const profile = {
  title: "Profil",
  edit: "Profil bearbeiten",
  noCity: "Keine Stadt angegeben",
  interests: "Interessen",
  noInterests: "Noch keine Interessen gewählt.",
  stats: { crews: "Crews", planned: "Geplant", completed: "Erlebt", points: "Punkte" },
  crews: "Deine Crews",
  pass: {
    label: "Stammkarte",
    evenings: (n: number): string => (n === 1 ? "Abend erlebt" : "Abende erlebt"),
    since: (monthYear: string) => `Dabei seit ${monthYear}`,
  },
  /** F8 · im Kern, weil das Profil die Einstellungs-Texte nicht mitlädt. */
  signOut: "Abmelden",
  links: { settings: "Einstellungen", notifications: "Benachrichtigungen", privacy: "Datenschutz und deine Daten", admin: "Admin-Bereich", assistant: "Planungsassistent" },
};
