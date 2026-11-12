const WEEKDAY_NAMES = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

export const plans = {
  title: "Plans",
  lead: "Was ansteht, was noch entschieden wird und was ihr schon erlebt habt.",
  /** Plakat-Überschrift (D0) aus den eigenen Daten; `key` in Lime. */
  poster: {
    upcoming: (n: number) => ({ lead: "", key: n === 1 ? "1 Abend" : `${n} Abende`, tail: " in Sicht" }),
    voting: (n: number) => ({ lead: "", key: n === 1 ? "1 Frage" : `${n} Fragen`, tail: " offen" }),
    none: { lead: "Eure ", key: "Pläne", tail: "" },
  },
  tabs: { upcoming: "Anstehend", voting: "In Abstimmung", past: "Vergangen", label: "Ansicht" },
  newPlan: "Plan erstellen",
  newPoll: "Abstimmung starten",
  empty: {
    upcomingTitle: "Noch nichts geplant",
    upcomingBody: "Starte eine Abstimmung oder leg direkt einen Plan an – deine Crew wird benachrichtigt.",
    votingTitle: "Keine laufende Abstimmung",
    votingBody: "Wenn ihr euch nicht einig seid, lass die Crew abstimmen.",
    pastTitle: "Noch keine vergangenen Pläne",
    pastBody: "Abgeschlossene und abgesagte Pläne erscheinen hier.",
  },
  /** D6: Gruppe der Antwort-Knöpfe unter einem Ticket auf Home. */
  quickAnswer: (title: string) => `Deine Antwort zu „${title}“`,
  ticket: {
    going: (n: number) => (n === 1 ? "1 dabei" : `${n} dabei`),
    goingOf: (total: number) => `von ${total} dabei`,
    yourAnswerOpen: "Deine Antwort fehlt",
    youGoing: "Du bist dabei",
    youMaybe: "Du: vielleicht",
    youDeclined: "Du hast abgesagt",
    /** Stempel im Abriss des großen Tickets, sobald du geantwortet hast. */
    stamp: { going: "Dabei", maybe: "Vielleicht", declined: "Abgesagt" },
    /** P8 Etappe 3: Kennzeichen für Termine eines Stammtischs. */
    series: "Stammtisch",
    /** P25 Etappe 2: Mindestzahl am Ticket (Home, Pläne, Crew). */
    quorum: { missing: (n: number) => (n === 1 ? "Noch 1 fehlt" : `Noch ${n} fehlen`), reached: "Findet statt" },
    /** P26 Etappe 2: Höchstzahl am Ticket (Home, Pläne, Crew); eigener Platz auf der Nachrückliste. */
    capacity: {
      left: (n: number) => (n === 1 ? "Noch 1 Platz" : `Noch ${n} Plätze`),
      full: "Voll – Nachrückliste",
      you: (n: number) => (n === 1 ? "Du rückst als Nächstes nach" : `Du: Nr. ${n} auf der Nachrückliste`),
    },
    countdown: {
      today: "Heute",
      tonight: "Heute Abend",
      tomorrow: "Morgen",
      days: (n: number) => `In ${n} Tagen`,
    },
  },
  create: {
    title: "Plan erstellen",
    lead: "Wenn schon feststeht, was ihr macht: Plan anlegen, die Crew sagt zu.",
    crew: "Für welche Crew?",
    /** V2 Etappe 3m: Abschnitte des Formulars als Glas-Karten. */
    sections: {
      what: "Was & wann",
      where: "Wo",
      money: "Kosten",
      more: "Noch was?",
    },
    whenMissing: "Tag und Uhrzeit fehlen noch.",
    planTitle: "Was macht ihr?",
    planTitlePlaceholder: "z. B. Bowling-Abend",
    date: "Datum",
    time: "Uhrzeit",
    address: "Adresse",
    meetingPoint: "Treffpunkt",
    meetingPointPlaceholder: "z. B. vor dem Eingang",
    cost: "Kosten pro Person",
    costHint: "Schätzung in Euro.",
    totalCost: "Gesamtkosten",
    totalCostHint: "Nur ausfüllen, wenn es einen festen Gesamtpreis gibt (z. B. Bahnmiete).",
    notes: "Notizen",
    notesPlaceholder: "Was sollte die Crew wissen?",
    mode: "Wie fest ist das?",
    modeProposed: "Vorschlag",
    modeProposedHint: "Die Crew sieht den Plan und kann zusagen. Du bestätigst ihn später.",
    modeConfirmed: "Fest eingeplant",
    modeConfirmedHint: "Der Plan gilt sofort als bestätigt.",
    place: "Ort",
    submit: "Plan erstellen",
    created: "Plan erstellt. Die Crew ist benachrichtigt.",
  },
  /** P5: Wettervorhersage für Beginn und Ort des Plans (Open-Meteo). */
  weather: {
    label: "Wetter",
    loading: "Vorhersage wird geladen …",
    kinds: {
      clear: "Klar",
      partly: "Teils bewölkt",
      cloudy: "Bewölkt",
      fog: "Nebel",
      drizzle: "Nieselregen",
      rain: "Regen",
      freezing: "Gefrierender Regen",
      snow: "Schnee",
      showers: "Regenschauer",
      thunder: "Gewitter",
      unknown: "Wetterlage unbekannt",
    },
    at: (hour: number) => `um ${String(hour).padStart(2, "0")} Uhr`,
    rain: (percent: number) => `${percent} % Regenrisiko`,
    rainUnknown: "Regenrisiko unbekannt",
    wind: (kmh: number) => `Wind ${kmh} km/h`,
    tooFar: (date: string) => `Vorhersage ab ${date} – zwei Wochen vor dem Plan.`,
    error: "Wetter gerade nicht abrufbar.",
    retry: "Erneut versuchen",
    /** Quelle: „Vorhersage von <Open-Meteo>, Stand 04:53 Uhr. Kann sich noch ändern.“ – der Name ist der Link. */
    sourceLead: "Vorhersage von",
    sourceLink: "Open-Meteo",
    sourceTail: (time: string) => `, Stand ${time}. Kann sich noch ändern.`,
    hints: {
      rain: "Draußen und Regen möglich – vielleicht einen Plan B überlegen?",
      thunder: "Draußen und Gewitter angesagt – lieber einen Plan B überlegen.",
      snow: "Draußen und Schnee oder Glätte möglich – warm anziehen oder Plan B überlegen.",
      cold: "Draußen und kalt – warm anziehen.",
    },
  },
  /** P2 Etappe 1: Plan als Kalenderdatei (.ics). */
  calendar: {
    add: "In den Kalender",
    done: "Kalenderdatei geladen – öffne sie, um den Termin einzutragen.",
    meetingPoint: (value: string) => `Treffpunkt: ${value}`,
    link: (url: string) => `Plan in AFTERHOURS: ${url}`,
    /** P2 Etappe 2: Hinweis auf das Abo. */
    subscribe: "Alle Pläne automatisch: Kalender-Abo",
  },
  /** P8: wiederkehrende Pläne („Stammtisch“). Wochentage als ISO-Nummer (1 = Montag). */
  repeat: {
    title: "Regelmäßig",
    label: "Wiederholen",
    none: "Nur dieses Mal",
    rule: (rule: "weekly" | "biweekly" | "monthly_nth" | "monthly_last", weekday: number, nth: number | null) => {
      const day = WEEKDAY_NAMES[weekday - 1] ?? "Tag";
      if (rule === "weekly") return `Jeden ${day}`;
      if (rule === "biweekly") return `Jeden zweiten ${day}`;
      if (rule === "monthly_nth") return `Jeden ${nth ?? 1}. ${day} im Monat`;
      return `Jeden letzten ${day} im Monat`;
    },
    save: "Speichern",
    saved: "Wiederholung gespeichert.",
    stopped: "Der Plan wiederholt sich nicht mehr.",
    next: (date: string) => `Eine Woche vorher steht der nächste Termin am ${date} von selbst in der App – mit Titel, Ort und Uhrzeit von diesem.`,
    hasNext: "Der nächste Termin steht schon:",
    intro: "Für Stammtische: Eine Woche vor dem nächsten Termin legt die App ihn an – alle werden gefragt, ob sie dabei sind.",
    /** P8 Etappe 2: einen Termin aussetzen, ohne die Serie zu beenden. */
    skip: "Diesmal aussetzen",
    skipHint: "Fällt nur dieser Abend aus? Die Serie läuft weiter.",
    skipTitle: "Diesmal aussetzen?",
    skipBody: (date: string) => `Der Abend am ${date} fällt aus, alle werden benachrichtigt. Der Stammtisch geht weiter – der nächste Termin steht sofort in der App.`,
    skipped: "Ausgesetzt – der nächste Termin steht schon.",
    skippedNote: "Dieser Termin wurde ausgesetzt. Der Stammtisch geht weiter.",
    skippedNext: "Nächster Termin:",
    badge: "Ausgesetzt",
    stoppedNote: "Diese Serie ist beendet – es kommen keine neuen Termine dazu.",
  },
  detail: {
    back: "Plans",
    what: "Was machen wir?",
    when: "Wann?",
    where: "Wo?",
    meetingPoint: "Treffpunkt",
    who: "Wer kommt mit?",
    cost: "Was kostet es?",
    booking: "Reservierung",
    rides: "Wie kommen alle hin?",
    notes: "Notizen",
    organizer: (name: string) => `Organisiert von ${name}`,
    organizerYou: "Von dir organisiert",
    fromPoll: "Ergebnis der Abstimmung",
    showPlace: "Ort ansehen",
    // P41 · „Wie komm ich hin?“ – Route in der Karten-App
    route: {
      open: "Wie komm ich hin?",
      label: "Route öffnen in",
      apps: { device: "Karten-App", apple: "Apple Karten", google: "Google Maps", osm: "OpenStreetMap" },
      hint: "Erst beim Antippen geht der Ort an den Anbieter.",
    },
    noAddress: "Noch kein Ort festgelegt",
    noMeetingPoint: "Noch kein Treffpunkt festgelegt",
    startsIn: (relative: string) => `Beginnt ${relative}`,
    started: (relative: string) => `Begonnen ${relative}`,
    costPerPerson: (v: string) => `${v} pro Person`,
    costTotal: (v: string, n: number) => `${v} gesamt bei ${n === 1 ? "1 Zusage" : `${n} Zusagen`}`,
    costTotalFixed: (v: string) => `${v} gesamt`,
    costUnknown: "Noch keine Kostenschätzung",
    costEstimate: "Schätzung, unverbindlich.",
    attendance: {
      question: "Bist du dabei?",
      going: "Bin dabei",
      maybe: "Vielleicht",
      declined: "Kann nicht",
      saved: "Antwort gespeichert.",
      locked: "Antworten lassen sich nicht mehr ändern.",
      groups: { going: "Dabei", maybe: "Vielleicht", invited: "Noch offen", declined: "Abgesagt" },
      // W10: Zusage ohne Konto über den Teilen-Link.
      guest: (name: string) => `${name} (Gast)`,
      guestsTitle: "Freunde ohne Konto",
      // P19: Nachfragen bei allen ohne Antwort.
      remind: "Nachfragen",
      remindLabel: (n: number) => (n === 1 ? "Nachfragen – die Person ohne Antwort fragen, ob sie dabei ist" : `Nachfragen – alle ${n} ohne Antwort fragen, ob sie dabei sind`),
      reminded: (n: number) => (n === 0 ? "Alle haben schon geantwortet – niemand wurde gefragt." : n === 1 ? "1 Person gefragt." : `${n} Personen gefragt.`),
      // P45: Alle mit „Vielleicht“ fragen, ob sie jetzt dabei sind.
      remindMaybeLabel: (n: number) =>
        n === 1 ? "Nachfragen – die Person mit „Vielleicht“ fragen, ob sie jetzt dabei ist" : `Nachfragen – alle ${n} mit „Vielleicht“ fragen, ob sie jetzt dabei sind`,
      remindedMaybe: (n: number) => (n === 0 ? "Niemand steht mehr bei „Vielleicht“ – niemand wurde gefragt." : n === 1 ? "1 Person gefragt." : `${n} Personen gefragt.`),
      // P23: Der Plan wurde verschoben, die alte Antwort gilt nicht mehr.
      askedAgain: (previous: string) => `Neue Zeit – passt es dir noch? Vorher: ${previous}`,
      // P26: Runde voll – statt „Bin dabei“ auf die Nachrückliste.
      waitlist: "Nachrücken",
      waitlistLabel: "Auf die Nachrückliste – sagt jemand ab, bist du automatisch dabei",
      waitlistJoined: (n: number) => (n === 1 ? "Du bist als Nächstes dran." : `Du bist Nr. ${n} auf der Nachrückliste.`),
      // P24: Zusatz zur eigenen Antwort.
      note: {
        add: "Zusatz für die Crew",
        label: "Zusatz zu deiner Antwort",
        placeholder: "z. B. komme erst um 21 Uhr",
        hint: "Sieht nur die Crew. Ändert sich deine Antwort, ist der Zusatz weg.",
        save: "Speichern",
        cancel: "Abbrechen",
        edit: "Zusatz ändern",
        remove: "Zusatz entfernen",
        saved: "Zusatz gespeichert.",
        removed: "Zusatz entfernt.",
        presets: {
          going: ["Komme später", "Muss früher los", "Nur auf einen Drink"],
          maybe: ["Sag bis mittags Bescheid", "Hängt vom Wetter ab", "Komme evtl. später"],
          declined: ["Nächstes Mal!", "Schade, viel Spaß!"],
        },
        mine: (note: string) => `Dein Zusatz: „${note}“`,
        quoted: (note: string) => `„${note}“`,
      },
    },
    manage: {
      title: "Organisieren",
      edit: "Plan bearbeiten",
      editTitle: "Plan bearbeiten",
      editBody: "Ändern sich Zeit, Ort, Treffpunkt oder Kosten, wird die Crew benachrichtigt.",
      saved: "Plan aktualisiert.",
      // P23: Neue Uhrzeit – alle neu fragen.
      askAgain: "Alle neu fragen",
      askAgainBody: (n: number, guests: number) =>
        `${n === 1 ? "1 Antwort gilt" : `${n} Antworten gelten`} für die alte Zeit. Ist das an, steht bei allen wieder „Noch offen“ und sie werden gefragt, ob es noch passt.` +
        (guests > 0 ? ` ${guests === 1 ? "Die Antwort des Gasts" : `Die ${guests} Antworten der Gäste`} ohne Konto ${guests === 1 ? "wird" : "werden"} gelöscht – über den Link sagen sie neu zu.` : ""),
      askedAgain: (n: number) => (n === 0 ? "Plan aktualisiert – es gab keine Antworten zurückzusetzen." : n === 1 ? "Plan aktualisiert – 1 Person wird neu gefragt." : `Plan aktualisiert – ${n} werden neu gefragt.`),
      confirm: "Plan bestätigen",
      confirmed: "Plan bestätigt.",
      complete: "Als abgeschlossen markieren",
      completeTitle: "Plan abschließen?",
      completeBody: "Danach lässt sich der Plan nicht mehr ändern. Wer zugesagt hat, erhält Punkte – sofern mindestens zwei Personen dabei waren.",
      completed: "Plan abgeschlossen.",
      completeTooEarly: "Abschließen geht erst, wenn der Plan begonnen hat.",
      cancel: "Plan absagen",
      cancelTitle: "Plan absagen?",
      cancelBody: "Alle Teilnehmenden werden benachrichtigt. Das lässt sich nicht rückgängig machen.",
      cancelled: "Plan abgesagt.",
    },
    statusNote: {
      proposed: "Dieser Plan ist ein Vorschlag und noch nicht bestätigt.",
      cancelled: "Dieser Plan wurde abgesagt.",
      completed: "Dieser Plan ist abgeschlossen.",
    },
    again: {
      title: "Nochmal?",
      leadPlace: (place: string) => `War gut bei ${place}? Ein Tipp, und die Crew sucht den nächsten Termin dort.`,
      lead: "War ein guter Abend? Ein Tipp, und die Crew sucht den nächsten Termin.",
      went: (n: number) => (n === 1 ? "1 war dabei" : `${n} waren dabei`),
      findDatePlace: "Nochmal hier – Termin finden",
      findDate: "Termin für nochmal finden",
    },
    /** P32: „Neuer Anlauf?“ auf abgesagten Plänen. */
    retry: {
      title: "Neuer Anlauf?",
      leadPlace: (place: string) => `Abgesagt heißt nicht abgeblasen. Ein Tipp, und die Crew sucht einen neuen Termin bei ${place}.`,
      lead: "Abgesagt heißt nicht abgeblasen. Ein Tipp, und die Crew sucht einen neuen Termin.",
      findDate: "Neuen Termin finden",
    },
    followUp: {
      title: "Was kommt als Nächstes?",
      body: "Ideen für eure nächste Unternehmung.",
      startPoll: "Nächste Abstimmung starten",
    },
    notFoundTitle: "Diesen Plan gibt es nicht",
    notFoundBody: "Er wurde gelöscht oder du bist nicht mehr in der Crew.",
  },
  /** W2 · Geteilter Plan (/s/<token>): Karte für Freunde ohne Konto bzw. außerhalb der Crew. */
  shared: {
    pageTitle: (title: string) => `${title} – geteilter Plan`,
    kicker: "Ein Abend mit AFTERHOURS",
    going: (n: number, over: boolean): string =>
      over ? (n === 0 ? "Keine Zusage" : n === 1 ? "war dabei" : "waren dabei") : n === 0 ? "Noch keine Zusage" : n === 1 ? "ist dabei" : "sind dabei",
    /** P25 Etappe 2: Mindestzahl auf der geteilten Karte. */
    quorumAsk: (n: number) => (n === 1 ? "Noch 1 fehlt – bist du dabei?" : `Noch ${n} fehlen – bist du dabei?`),
    /** P26 Etappe 2: Höchstzahl auf der geteilten Karte. */
    capacityLeft: (n: number) => (n === 1 ? "Noch 1 Platz frei" : `Noch ${n} Plätze frei`),
    capacityFull: "Voll – wer absagt, macht Platz",
    guestTitle: "Bist du dabei?",
    guestIntro: "Deine Freunde planen diesen Abend mit AFTERHOURS. Zusagen kannst du, sobald du in ihrer Crew bist – frag im Gruppenchat nach dem Einladungslink.",
    register: "Konto erstellen",
    hasAccount: "Schon ein Konto?",
    toLogin: "Anmelden",
    outsiderTitle: "Noch nicht in der Crew",
    outsiderIntro: "Dieser Plan gehört zu einer Crew, in der du noch nicht bist. Frag nach dem Einladungslink – danach siehst du alles und kannst zusagen.",
    toHome: "Zu deiner Übersicht",
    privacy: "Der Link zeigt nur Titel, Zeit und wie viele dabei sind. Wer dabei ist und wo es hingeht, sieht nur die Crew.",
    status: {
      not_found: { title: "Plan nicht gefunden", body: "Der Link ist unvollständig oder falsch. Frag im Gruppenchat nach einem neuen." },
      expired: { title: "Dieser Abend ist vorbei", body: "Geteilte Pläne sind bis drei Tage nach dem Abend zu sehen." },
    },
    toStart: "Zu AFTERHOURS",
  },
};
