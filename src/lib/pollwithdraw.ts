/**
 * P42 · „Vertippt?“ – nachgereichten Vorschlag zurückziehen. Gleiche Regeln wie `remove_poll_option` in der
 * Datenbank, damit „Zurückziehen“ nur dort erscheint, wo es auch klappt. Ohne Laufzeit-Importe (Unit-Test).
 */

type WithdrawPoll = {
  status: string;
  ends_at: string;
  created_by: string | null;
};

type WithdrawOption = { added_by: string | null };

/** Wer zu einem Vorschlag geantwortet hat – Mitglieder und Gäste (wie `OptionTally`: yes, maybe, no). */
type Answers = { yes: string[]; maybe: string[]; no: string[] };

/**
 * Ob `me` den Vorschlag zurückziehen darf: nachgereicht (nicht vom Start), Abstimmung läuft, `me` hat ihn
 * nachgereicht, die Abstimmung gestartet oder ist Owner/Admin (`manager`), und niemand außer der Person, die ihn
 * nachgereicht hat, hat dazu geantwortet – auch kein Gast.
 */
export function canWithdrawOption(
  poll: WithdrawPoll,
  option: WithdrawOption,
  answers: Answers,
  me: string,
  manager: boolean,
  now: Date = new Date(),
): boolean {
  const adder = option.added_by;
  if (!adder) return false;
  if (poll.status !== "open" || new Date(poll.ends_at).getTime() <= now.getTime()) return false;
  if (adder !== me && poll.created_by !== me && !manager) return false;
  return [...answers.yes, ...answers.maybe, ...answers.no].every((id) => id === adder);
}
