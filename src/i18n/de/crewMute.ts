/** P35 · Crew stummschalten. Seitentexte, geladen erst mit den Einstellungen der Crew (F7). */
export const crewMute = {
  title: "Mitteilungen dieser Crew",
  lead: "Zu laut? Stell die Crew leise – du bleibst drin und siehst in der App weiter alles, nur dein Handy meldet sich nicht.",
  status: {
    on: "Laut",
    always: "Stumm",
    /** z. B. „Stumm bis 21:30 Uhr“ oder „Stumm bis Di., 17.11., 13:56 Uhr“. */
    until: (when: string) => `Stumm bis ${when}`,
  },
  choose: "Stummschalten für",
  modes: {
    "8h": "8 Stunden",
    week: "1 Woche",
    always: "Bis ich’s ändere",
  },
  unmute: "Wieder laut",
  saved: {
    "8h": "Für 8 Stunden stumm.",
    week: "Für eine Woche stumm.",
    always: "Stumm, bis du es änderst.",
    off: "Die Crew ist wieder laut.",
  },
  hint: "Gilt für alle deine Geräte. Niemand in der Crew sieht, dass du sie stumm geschaltet hast.",
  error: "Die Einstellung ließ sich gerade nicht laden.",
};
