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
  // P15: Endspurt ohne auslösende Person – in den letzten drei Stunden, solange die eigene Stimme fehlt.
  poll_reminder: (actor, p) =>
    p.closing
      ? { title: str(p, "ends_at") ? `Endet um ${formatTime(str(p, "ends_at"))} – deine Stimme fehlt` : "Endet bald – deine Stimme fehlt", body: str(p, "title") }
      : { title: `${actor} erinnert dich an eine Abstimmung`, body: str(p, "title") },
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
  // P10 Etappe 2a: Ein Foto wurde gemeldet – an Organisation und Crew-Admins, ohne Namen der meldenden Person.
  plan_photo_reported: (_actor, p) => ({
    title: `Foto bei „${str(p, "title", "eurem Abend")}“ gemeldet`,
    body: p.own
      ? "Es ist dein Foto: Für die Crew ist es ausgeblendet, bis jemand anderes entscheidet. Löschen kannst du es jederzeit."
      : "Für die Crew ausgeblendet, bis du entscheidest: wieder zeigen oder löschen.",
  }),
  // P16: Am Morgen nach dem Abend einmal, ohne auslösende Person – nur „gestern“, wenn es stimmt.
  plan_photo_nudge: (_actor, p) => ({
    title: p.yesterday ? "Fotos von gestern? Teilt sie mit der Crew" : "Fotos vom Abend? Teilt sie mit der Crew",
    body: str(p, "title"),
  }),
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
    lead: "Gilt für dein Konto: auch für Kalender-Abo, Mitteilungen aufs Handy und E-Mails (etwa „Passwort vergessen“), und ein neues Gerät übernimmt sie. Die Seite lädt danach neu. Datum, Uhrzeit und Beträge bleiben in Berliner Zeit und Euro.",
    notTranslated: "Nicht alles wird übersetzt: Orte bekommen eine englische Beschreibung erst, wenn ihre Stadt neu aus OpenStreetMap geladen wurde (frühestens nach 30 Tagen), und Texte deiner Crew bleiben, wie sie geschrieben wurden.",
  },
  preferences: { title: "Vorlieben", saved: "Vorlieben gespeichert." },
  location: {
    title: "Standortfreigabe",
    lead: "Du entscheidest, ob und mit wem du deinen Standort teilst. Standard ist: gar nicht.",
    notLive: {
      title: "Live nur während eines Plans",
      body: "Eine dauerhafte Freigabe ist noch nicht eingebaut – deine Auswahl hier wird nur vorgemerkt. Live teilen kannst du bisher nur rund um einen Plan: auf der Planseite unter „Wo seid ihr?“, ab 2 Stunden vor Beginn, nur auf deinen Tipp und nur mit denen, die auch kommen. Die Freigabe endet nach höchstens 3 Stunden, spätestens mit dem Plan, und wird dann gelöscht.",
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
      reminders: { title: "Erinnerungen", body: "Wenn deine Antwort auf eine Abstimmung noch fehlt – von Hand oder kurz vor dem Ende." },
      answers: { title: "Neue Antworten", body: "Wenn jemand auf deine Abstimmung oder deinen Plan antwortet." },
      results: { title: "Ergebnisse", body: "Wenn eine Abstimmung endet." },
      plans: { title: "Pläne", body: "Neue Pläne, Änderungen an Zeit, Ort oder Kosten und Absagen." },
      dayReminders: { title: "Am Tag des Plans", body: "Morgens einmal „Heute 20:00 Uhr: Bowling“ – außer du hast abgesagt." },
      photoNudges: { title: "Fotos vom Abend", body: "Am Morgen danach einmal, wenn du dabei warst und noch kaum Fotos geteilt sind." },
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
