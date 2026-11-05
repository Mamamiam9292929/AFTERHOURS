/** P26 · „Nur 6 Plätze“ – Höchstzahl mit Nachrückliste. Seitentexte, geladen erst mit Anzeige bzw. Einstellung (F7). */
export const planCapacity = {
  meter: {
    title: (max: number) => `Höchstens ${max} Plätze`,
    full: "Voll",
    left: (n: number) => (n === 1 ? "Noch 1 Platz" : `Noch ${n} Plätze`),
    count: (going: number, max: number) => `${going} von ${max} Plätzen vergeben`,
    progress: (going: number, max: number) => `${going} von höchstens ${max} Plätzen vergeben`,
    waitlistTitle: (n: number) => `Nachrückliste (${n})`,
    waitlistHint: "Sagt jemand ab, rückt die erste Person von selbst nach.",
  },
  mine: {
    position: (n: number) => (n === 1 ? "Du bist als Nächstes dran" : `Du bist Nr. ${n} auf der Nachrückliste`),
    positionBody: "Wird ein Platz frei, bist du automatisch dabei und bekommst Bescheid.",
    full: (max: number) => `Alle ${max} Plätze sind vergeben.`,
    fullBody: "Tipp auf „Nachrücken“ – sagt jemand ab, bist du automatisch dabei.",
    leave: "Von der Liste",
    left: "Du stehst nicht mehr auf der Nachrückliste.",
  },
  card: {
    title: "Höchstens …",
    intro: "Wie viele passen rein – ein Tisch, eine Bahn, ein Auto? Ist es voll, kommen weitere Zusagen auf die Nachrückliste und rücken von selbst nach.",
    label: "Höchstzahl an Zusagen",
    none: "Offen",
    noneLabel: "Keine Höchstzahl",
    option: (n: number) => `Höchstens ${n} Zusagen`,
    saved: (n: number) => `Höchstens ${n} – ist es voll, geht es auf die Nachrückliste.`,
    removed: "Keine Höchstzahl mehr – alle auf der Liste sind jetzt dabei.",
    floor: "Weniger geht nicht: So viele haben schon zugesagt (oder so hoch ist die Mindestzahl).",
  },
};
