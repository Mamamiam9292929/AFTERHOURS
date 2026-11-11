/** P40 · „Und Sonntag?“ – weiteren Termin in einer laufenden Termin-Abstimmung vorschlagen. Geladen mit der Abstimmung (F7). */
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
  },
};
