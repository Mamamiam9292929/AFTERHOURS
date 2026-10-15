/**
 * P3 · Kosten aufteilen: Wer schuldet wem?
 *
 * Grundlage sind die Anteile, die der Server je Eintrag speichert (gleichmäßig, Rest-Cent verteilt).
 * Jeder Anteil einer anderen Person ist eine Schuld gegenüber der zahlenden Person; eine Rückzahlung
 * ist derselbe Fall andersherum (bezahlt von der Person, die schuldete). So ergeben alle Salden
 * zusammen immer genau 0 – auch wenn jemand sein Konto gelöscht hat und seine Anteile fehlen.
 *
 * Bewusst ohne Importe: Die Datei läuft unverändert im Unit-Test (`node --test`, Typen werden entfernt).
 */

export interface ShareLike {
  user_id: string;
  amount_cents: number;
}

export interface ExpenseLike {
  paid_by: string;
  shares: ShareLike[];
}

export interface Transfer {
  from: string;
  to: string;
  cents: number;
}

/** Saldo je Person in Cent: positiv = bekommt Geld, negativ = gibt Geld. Personen mit 0 fehlen. */
export function balances(expenses: readonly ExpenseLike[]): Map<string, number> {
  const result = new Map<string, number>();
  const add = (id: string, cents: number) => result.set(id, (result.get(id) ?? 0) + cents);
  for (const expense of expenses) {
    for (const share of expense.shares) {
      if (share.user_id === expense.paid_by || share.amount_cents === 0) continue;
      add(expense.paid_by, share.amount_cents);
      add(share.user_id, -share.amount_cents);
    }
  }
  for (const [id, cents] of result) if (cents === 0) result.delete(id);
  return result;
}

/**
 * Möglichst wenige Überweisungen: Wer am meisten schuldet, zahlt an die Person, die am meisten
 * bekommt, bis einer von beiden ausgeglichen ist. Bei gleichen Beträgen entscheidet die ID, damit
 * alle Geräte dieselbe Liste zeigen.
 */
export function settle(expenses: readonly ExpenseLike[]): Transfer[] {
  const entries = [...balances(expenses)];
  const byAmount = (a: [string, number], b: [string, number]) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  const creditors = entries.filter(([, cents]) => cents > 0).sort(byAmount);
  const debtors = entries
    .filter(([, cents]) => cents < 0)
    .map(([id, cents]): [string, number] => [id, -cents])
    .sort(byAmount);

  const transfers: Transfer[] = [];
  let c = 0;
  let d = 0;
  while (c < creditors.length && d < debtors.length) {
    const creditor = creditors[c]!;
    const debtor = debtors[d]!;
    const cents = Math.min(creditor[1], debtor[1]);
    transfers.push({ from: debtor[0], to: creditor[0], cents });
    creditor[1] -= cents;
    debtor[1] -= cents;
    if (creditor[1] === 0) c++;
    if (debtor[1] === 0) d++;
  }
  return transfers;
}

/** Gleichmäßige Aufteilung wie auf dem Server (für die Vorschau im Formular): Rest-Cent an die Ersten. */
export function splitEvenly(cents: number, count: number): number[] {
  if (count <= 0 || cents < 0) return [];
  const base = Math.floor(cents / count);
  const rest = cents % count;
  return Array.from({ length: count }, (_, i) => base + (i < rest ? 1 : 0));
}
