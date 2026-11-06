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
};
