/**
 * W6 · Öffentliche Startseite („/“ ohne Anmeldung), seit V2 im Stil „Aurora × Y2K × Deck“. Nur Aussagen über
 * Funktionen, die es wirklich gibt – keine Nutzerzahlen, Bewertungen oder Preise. Beispielinhalte sind
 * sichtbar als „Beispiel“ markiert.
 */
export const landing = {
  pageTitle: "Abende mit deiner Crew planen",
  nav: { login: "Anmelden", start: "Crew gründen" },
  hero: {
    eyebrow: "Schneller als der Gruppenchat",
    title: ["Ein Satz.", "Eine Abstimmung."],
    titleAccent: "Ein Abend.",
    body: "Schreib, was ihr vorhabt – wie im Chat. AFTERHOURS macht daraus eine Abstimmung, deine Freunde stimmen über den Link mit ab, und bei klarer Mehrheit steht der Plan von selbst.",
    cta: "Crew gründen",
    login: "Ich habe schon ein Konto",
    note: "Freunde stimmen direkt im Browser ab – ohne App Store und ohne Konto.",
  },
  sample: {
    label: "Beispiel",
    people: ["Lea", "Jonas", "Mira", "Tarik", "Sophie", "Ben"],
  },
  /** Live-Vorschau mit dem echten Satz-Zerleger der App (läuft nur im Browser). */
  demo: {
    label: "Probier’s aus: ein Satz wird zur Abstimmung",
    badge: "Läuft nur hier im Browser",
    input: "Was habt ihr vor?",
    initial: "bowling oder kino, fr oder sa, 20 uhr",
    examples: ["heute noch bar?", "wochenende grillen am see", "do oder fr bouldern ab 19 uhr"],
    exampleLabel: "Beispiel einsetzen",
    preview: "Daraus wird",
    empty: "Schreib, was ihr machen wollt – Tage und Uhrzeit erkenne ich mit.",
    options: (n: number) => (n === 1 ? "1 Vorschlag" : `${n} Vorschläge`),
    privacy: "Nichts davon wird gespeichert oder verschickt.",
    cta: "So in die Gruppe schicken",
  },
  steps: {
    title: "In drei Zügen",
    titleAccent: "zum Abend",
    items: [
      { title: "Ein Satz", body: "„Was geht?“ antippen und schreiben, was ihr vorhabt. Aktivitäten, Tage und Uhrzeit erkennt die App – ohne KI, direkt auf dem Handy." },
      { title: "Link in die Gruppe", body: "Der Link landet im Gruppenchat. Freunde stimmen ohne App und ohne Konto ab – Name eintippen, fertig." },
      { title: "Wischen, Match, Plan", body: "Rechts dabei, links eher nicht. Hat die Crew eine klare Mehrheit, legt die Abstimmung den Plan selbst an – niemand muss hinterherräumen." },
    ],
  },
  deck: {
    label: "Beispiel: Vorschläge als Kartenstapel",
    cards: [
      { title: "Kino", when: "Sa., 20:00 Uhr", going: "3 sind dabei" },
      { title: "Bowling", when: "Fr., 20:00 Uhr", going: "2 sind dabei" },
      { title: "Bar", when: "Sa., 22:00 Uhr", going: "1 ist dabei" },
    ],
    hint: "Nach rechts: dabei · nach links: eher nicht",
  },
  answers: {
    title: "Deine Antwort,",
    titleAccent: "deine Farbe",
    body: "Jeder Plan ist eine Karte – und die ganze Karte trägt deine Antwort. Ein Blick auf den Stapel, und du weißt, wo du dabei bist.",
    label: "Beispiel: Plan-Karten in den Antwortfarben",
    cards: [
      { answer: "going" as const, title: "Bowling", place: "Treffpunkt am Eingang", stamp: "Dabei", weekday: "sat" as const, time: "20:00" },
      { answer: "maybe" as const, title: "Flohmarkt", place: "Treffpunkt am Hoftor", stamp: "Vielleicht", weekday: "sun" as const, time: "11:00" },
      { answer: "declined" as const, title: "Karaoke", place: "Treffpunkt an der Bar", stamp: "Abgesagt", weekday: "fri" as const, time: "21:30" },
    ],
  },
  features: {
    title: "Alles, was ein Abend",
    titleAccent: "braucht",
    items: [
      { key: "guests" as const, title: "Abstimmen ohne App", body: "Wer den Link hat, stimmt im Browser mit ab. Später der Crew beitreten und die eigene Stimme mitnehmen." },
      { key: "auto" as const, title: "Entscheidet sich selbst", body: "Klare Mehrheit oder Frist vorbei: Der Plan steht, und alle bekommen Bescheid. Gleichstand? Dann eine kurze Stichwahl." },
      { key: "places" as const, title: "Echte Orte in jeder Stadt", body: "Bars, Bowling, Kinos und mehr aus OpenStreetMap – mit Quelle. Was nicht bekannt ist, steht als unbekannt da." },
      { key: "weather" as const, title: "Wetter beim Abstimmen", body: "Biergarten oder Bowling? Die Vorhersage steht direkt beim Vorschlag – mit Hinweis, wenn es draußen ungemütlich wird." },
      { key: "repeat" as const, title: "Stammtisch ohne Organisator", body: "„Freitag, was geht?“ startet jede Woche von selbst – oder der Plan wiederholt sich gleich ganz." },
      { key: "money" as const, title: "Kosten teilen", body: "Wer hat was ausgelegt, wer gibt wem? Mit möglichst wenigen Überweisungen – bezahlt wird, wie ihr wollt." },
      { key: "calendar" as const, title: "Im Kalender", body: "Ein Abo-Link, und jeder Plan deiner Crews steht in deinem Kalender – mit Änderungen." },
      { key: "app" as const, title: "Wie eine App", body: "Auf den Homescreen legen, Pläne auch im Funkloch lesen. Ohne App Store." },
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
    body: "Crew gründen, einen Satz schreiben, Link teilen – der Rest erledigt sich fast von selbst.",
    cta: "Crew gründen",
  },
  footer: { privacy: "Datenschutz", login: "Anmelden" },
};
