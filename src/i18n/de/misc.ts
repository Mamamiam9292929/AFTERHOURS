import { formatEuro } from "@/lib/format";
import { formatDateTime } from "@/lib/time";
import type { NotificationType } from "@/lib/types";

type Payload = Record<string, unknown>;
const str = (payload: Payload, key: string, fallback = "") => (typeof payload[key] === "string" ? (payload[key] as string) : fallback);

/** Texte für Benachrichtigungen. `actor` ist der Anzeigename der auslösenden Person (falls bekannt). */
const notificationText: Record<NotificationType, (actor: string, payload: Payload) => { title: string; body?: string }> = {
  crew_member_joined: (actor) => ({ title: `${actor} ist deiner Crew beigetreten` }),
  crew_member_removed: (_actor, p) => ({ title: `Du wurdest aus „${str(p, "crew_name", "einer Crew")}“ entfernt` }),
  crew_role_changed: (_actor, p) => ({
    title: p.role === "owner" ? "Du bist jetzt Owner der Crew" : p.role === "admin" ? "Du bist jetzt Admin der Crew" : "Deine Rolle in der Crew wurde geändert",
    body: p.reason === "succession" ? "Der bisherige Owner hat die Crew verlassen." : undefined,
  }),
  // S5 Etappe 2 / S7: Stichwahl nach Gleichstand und neue Wochenrunde starten von selbst – ohne auslösende Person.
  poll_created: (actor, p) => ({
    title: p.repeat
      ? "Neue Runde – was geht diese Woche?"
      : p.auto && p.runoff
        ? "Gleichstand – die Stichwahl läuft"
        : p.runoff
          ? `${actor} hat eine Stichwahl gestartet`
          : `${actor} hat eine Abstimmung gestartet`,
    body: str(p, "title"),
  }),
  poll_reminder: (actor, p) => ({ title: `${actor} erinnert dich an eine Abstimmung`, body: str(p, "title") }),
  poll_vote: (actor, p) => ({ title: p.guest ? `${str(p, "guest")} (Gast) hat abgestimmt` : `${actor} hat abgestimmt`, body: str(p, "title") }),
  poll_result: (_actor, p) => ({
    title: p.winner_title ? `Ergebnis: ${str(p, "winner_title")}` : p.is_tie ? "Abstimmung endet mit Gleichstand" : "Abstimmung ohne Zusagen beendet",
    body: str(p, "title"),
  }),
  // P8: Den nächsten Termin eines wiederkehrenden Plans legt die App selbst an – ohne auslösende Person.
  // S5: Die Abstimmung hat sich selbst entschieden – auch hier ohne auslösende Person.
  plan_created: (actor, p) =>
    p.repeat
      ? { title: "Der nächste Termin steht – bist du dabei?", body: str(p, "starts_at") ? `${str(p, "title")} · ${formatDateTime(str(p, "starts_at"))}` : str(p, "title") }
      : p.auto
        ? { title: "Entschieden – der Plan steht", body: str(p, "starts_at") ? `${str(p, "title")} · ${formatDateTime(str(p, "starts_at"))}` : str(p, "title") }
        : { title: `${actor} hat einen Plan erstellt`, body: str(p, "title") },
  plan_changed: (actor, p) => {
    const labels: Record<string, string> = { starts_at: "Zeit", address: "Ort", meeting_point: "Treffpunkt", cost: "Kosten" };
    const changed = Array.isArray(p.changed) ? (p.changed as string[]).map((key) => labels[key] ?? key).join(", ") : "";
    return { title: `${actor} hat einen Plan geändert${changed ? `: ${changed}` : ""}`, body: str(p, "title") };
  },
  // P8 Etappe 2: „Diesmal aussetzen“ – der Termin fällt aus, der Stammtisch geht weiter.
  plan_cancelled: (actor, p) =>
    p.skipped
      ? {
          title: `${actor} setzt diesmal aus: ${str(p, "title")}`,
          body: str(p, "next_starts_at") ? `Nächster Termin: ${formatDateTime(str(p, "next_starts_at"))}` : "Der Stammtisch geht weiter.",
        }
      : { title: `${actor} hat einen Plan abgesagt`, body: str(p, "title") },
  plan_attendance: (actor, p) => ({
    title: p.status === "going" ? `${actor} ist dabei` : p.status === "maybe" ? `${actor} kommt vielleicht` : `${actor} hat abgesagt`,
    body: str(p, "title"),
  }),
  booking_status: (_actor, p) => {
    const status: Record<string, string> = { confirmed: "Reservierung bestätigt", unavailable: "Reservierung nicht möglich: nichts frei", failed: "Reservierung fehlgeschlagen", cancelled_by_user: "Reservierung storniert" };
    return { title: status[str(p, "status")] ?? "Reservierungsstand geändert", body: str(p, "title") };
  },
  ride_request: (actor, p) => ({ title: `${actor} möchte bei dir mitfahren`, body: str(p, "title") }),
  ride_confirmed: (actor, p) => ({ title: p.accepted ? `${actor} nimmt dich mit` : `${actor} kann dich nicht mitnehmen`, body: str(p, "title") }),
  // P3: Ausgabe, an der du beteiligt bist (oder die als von dir bezahlt eingetragen wurde), und Rückzahlungen.
  plan_expense: (actor, p) => ({
    title: p.you_paid ? `${actor} hat eingetragen, dass du „${str(p, "description")}“ bezahlt hast` : `${actor} hat „${str(p, "description")}“ eingetragen`,
    body: [typeof p.share_cents === "number" ? `Dein Anteil: ${formatEuro(p.share_cents)}` : typeof p.amount_cents === "number" ? formatEuro(p.amount_cents) : "", str(p, "title")].filter(Boolean).join(" · "),
  }),
  plan_settlement: (actor, p) => {
    const amount = typeof p.amount_cents === "number" ? formatEuro(p.amount_cents) : "";
    return { title: p.direction === "received" ? `${actor} hat deine Rückzahlung von ${amount} bestätigt` : `${actor} hat dir ${amount} zurückgegeben`, body: str(p, "title") };
  },
  reward_earned: (_actor, p) => ({
    title: `+${typeof p.points === "number" ? p.points : ""} Punkte`,
    body: `${p.reason === "plan_organized" ? "Für die Organisation" : "Für deine Teilnahme"}: ${str(p, "title")}`,
  }),
};

export const notifications = {
  title: "Benachrichtigungen",
  bellUnread: (n: number) => (n === 1 ? "Benachrichtigungen, 1 ungelesen" : `Benachrichtigungen, ${n} ungelesen`),
  markAllRead: "Alle als gelesen markieren",
  empty: { title: "Alles gelesen", body: "Neue Abstimmungen, Planänderungen und Antworten deiner Crew erscheinen hier." },
  unread: "Ungelesen",
  delete: "Benachrichtigung löschen",
  someone: "Jemand",
  pushNote: "Push-Mitteilungen aufs Handy gibt es noch nicht. Benachrichtigungen erscheinen in der App.",
  manage: "Benachrichtigungen einstellen",
  text: notificationText,
};

export const rewards = {
  title: "Rewards",
  lead: "Punkte gibt es für Unternehmungen, die wirklich stattgefunden haben.",
  points: (n: number) => (n === 1 ? "1 Punkt" : `${n} Punkte`),
  balanceLabel: "Dein Punktestand",
  levels: ["Neu dabei", "Mitmacher", "Stammgast", "Organisationstalent", "Legende"],
  nextLevel: (points: number, level: string) => `Noch ${points} Punkte bis „${level}“`,
  maxLevel: "Höchste Stufe erreicht.",
  rulesTitle: "So sammelst du Punkte",
  rules: [
    { points: 30, title: "Plan organisiert", body: "Du hast einen Plan erstellt, der stattgefunden hat und abgeschlossen wurde." },
    { points: 10, title: "Dabei gewesen", body: "Du hattest zu einem abgeschlossenen Plan zugesagt." },
  ],
  rulesFine: "Punkte gibt es nur für Pläne mit mindestens zwei zugesagten Personen, pro Plan einmal und höchstens für drei Teilnahmen sowie zwei organisierte Pläne pro Tag. Vergeben werden sie serverseitig beim Abschließen eines Plans.",
  milestonesTitle: "Meilensteine",
  milestones: {
    firstAttended: "Erste Unternehmung",
    fiveAttended: "Fünfmal dabei",
    firstOrganized: "Zum ersten Mal organisiert",
    fiveOrganized: "Fünf Pläne organisiert",
  },
  milestoneDone: "Erreicht",
  milestoneProgress: (current: number, target: number) => `${current} von ${target}`,
  historyTitle: "Verlauf",
  historyEmpty: { title: "Noch keine Punkte", body: "Schließt euren ersten gemeinsamen Plan ab – dann erscheint er hier." },
  reason: { plan_organized: "Plan organisiert", plan_attended: "Dabei gewesen", partner_bonus: "Partnerbonus", admin_adjustment: "Korrektur" },
  showPlan: "Plan ansehen",
  partnersTitle: "Prämien von Partnern",
  partnersNotice: {
    title: "Noch keine Partner",
    body: "Die folgenden Prämien sind Beispiele dafür, wie Angebote aussehen könnten. Es gibt sie nicht, und es lässt sich nichts einlösen.",
  },
  partnerExamples: [
    { title: "2-für-1 auf die zweite Bowling-Runde", partner: "Beispiel-Bowlingcenter", cost: 150 },
    { title: "Gratis-Nachos zum Kinoticket", partner: "Beispiel-Kino", cost: 100 },
    { title: "10 % auf die Gruppenrechnung", partner: "Beispiel-Restaurant", cost: 300 },
  ],
  redeem: "Einlösen nicht möglich",
  cost: (n: number) => `${n} Punkte`,
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
    evenings: (n: number) => (n === 1 ? "Abend erlebt" : "Abende erlebt"),
    since: (monthYear: string) => `Dabei seit ${monthYear}`,
  },
  links: { settings: "Einstellungen", notifications: "Benachrichtigungen", privacy: "Datenschutz und deine Daten", admin: "Admin-Bereich", assistant: "Planungsassistent" },
};

export const settings = {
  title: "Einstellungen",
  back: "Profil",
  profile: { title: "Profil", saved: "Profil gespeichert." },
  preferences: { title: "Vorlieben", saved: "Vorlieben gespeichert." },
  location: {
    title: "Standortfreigabe",
    lead: "Du entscheidest, ob und mit wem du deinen Standort teilst. Standard ist: gar nicht.",
    notLive: {
      title: "Noch nicht aktiv",
      body: "Live-Standorte sind in dieser Version nicht eingebaut. Die App fragt deinen Standort nicht ab, speichert ihn nicht und zeigt ihn niemandem. Deine Auswahl wird vorgemerkt und gilt erst, wenn die Funktion verfügbar ist – du wirst dann noch einmal ausdrücklich gefragt.",
    },
    crew: "Crew",
    crewNone: "Du bist in keiner Crew.",
    selectedFriendsNote: "Die Auswahl einzelner Personen folgt zusammen mit der Standortfunktion.",
    saved: "Standortfreigabe gespeichert.",
    whatIsShared: "Was würde geteilt? Deine ungefähre Position, solange die Freigabe läuft – nie deine Adresse, nie dauerhaft.",
  },
  notifications: {
    title: "Benachrichtigungen",
    lead: "Wähle, worüber dich die App informiert.",
    saved: "Benachrichtigungen gespeichert.",
    groups: {
      polls: { title: "Neue Abstimmungen", body: "Wenn jemand in deiner Crew eine Abstimmung startet." },
      reminders: { title: "Erinnerungen", body: "Wenn deine Antwort auf eine Abstimmung noch fehlt." },
      answers: { title: "Neue Antworten", body: "Wenn jemand auf deine Abstimmung oder deinen Plan antwortet." },
      results: { title: "Ergebnisse", body: "Wenn eine Abstimmung endet." },
      plans: { title: "Pläne", body: "Neue Pläne, Änderungen an Zeit, Ort oder Kosten und Absagen." },
      bookings: { title: "Reservierungen", body: "Wenn sich der Stand einer Reservierung ändert." },
      rides: { title: "Mitfahrten", body: "Anfragen und Zusagen für Fahrgemeinschaften." },
      costs: { title: "Kosten teilen", body: "Neue Ausgaben, an denen du beteiligt bist, und Rückzahlungen." },
      crew: { title: "Crew", body: "Neue Mitglieder und Änderungen deiner Rolle." },
      rewards: { title: "Rewards", body: "Wenn du Punkte erhältst." },
    },
  },
  /** P2 Etappe 2: persönlicher Abo-Link für Kalender-Apps. */
  calendar: {
    title: "Kalender-Abo",
    lead: "Alle Pläne deiner Crews im Kalender deines Handys – neue Pläne, Änderungen und Absagen kommen von selbst an.",
    create: "Abo-Link erstellen",
    created: "Abo-Link erstellt. Jetzt in deinem Kalender abonnieren.",
    inactive: "Noch kein Abo. Mit dem Link abonnierst du AFTERHOURS in Apple Kalender, Google Kalender oder Outlook.",
    whatsIn: "Drin sind Titel, Zeit, Ort, Treffpunkt und Crew deiner Pläne – ab 60 Tagen zurück. Pläne, bei denen du abgesagt hast, fehlen; abgesagte Pläne stehen als „Abgesagt“ drin. Keine Namen der anderen.",
    linkLabel: "Dein Abo-Link",
    apple: "In Apple Kalender öffnen",
    google: "Google Kalender",
    googleNote: "Google ruft den Link danach selbst ab.",
    copy: "Link kopieren",
    copied: "Abo-Link kopiert.",
    copyFailed: "Kopieren hat nicht geklappt – markiere den Link und kopiere ihn von Hand.",
    secret: "Wer diesen Link hat, sieht deine Pläne mit Ort und Treffpunkt. Teile ihn mit niemandem – auch nicht im Gruppenchat.",
    delay: "Kalender-Apps sehen meist nur alle paar Stunden nach. Änderungen kommen also nicht sekundengenau an.",
    lastUsed: (ago: string) => `Zuletzt abgerufen ${ago}.`,
    neverUsed: "Noch von keinem Kalender abgerufen.",
    renew: "Neuen Link erstellen",
    renewTitle: "Neuen Abo-Link erstellen?",
    renewBody: "Der bisherige Link funktioniert danach nicht mehr. Kalender, die ihn abonniert haben, bekommen keine Pläne mehr – dort musst du den neuen Link eintragen.",
    renewConfirm: "Neuen Link erstellen",
    renewed: "Neuer Abo-Link erstellt. Der alte funktioniert nicht mehr.",
    revoke: "Abo beenden",
    revokeTitle: "Kalender-Abo beenden?",
    revokeBody: "Der Link funktioniert danach nicht mehr. Kalender, die ihn abonniert haben, zeigen keine neuen Pläne mehr; entferne das Abo dort am besten auch.",
    revokeConfirm: "Abo beenden",
    revoked: "Kalender-Abo beendet.",
  },
  account: {
    title: "Konto",
    email: "E-Mail-Adresse",
    passwordTitle: "Passwort ändern",
    passwordSaved: "Passwort geändert.",
    passwordSubmit: "Passwort ändern",
    exportTitle: "Deine Daten",
    exportBody: "Lade alles herunter, was AFTERHOURS über dich gespeichert hat – als JSON-Datei.",
    exportAction: "Daten herunterladen",
    exportDone: "Download gestartet.",
    deleteTitle: "Konto löschen",
    deleteBody: "Dein Profil, deine Einstellungen, Mitgliedschaften, Stimmen, Zusagen, Punkte und Benachrichtigungen werden sofort und unwiderruflich gelöscht. Von dir gestartete Abstimmungen und Pläne bleiben für die Crew erhalten, aber ohne deinen Namen.",
    deleteAction: "Konto löschen",
    deleteDialogTitle: "Konto endgültig löschen?",
    deleteConfirmLabel: "Tippe LÖSCHEN, um zu bestätigen",
    deleteConfirmWord: "LÖSCHEN",
    deleteSubmit: "Konto endgültig löschen",
    deleted: "Dein Konto wurde gelöscht.",
    signOut: "Abmelden",
  },
};

export const privacy = {
  title: "Datenschutz und deine Daten",
  disclaimer: "Diese Seite beschreibt in einfachen Worten, wie die App mit Daten umgeht. Sie ersetzt keine rechtlich geprüfte Datenschutzerklärung – die muss der Betreiber vor dem öffentlichen Start ergänzen.",
  sections: [
    {
      title: "Was gespeichert wird",
      items: [
        "Konto: deine E-Mail-Adresse und ein verschlüsseltes Passwort (bei Supabase Auth).",
        "Profil: Anzeigename, optional Profilbild, Stadt und Interessen.",
        "Aktivität: Crews, Nachrichten im Crew-Chat, Abstimmungen, Stimmen, Pläne, Zusagen, Reservierungsvermerke, Mitfahrten, Punkte und Benachrichtigungen.",
        "Einstellungen: Budget, Entfernung, Benachrichtigungen und deine Wahl zur Standortfreigabe.",
      ],
    },
    {
      title: "Wer was sieht",
      items: [
        "Dein Profil sehen nur Personen, mit denen du mindestens eine Crew teilst.",
        "Inhalte einer Crew sehen nur ihre Mitglieder. Das erzwingt die Datenbank selbst, nicht nur die Oberfläche.",
        "Deine Einstellungen, deine E-Mail-Adresse und deine Punkte siehst nur du.",
        "Kalender-Abo: Legst du einen Abo-Link an, kann jede Kalender-App (und jede Person), die ihn kennt, deine Pläne lesen – ohne Anmeldung. Du kannst ihn jederzeit ersetzen oder beenden.",
        "Ohne Anmeldung ist nichts abrufbar – außer dem, was ihr bewusst per Link teilt: Einladungen, geteilte Pläne und Abstimmungen, dein Kalender-Abo.",
      ],
    },
    {
      title: "Standort",
      items: [
        "Die Standortfreigabe ist standardmäßig aus.",
        "In dieser Version wird kein Gerätestandort abgefragt oder gespeichert.",
        "Entfernungen werden aus der Stadt in deinem Profil geschätzt (Luftlinie ab Stadtmitte).",
        "Karten laden erst, wenn du auf „Karte laden“ tippst – dann geht eine Anfrage an OpenStreetMap.",
      ],
    },
    {
      title: "Deine Rechte",
      items: [
        "Auskunft: In den Einstellungen lädst du alle deine Daten als Datei herunter.",
        "Berichtigung: Profil und Einstellungen kannst du jederzeit ändern.",
        "Löschung: In den Einstellungen löschst du dein Konto sofort und endgültig.",
      ],
    },
    {
      title: "Dritte",
      items: [
        "Schriften und Icons liegen in der App selbst; es wird nichts von Schrift- oder Tracking-Diensten nachgeladen.",
        "Es gibt keine Werbung und kein Tracking.",
        "Daten liegen bei Supabase (Datenbank und Anmeldung) in der Region, die der Betreiber wählt.",
      ],
    },
  ],
  toSettings: "Zu den Einstellungen",
  toLogin: "Zur Anmeldung",
};

export const admin = {
  title: "Admin",
  lead: "Nur für Konten mit Administratorrolle. Der Zugriff wird in der Datenbank geprüft.",
  denied: { title: "Kein Zugriff", body: "Dieser Bereich ist Administratoren vorbehalten." },
  tabs: { overview: "Übersicht", activities: "Aktivitäten", reports: "Meldungen", audit: "Protokoll", label: "Bereich" },
  metrics: { users: "Konten", crews: "Crews", polls: "Abstimmungen", plans: "Pläne", activities_total: "Aktivitäten", activities_demo: "davon Demo", open_reports: "Offene Meldungen", reward_points_total: "Vergebene Punkte" },
  activities: {
    active: "Aktiv",
    inactive: "Ausgeblendet",
    deactivate: "Ausblenden",
    activate: "Einblenden",
    verify: "Als geprüft markieren",
    verified: (date: string) => `geprüft am ${date}`,
    unverified: "ungeprüft",
    saved: "Aktivität aktualisiert.",
    demoHint: "Demo-Daten stammen aus supabase/seed.sql. Entfernen: delete from activities where data_source = 'demo'.",
    osmNote: "Orte aus OpenStreetMap stehen nicht in dieser Liste – sie werden bei OpenStreetMap korrigiert und beim nächsten Import übernommen.",
    partnerNote: "Anlegen und Bearbeiten einzelner Orte sowie das Partnerportal sind vorbereitet (Rechte und Tabellen stehen), haben aber noch keine Oberfläche.",
  },
  reports: {
    empty: "Keine Meldungen.",
    resolve: "Erledigt",
    dismiss: "Verwerfen",
    saved: "Meldung aktualisiert.",
    status: { open: "Offen", resolved: "Erledigt", dismissed: "Verworfen" },
    target: (type: string) => `Betrifft: ${type}`,
  },
  audit: { empty: "Noch keine Einträge.", actor: "Auslöser", system: "System" },
  placeSync: {
    title: "Orte-Import aus OpenStreetMap",
    period: (days: number) => `Letzte ${days} Tage`,
    empty: "Noch keine Importe in diesem Zeitraum. Sobald jemand in Discover eine neue Stadt wählt, erscheint sie hier.",
    runs: "Importe",
    failed: "fehlgeschlagen",
    rate: "Fehlerquote",
    fallback: "über Ersatzserver",
    rateValue: (pct: string) => `${pct} %`,
    overThreshold: (threshold: number) =>
      `Mehr als ${threshold} % der Importe sind gescheitert. Laut Entscheidung vom 14.10.2026 ist das der Punkt, an dem ein eigener OSM-Dienst oder ein kommerzieller Anbieter zu prüfen ist.`,
    lastFailure: (when: string) => `Letzter Fehlschlag: ${when}`,
    errorsTitle: "Fehler nach Art",
    endpointsTitle: "Overpass-Server",
    geocodeFallback: "Stadt über Ersatz gefunden",
    stages: (geocode: number, overpass: number) => `Gescheitert bei der Stadtsuche: ${geocode} · bei Overpass: ${overpass}`,
    geocodersTitle: "Stadtsuche",
    geocoderDb: "gespeicherte Stadt",
    endpointLine: (ok: number, attempts: number) => `${ok} von ${attempts} Versuchen erfolgreich`,
    errors: {
      osm_busy: "OSM überlastet",
      osm_unavailable: "OSM nicht erreichbar",
      database_error: "Datenbank",
      internal_error: "Interner Fehler",
      unknown: "Unbekannt",
    } as Record<string, string>,
  },
};

export const assistant = {
  title: "Planungsassistent",
  lead: "Beschreib in einem Satz, was ihr vorhabt – der Assistent schlägt passende Orte vor.",
  disabled: {
    title: "Der Assistent ist noch nicht eingerichtet",
    body: "Die Schnittstelle ist vorbereitet: Die Edge Function „assistant“ liegt im Projekt, braucht aber einen KI-Schlüssel als Server-Secret. Solange der fehlt, bleibt der Assistent aus – er erfindet keine Antworten.",
    how: "Einrichtung: siehe README, Abschnitt „KI-Assistent“.",
    alternative: "Bis dahin findest du Orte über Discover und die Filter dort.",
    toDiscover: "Zu Discover",
  },
  inputLabel: "Deine Anfrage",
  placeholder: "Wir sind sechs und wollen heute Abend etwas für maximal 30 € pro Person machen.",
  examples: ["Etwas Aktives für 5 Leute, höchstens 20 € pro Person", "Zwei Stunden drinnen, ab 14 Jahren", "Bowling und danach essen gehen"],
  submit: "Vorschläge finden",
  thinking: "Der Assistent sucht …",
  understood: "So habe ich dich verstanden",
  missing: "Dazu fehlt mir noch eine Angabe",
  suggestions: "Vorschläge",
  noSuggestions: "Zu dieser Anfrage gibt es in den vorhandenen Daten keinen passenden Ort.",
  why: "Warum",
  caveat: "Preise und Öffnungszeiten stammen aus den hinterlegten Daten und können abweichen. Verfügbarkeit ist nicht geprüft. Der Assistent bucht und bezahlt nichts.",
  addToPoll: "Abstimmung vorbereiten",
  unavailable: "Der Assistent ist gerade nicht erreichbar. Nutze solange Discover.",
};
