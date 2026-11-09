/** P29 · „Wie war’s?“ – Urteil nach dem Abend. Seitentexte, geladen erst mit der Karte auf einem abgeschlossenen Plan (F7). */
export const planFeedback = {
  title: "Wie war’s?",
  lead: "Ein Tipp für die Crew – sie sieht nur die Zahlen, nicht wer was gesagt hat.",
  leadDone: "Danke! Die Crew sieht nur die Zahlen.",
  leadOthers: "Das sagen die, die dabei waren.",
  leadClosed: "So fanden es die, die dabei waren.",
  label: "Wie war der Abend?",
  again: "Nochmal!",
  ok: "War okay",
  meh: "Eher nicht",
  saved: {
    again: "Notiert – das klingt nach Nochmal.",
    ok: "Notiert.",
    meh: "Notiert – nächstes Mal wird’s besser.",
  },
  removed: "Antwort zurückgezogen.",
  undo: "Antwort zurückziehen",
  tally: {
    again: (n: number) => `${n} × Nochmal`,
    ok: (n: number) => `${n} × okay`,
    meh: (n: number) => `${n} × eher nicht`,
  },
  tallyLabel: "Was die Crew sagt",
  none: "Noch hat niemand geantwortet.",
  closedNote: "Antworten ging bis 30 Tage nach dem Abend.",
  error: "„Wie war’s?“ ließ sich gerade nicht laden.",
  retry: "Nochmal versuchen",
  /** P29 Etappe 2 · auf „Nochmal?“, wenn der Abend ein Lieblingsabend ist (mind. 2 „Nochmal!“, mehr als die Hälfte). */
  againPill: (n: number) => `${n} wollen nochmal`,
  /** P29 Etappe 2 · „Eure Lieblingsabende“ im Crew-Rückblick. */
  favorites: {
    title: "Eure Lieblingsabende",
    count: (n: number) => `${n} × Nochmal`,
    open: (title: string, date: string, n: number) => `${title}, ${date} – ${n} × Nochmal. Zum Abend`,
    empty: "Sagen nach einem Abend die meisten „Nochmal!“, steht er hier.",
    loading: "Lieblingsabende werden geladen",
    failed: "Die Lieblingsabende ließen sich gerade nicht laden.",
  },
  /** P30 · „Fand der Abend statt?“ – oben auf der Planseite für Organisator:in, Owner und Admins, sobald der Abend vorbei ist. */
  close: {
    title: "Fand der Abend statt?",
    lead: "Ein Tipp – dann fragt AFTERHOURS alle, die dabei waren, wie’s war, und der Abend landet im Rückblick.",
    happened: "Ja, abschließen",
    skipped: "Hat nicht stattgefunden",
    done: "Abgeschlossen – die Crew wird gefragt, wie’s war.",
    skipTitle: "Hat nicht stattgefunden?",
    skipBody: "Der Plan wird abgesagt, ohne Nachricht an alle – der Abend ist ja vorbei. Das lässt sich nicht rückgängig machen.",
    skipConfirm: "Ja, absagen",
    skippedDone: "Plan abgesagt – ohne Nachricht an die Crew.",
  },
};
