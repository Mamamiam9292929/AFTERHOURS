/** P28 · „Was draus wurde“ – Ergebnis auf dem Abstimm-Link für Gäste. Seitentexte, geladen erst nach dem Ende (F7). */
export const pollOutcome = {
  kicker: "Ergebnis",
  noWinner: "Kein Vorschlag hat gewonnen – es gab keine Zusage.",
  planKicker: "Daraus wurde ein Plan",
  planCancelled: "Der Plan ist abgesagt.",
  toPlan: "Zum Plan",
  planNoLink: "Den Link zum Plan bekommst du im Gruppenchat.",
  noPlan: "Noch kein Plan – die Crew legt Zeit und Ort fest. Schau später wieder hier vorbei.",
  tie: "Gleichstand – die Crew entscheidet in einer Stichwahl.",
  tieWaiting: "Gleichstand. Wie es weitergeht, entscheidet die Crew.",
  runoffOpen: (when: string) => `Stichwahl läuft bis ${when}`,
  runoffClosed: "Die Stichwahl ist vorbei.",
  toRunoff: "In der Stichwahl abstimmen",
  runoffNoLink: "Den Link zur Stichwahl bekommst du im Gruppenchat.",
  /** P28 Etappe 3: Zusage mit einem Tipp für Gäste, die beim Gewinner „Bin dabei“ gesagt haben. */
  quick: {
    prompt: (winner: string) => `Du warst für „${winner}“. Bist du auch beim Plan dabei?`,
    button: (name: string) => `Bin dabei – als ${name}`,
    privacy: "Die Crew sieht deinen Namen und deine Zusage. Ändern kannst du sie auf der Plan-Karte.",
    going: (name: string) => `Du bist dabei, ${name}.`,
    maybe: (name: string) => `Du hast mit „Vielleicht“ geantwortet, ${name}.`,
    declined: (name: string) => `Du hast abgesagt, ${name}.`,
    full: "Die Runde ist gerade voll. Auf der Plan-Karte kannst du dich zum Nachrücken eintragen.",
  },
};
