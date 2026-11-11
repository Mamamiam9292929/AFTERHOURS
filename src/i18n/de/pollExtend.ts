/** P39 · „Noch einen Tag?“ – Frist einer laufenden Abstimmung verlängern. Geladen mit der Abstimmung (F7). */
export const pollExtend = {
  title: "Frist verlängern",
  lead: "Alle Stimmen bleiben. Wer noch nicht abgestimmt hat, bekommt Bescheid.",
  presets: { hours2: "+2 Std.", day1: "+1 Tag", days3: "+3 Tage" },
  presetLabel: (preset: string, until: string) => `${preset} – bis ${until}`,
  custom: {
    open: "Bis …",
    label: "Neue Frist",
    hint: (until: string) => `Spätestens ${until}.`,
    submit: "Verlängern",
    cancel: "Abbrechen",
    invalid: "Bitte Tag und Uhrzeit wählen.",
  },
  done: (until: string) => `Verlängert bis ${until}.`,
  tooLate: "Länger geht nicht – spätestens 30 Minuten vor dem ersten Termin endet die Abstimmung.",
  series: "Läuft jede Woche neu – die Frist bleibt, damit die nächsten Runden nicht verrutschen.",
};
