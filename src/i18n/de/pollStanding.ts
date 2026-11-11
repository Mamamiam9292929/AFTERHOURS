/** P38 · „Zwischenstand“ der Abstimmung für den Gruppenchat – nur Zahlen, keine Namen. Geladen mit der Abstimmung (F7). */
export const pollStanding = {
  button: "Zwischenstand teilen",
  hint: "Nur Zahlen, keine Namen – mit Link zum Abstimmen.",
  option: (label: string, yes: number) => `${label}: ${yes === 0 ? "noch niemand dabei" : `${yes} dabei`}`,
  more: (n: number, date: boolean) =>
    date ? (n === 1 ? "und 1 weiterer Termin" : `und ${n} weitere Termine`) : n === 1 ? "und 1 weiterer Vorschlag" : `und ${n} weitere Vorschläge`,
  noVotes: "noch keine Stimmen",
  open: (n: number) => (n === 1 ? "1 hat noch nicht abgestimmt." : `${n} haben noch nicht abgestimmt.`),
  allVoted: "Aus der Crew haben alle abgestimmt.",
  until: (when: string) => `Läuft bis ${when}.`,
  vote: "Stimm mit einem Tipp ab:",
  link: "Zur Abstimmung:",
};
