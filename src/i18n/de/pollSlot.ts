/** P40 · „Und Sonntag?“ – weiteren Termin (bzw. Ort, Etappe 2) in einer laufenden Abstimmung vorschlagen. Geladen mit der Abstimmung (F7). */
export const pollSlot = {
  open: "Anderen Termin vorschlagen",
  title: "Welcher Termin noch?",
  lead: "Du bist dort gleich dabei. Wer schon abgestimmt hat, bekommt Bescheid.",
  date: "Tag",
  time: "Uhrzeit",
  submit: "Vorschlagen",
  done: (label: string) => `${label} steht jetzt mit zur Wahl.`,
  full: "10 Termine – mehr passen in eine Abstimmung nicht rein.",
  problems: {
    invalid: "Wähle einen Tag – höchstens ein Jahr im Voraus.",
    past: "Dieser Termin ist schon vorbei.",
    duplicate: "Diesen Termin gibt es schon.",
    full: "Mehr als 10 Termine passen nicht in eine Abstimmung.",
  },},
  /** Etappe 2 · „Und das Kino?“ – weiterer Ort in einer laufenden Orts-Abstimmung. */
  place: {
    open: "Anderen Ort vorschlagen",
    title: "Welcher Ort noch?",
    lead: "Du bist dort gleich dabei. Wer schon abgestimmt hat, bekommt Bescheid.",
    auto: "Die Abstimmung entscheidet sich erst, wenn der neue Ort nicht mehr aufholen kann.",
    search: "Ort suchen",
    change: "Anderen Ort suchen",
    remove: "Ort entfernen",
    or: "oder eigener Vorschlag",
    own: "Eigener Vorschlag",
    ownHint: "Zum Beispiel „Picknick im Park“",
    sameDate: (when: string) => `Gilt wie die anderen Vorschläge für ${when}.`,
    submit: "Vorschlagen",
    done: (title: string) => `${title} steht jetzt mit zur Wahl.`,
    full: "10 Vorschläge – mehr passen in eine Abstimmung nicht rein.",
    problems: {
      invalid: "Such einen Ort aus oder schreib deinen Vorschlag hin.",
      duplicate: "Diesen Vorschlag gibt es schon.",
      full: "Mehr als 10 Vorschläge passen nicht in eine Abstimmung.",
    },
  },
};
