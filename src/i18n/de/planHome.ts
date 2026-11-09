/** P31 · „Gut heimgekommen?“ – nach dem Abend „Bin zuhause“ sagen. Seitentexte, geladen erst mit der Karte (F7). */
export const planHome = {
  title: "Gut heimgekommen?",
  lead: "Ein Tipp, und die Crew weiß Bescheid – ohne Standort und ohne Nachricht an alle.",
  leadDone: (time: string) => `Schön, dass du da bist! Die Crew sieht: zuhause seit ${time}.`,
  leadOthers: "Wer nach dem Abend schon zuhause ist:",
  action: "Bin zuhause",
  saved: "Gemeldet – gute Nacht!",
  undo: "Doch noch nicht zuhause",
  removed: "Meldung zurückgenommen.",
  listLabel: "Schon zuhause",
  /** Eine Person mit Uhrzeit, z. B. „Bob · 01:12“. */
  person: (name: string, time: string) => `${name} · ${time}`,
  none: "Noch hat sich niemand gemeldet.",
  missing: (n: number) => (n === 1 ? "1 Person hat sich noch nicht gemeldet" : `${n} haben sich noch nicht gemeldet`),
  allHome: "Alle sind zuhause.",
  honest: "Nur ein Zeichen für die Crew: Die App merkt nicht, wenn jemand nicht ankommt. Im Notfall 112.",
  error: "„Gut heimgekommen?“ ließ sich gerade nicht laden.",
  home: {
    /** Link zur Planseite, z. B. „Pizzaabend öffnen“. */
    open: (title: string) => `${title} öffnen`,
    hide: "Ausblenden",
    hidden: "Ausgeblendet – auf der Planseite bleibt die Karte.",
  },
  retry: "Nochmal versuchen",
};
