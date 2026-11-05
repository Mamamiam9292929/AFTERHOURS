/** P25 · „Findet statt ab 4“ – Mindestzahl für einen Plan. Seitentexte, geladen erst mit Anzeige bzw. Einstellung (F7). */
export const planQuorum = {
  meter: {
    title: (min: number) => `Findet statt ab ${min} Zusagen`,
    reached: "Findet statt",
    missing: (n: number) => (n === 1 ? "Noch 1 fehlt" : `Noch ${n} fehlen`),
    count: (going: number, min: number) => `${going} von ${min} sind dabei`,
    progress: (going: number, min: number) => `${going} von mindestens ${min} Zusagen`,
  },
  card: {
    title: "Findet statt ab …",
    intro: "Ab wie vielen Zusagen lohnt sich der Abend? Alle sehen, wie viele noch fehlen – sobald es genug sind, bekommt die Runde Bescheid.",
    label: "Mindestzahl an Zusagen",
    none: "Keine",
    noneLabel: "Keine Mindestzahl",
    option: (n: number) => `Ab ${n} Zusagen`,
    saved: (n: number) => `Findet statt ab ${n} – alle sehen, wie viele noch fehlen.`,
    removed: "Keine Mindestzahl mehr.",
    alreadyReached: "Schon erreicht – der Abend findet statt.",
  },
};
