import { formatEuro } from "@/lib/format";
import { formatDateTime, formatTime } from "@/lib/time";
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
    // P3 Etappe 3c: eine Nachricht für mehrere Abende („Alles auf einmal ausgleichen“).
    if (p.bundle) {
      const count = typeof p.plan_count === "number" ? p.plan_count : 0;
      const body = [count > 0 ? `${count} Abende ausgeglichen` : "", str(p, "crew_name")].filter(Boolean).join(" · ");
      if (p.direction === "offset") return { title: `${actor} hat eure offenen Beträge verrechnet – ihr seid quitt`, body };
      return { title: p.direction === "received" ? `${actor} hat bestätigt, dass du ${amount} zurückgegeben hast` : `${actor} hat dir ${amount} auf einmal zurückgegeben`, body };
    }
    return { title: p.direction === "received" ? `${actor} hat deine Rückzahlung von ${amount} bestätigt` : `${actor} hat dir ${amount} zurückgegeben`, body: str(p, "title") };
  },
  // S4 · „Heute noch wer?“
  spontaneous_ask: (actor, p) => ({
    title: `${actor}: Heute noch wer?`,
    body: [str(p, "note"), str(p, "crew_name"), str(p, "expires_at") ? `bis ${formatTime(str(p, "expires_at"))}` : ""].filter(Boolean).join(" · "),
  }),
  spontaneous_answer: (actor, p) => ({ title: `${actor} hat Bock`, body: [str(p, "note"), str(p, "crew_name")].filter(Boolean).join(" · ") }),
  spontaneous_match: (_actor, p) => ({
    title: `Ihr seid ${typeof p.in_count === "number" ? p.in_count : "genug"} – heute geht was!`,
    body: [str(p, "note"), str(p, "crew_name")].filter(Boolean).join(" · "),
  }),
  // P3 Etappe 3b: Eine Woche nach dem Abend ist noch Geld offen – einmal, ohne auslösende Person.
  plan_expense_reminder: (_actor, p) => {
    const balance = typeof p.balance_cents === "number" ? p.balance_cents : 0;
    const title = str(p, "title", "eurem Abend");
    return balance > 0
      ? { title: `Bei „${title}“ bekommst du noch ${formatEuro(balance)}`, body: "Schon zurückbekommen? Dann tippe bei „Kosten teilen“ auf „Erledigt“." }
      : { title: `Bei „${title}“ sind von dir noch ${formatEuro(-balance)} offen`, body: "Schon erledigt? Dann tippe bei „Kosten teilen“ auf „Erledigt“." };
  },
  // P4 Etappe 2: Am Tag des Plans einmal, ohne auslösende Person; die Frage nur, solange die Zusage fehlt.
  plan_day_reminder: (_actor, p) => ({
    title: str(p, "starts_at") ? `Heute ${formatTime(str(p, "starts_at"))}: ${str(p, "title")}` : `Heute: ${str(p, "title")}`,
    body:
      p.attendance === "going"
        ? "Du bist dabei – bis später!"
        : p.attendance === "maybe"
          ? "Du hast „vielleicht“ gesagt – bist du dabei?"
          : "Bist du dabei? Ein Tipp genügt.",
  }),
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
  text: notificationText,
};

export const rewards = {
  title: "Rewards",
  lead: "Punkte gibt es für Unternehmungen, die wirklich stattgefunden haben.",
  points: (n: number) => (n === 1 ? "1 Punkt" : `${n} Punkte`),
  balanceLabel: "Dein Punktestand",
  levels: ["Neu dabei", "Mitmacher", "Stammgast", "Organisationstalent", "Legende"],
  /** V2 Etappe 3o: Stufen als Leiter auf der Punktekarte. */
  levelsLabel: "Stufen",
  levelFrom: (points: number) => (points === 0 ? "ab Start" : `ab ${points}`),
  levelReached: "erreicht",
  levelCurrent: "deine Stufe",
  historyCount: (n: number) => (n === 1 ? "1 Eintrag" : `${n} Einträge`),
  milestonesCount: (done: number, all: number) => `${done} von ${all}`,
  partnersStatus: "Beispiele",
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
    label: "Stammkarte",
    evenings: (n: number): string => (n === 1 ? "Abend erlebt" : "Abende erlebt"),
    since: (monthYear: string) => `Dabei seit ${monthYear}`,
  },
  links: { settings: "Einstellungen", notifications: "Benachrichtigungen", privacy: "Datenschutz und deine Daten", admin: "Admin-Bereich", assistant: "Planungsassistent" },
};

export const settings = {
  title: "Einstellungen",
  back: "Profil",
  jumpLabel: "Bereiche der Einstellungen",
  profile: { title: "Profil", saved: "Profil gespeichert." },
  // P11: Sprache der Oberfläche – gilt für dieses Gerät.
  language: {
    title: "Sprache",
    label: "Sprache der App",
    lead: "Gilt für dein Konto: auch für Kalender-Abo und Mitteilungen aufs Handy, und ein neues Gerät übernimmt sie. Die Seite lädt danach neu. Datum, Uhrzeit und Beträge bleiben in Berliner Zeit und Euro.",
    notTranslated: "Noch deutsch, auch auf Englisch: Link-Vorschauen in Messengern, E-Mails und Termin-Titel, die der Server vergibt.",
  },
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
    statusOff: "Aus",
    statusNoted: "Vorgemerkt",
    whatIsShared: "Was würde geteilt? Deine ungefähre Position, solange die Freigabe läuft – nie deine Adresse, nie dauerhaft.",
  },
  notifications: {
    title: "Benachrichtigungen",
    lead: "Wähle, worüber dich die App informiert.",
    saved: "Benachrichtigungen gespeichert.",
    status: (on: number, all: number) => (on === 0 ? "Alle aus" : on === all ? "Alle an" : `${on} von ${all} an`),
    groups: {
      polls: { title: "Neue Abstimmungen", body: "Wenn jemand in deiner Crew eine Abstimmung startet." },
      reminders: { title: "Erinnerungen", body: "Wenn deine Antwort auf eine Abstimmung noch fehlt." },
      answers: { title: "Neue Antworten", body: "Wenn jemand auf deine Abstimmung oder deinen Plan antwortet." },
      results: { title: "Ergebnisse", body: "Wenn eine Abstimmung endet." },
      plans: { title: "Pläne", body: "Neue Pläne, Änderungen an Zeit, Ort oder Kosten und Absagen." },
      dayReminders: { title: "Am Tag des Plans", body: "Morgens einmal „Heute 20:00 Uhr: Bowling“ – außer du hast abgesagt." },
      bookings: { title: "Reservierungen", body: "Wenn sich der Stand einer Reservierung ändert." },
      rides: { title: "Mitfahrten", body: "Anfragen und Zusagen für Fahrgemeinschaften." },
      costs: { title: "Kosten teilen", body: "Neue Ausgaben, an denen du beteiligt bist, und Rückzahlungen." },
      costReminders: { title: "Erinnerung an offene Beträge", body: "Einmal je Abend, wenn eine Woche danach bei dir noch Geld offen ist." },
      crew: { title: "Crew", body: "Neue Mitglieder und Änderungen deiner Rolle." },
      spontaneous: { title: "Heute noch wer?", body: "Spontane Fragen deiner Crew, Zusagen auf deine Frage und wenn eine Runde zusammen ist." },
      rewards: { title: "Rewards", body: "Wenn du Punkte erhältst." },
    },
  },
  /** P4: Push-Mitteilungen auf diesem Gerät. */
  push: {
    title: "Mitteilungen auf diesem Gerät",
    on: "Kommt aufs Gerät, auch wenn die App zu ist – was genau, wählst du darunter.",
    off: "Bekomm Bescheid, auch wenn die App zu ist – für alles, was du unten eingeschaltet hast.",
    statusOn: "An",
    statusOff: "Aus",
    statusBlocked: "Blockiert",
    statusUnavailable: "Nicht verfügbar",
    enabled: "Push-Mitteilungen sind an.",
    disabled: "Push-Mitteilungen auf diesem Gerät sind aus.",
    unsupported: "Dieser Browser kann keine Push-Mitteilungen empfangen. In Chrome, Edge, Firefox oder Safari (Mac) geht es.",
    iosInstall: "Auf iPhone und iPad gibt es Push-Mitteilungen nur in der installierten App: in Safari auf Teilen tippen, dann „Zum Home-Bildschirm“ – danach hier einschalten.",
    notConfigured: "Push-Mitteilungen sind auf diesem Server noch nicht eingerichtet. Benachrichtigungen erscheinen in der App.",
    blocked: "Mitteilungen sind für AFTERHOURS im Browser blockiert. Erlaube sie in den Website-Einstellungen deines Browsers und schalte sie dann hier ein.",
    privacy: "Der Inhalt jeder Mitteilung ist verschlüsselt – der Push-Dienst deines Browsers (Google, Apple, Mozilla oder Microsoft) sieht nur, dass etwas kommt. Auf dem Sperrbildschirm stehen Titel und Text, wie in der App.",
    otherDevices: (n: number) => (n === 1 ? "Außerdem an auf 1 weiteren Gerät." : `Außerdem an auf ${n} weiteren Geräten.`),
    device: (browser: string, platform: string) => `${browser} auf ${platform}`,
    deviceBrowser: "Browser",
    devicePlatform: "Gerät",
    /** P4 Etappe 3: je Gerät wählen, was als Mitteilung ankommt. */
    pick: {
      title: "Was hier ankommt",
      lead: "Tipp an, was auf diesem Gerät als Mitteilung kommt. In der App siehst du weiter alles.",
      all: "Alles",
      essentials: "Nur das Wichtigste",
      count: (on: number, total: number) => (on === total ? "Alles" : on === 0 ? "Nichts" : `${on} von ${total}`),
      saved: "Für dieses Gerät gespeichert.",
      none: "Auf diesem Gerät kommt gerade keine Mitteilung an – die App zeigt trotzdem alles.",
      offInApp: (n: number) => (n === 1 ? "1 Bereich ist unten für die App ausgeschaltet und kommt deshalb auch hier nicht." : `${n} Bereiche sind unten für die App ausgeschaltet und kommen deshalb auch hier nicht.`),
    },
  },
  /** P2 Etappe 2: persönlicher Abo-Link für Kalender-Apps. */
  calendar: {
    title: "Kalender-Abo",
    lead: "Alle Pläne deiner Crews im Kalender deines Handys – neue Pläne, Änderungen und Absagen kommen von selbst an.",
    statusOn: "Abo läuft",
    statusOff: "Kein Abo",
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
  /** V2 Etappe 3o: Kopf als Karte – Kennzeile, Kurzfassung als Pillen (stehen so auch unten im Text). */
  label: "In einfachen Worten",
  facts: ["Kein Tracking", "Keine Werbung", "Standort aus"],
  jumpLabel: "Springe zu",
  disclaimer: "Diese Seite beschreibt in einfachen Worten, wie die App mit Daten umgeht. Sie ersetzt keine rechtlich geprüfte Datenschutzerklärung – die muss der Betreiber vor dem öffentlichen Start ergänzen.",
  sections: [
    {
      title: "Was gespeichert wird",
      items: [
        "Konto: deine E-Mail-Adresse und ein verschlüsseltes Passwort (bei Supabase Auth).",
        "Profil: Anzeigename, optional Profilbild, Stadt und Interessen.",
        "Aktivität: Crews, Nachrichten im Crew-Chat, Abstimmungen, Stimmen, Pläne, Zusagen, Reservierungsvermerke, Mitfahrten, Punkte und Benachrichtigungen.",
        "Einstellungen: Budget, Entfernung, Benachrichtigungen und deine Wahl zur Standortfreigabe.",
        "Push-Mitteilungen (nur wenn du sie einschaltest): je Gerät die Adresse beim Push-Dienst deines Browsers, zwei öffentliche Schlüssel zum Verschlüsseln und ein Gerätename wie „Chrome auf Android“.",
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
        "Die Karte in Discover zeigt die Orte zunächst nur als Punkte. Den Stadtplan von OpenStreetMap lädt sie erst nach „Stadtplan laden“ (gilt für dieses Gerät, „Stadtplan aus“ nimmt das zurück).",
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
        "Fotos von Orten laden erst, wenn du auf „Foto anzeigen“ tippst oder „Fotos von Orten immer laden“ einschaltest (gilt nur auf diesem Gerät). Dann gehen Anfragen ohne Cookies an Wikimedia Commons und Wikidata – Wikimedia erfährt dabei deine IP-Adresse und welches Foto geladen wird.",
        "Push-Mitteilungen gibt es nur, wenn du sie auf einem Gerät einschaltest. Dann läuft jede Mitteilung über den Push-Dienst deines Browsers (Google, Apple, Mozilla oder Microsoft) – Ende-zu-Ende verschlüsselt; der Dienst sieht nur, dass etwas an dein Gerät geht. Ausschalten oder Abmelden meldet das Gerät ab.",
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
    openCount: (n: number) => (n === 0 ? "Nichts offen" : `${n} offen`),
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
