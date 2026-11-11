/** P43 · „Seid ihr schon da?“ – „Bin da“ oder „Bin in … Min. da“ am Abend selbst. Seitentexte, geladen erst mit der Karte (F7). */
export const planArrival = {
  title: "Seid ihr schon da?",
  lead: "Statt „bin 10 min später“ in den Gruppenchat: ein Tipp, und die Crew sieht es hier – ohne Standort.",
  leadOthers: "Wer schon da ist und wer noch kommt:",
  /** Eigene Ansage in der Einleitung. */
  leadHere: (time: string) => `Die Crew sieht: du bist da seit ${time}.`,
  leadLate: (time: string) => `Die Crew sieht: du kommst gegen ${time}.`,
  here: "Bin da",
  lateLabel: "Bin da in …",
  /** Knopf „in 10 Min.“, „in 1 Std.“. */
  minutes: (n: number) => (n >= 60 && n % 60 === 0 ? `${n / 60} Std.` : `${n} Min.`),
  minutesAria: (n: number) => (n >= 60 && n % 60 === 0 ? `Bin in ${n / 60} Stunde${n === 60 ? "" : "n"} da` : `Bin in ${n} Minuten da`),
  savedHere: "Gesagt – die Crew sieht, dass du da bist.",
  savedLate: (time: string) => `Gesagt – die Crew sieht: gegen ${time}.`,
  undo: "Zurücknehmen",
  removed: "Ansage zurückgenommen.",
  listLabel: "Wer da ist und wer noch kommt",
  /** Eine Person in der Liste, z. B. „Bob · da seit 20:02“. */
  personHere: (name: string, time: string) => `${name} · da seit ${time}`,
  personLate: (name: string, time: string) => `${name} · gegen ${time}`,
  personOverdue: (name: string, time: string) => `${name} · wollte ${time} da sein`,
  none: "Noch hat niemand etwas gesagt.",
  missing: (n: number) => (n === 1 ? "1 Person hat noch nichts gesagt" : `${n} haben noch nichts gesagt`),
  allSaid: "Alle haben Bescheid gegeben.",
  honest: "Nur eine Ansage für die Crew – kein Standort, keine Benachrichtigung. Die Uhrzeit ist, was du sagst.",
  error: "„Seid ihr schon da?“ ließ sich gerade nicht laden.",
  retry: "Nochmal versuchen",
  /** Etappe 2 · Kachel in der „Heute Abend“-Leiste auf Home. */
  home: {
    label: "Schon da?",
    mineHere: (time: string) => `Du bist da seit ${time}.`,
    mineLate: (time: string) => `Du kommst gegen ${time}.`,
    more: (n: number) => (n === 1 ? "1 weitere Ansage auf der Planseite" : `${n} weitere Ansagen auf der Planseite`),
    loading: "„Schon da?“ lädt …",
    error: "„Schon da?“ gerade nicht abrufbar.",
  },
};
