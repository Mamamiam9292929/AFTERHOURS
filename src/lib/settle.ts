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
  return settleBalances(balances(expenses));
}

/** Wie `settle`, aber aus fertigen Salden (P3 Etappe 3: der Server liefert sie je Plan). */
export function settleBalances(balance: ReadonlyMap<string, number>): Transfer[] {
  const entries = [...balance].filter(([, cents]) => cents !== 0);
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

/**
 * P3 Etappe 2 · Ungleich aufteilen (Vorschau und Prüfung im Formular).
 * `entries` sind die eingetippten Beträge je Person in Cent, `null` für ein leeres Feld. Leere Felder
 * teilen sich, was vom Gesamtbetrag übrig ist, gleichmäßig (Rest-Cent an die Ersten). Jeder Anteil
 * muss mindestens 1 Cent sein, und alle zusammen ergeben genau den Betrag – das prüft auch der Server.
 */
export type CustomSplitStatus = "ok" | "over" | "open" | "nothing_left" | "zero";

export interface CustomSplit {
  status: CustomSplitStatus;
  /** Anteile in der Reihenfolge von `entries`, nur bei `ok`. */
  shares: number[] | null;
  /** Summe der eingetragenen Beträge. */
  entered: number;
  /** Gesamtbetrag minus eingetragen: was noch offen ist (negativ = zu viel). */
  rest: number;
  /** Was die leeren Felder bekommen (gleiche Reihenfolge wie die leeren Felder). */
  fill: number[];
}

export function splitCustom(totalCents: number, entries: readonly (number | null)[]): CustomSplit {
  const entered = entries.reduce<number>((sum, cents) => sum + (cents ?? 0), 0);
  const rest = totalCents - entered;
  const empty = entries.filter((cents) => cents == null).length;
  const fill = empty > 0 && rest >= empty ? splitEvenly(rest, empty) : [];
  const result = (status: CustomSplitStatus, shares: number[] | null = null): CustomSplit => ({ status, shares, entered, rest, fill });

  if (entries.some((cents) => cents != null && cents < 1)) return result("zero");
  if (rest < 0) return result("over");
  if (empty === 0) return rest === 0 ? result("ok", entries.map((cents) => cents ?? 0)) : result("open");
  if (rest < empty) return result("nothing_left");
  let next = 0;
  return result("ok", entries.map((cents) => cents ?? fill[next++] ?? 0));
}

/** Ungleich aufgeteilt? Gleichmäßige Einträge unterscheiden sich höchstens um einen Rest-Cent. */
export function isCustomSplit(shares: readonly ShareLike[]): boolean {
  if (shares.length < 2) return false;
  const amounts = shares.map((share) => share.amount_cents);
  return Math.max(...amounts) - Math.min(...amounts) > 1;
}

/**
 * P3 Etappe 3 · Offene Beträge der ganzen Crew. Der Server liefert Salden je Plan und Person (nur
 * offene). Daraus: je Plan die Salden und „Wer gibt wem?“, dazu der eigene Stand über alle Abende.
 */
export interface BalanceRow {
  plan_id: string;
  user_id: string;
  balance_cents: number;
}

export interface OpenPlan {
  planId: string;
  /** Eigener Saldo bei diesem Plan: positiv = bekommst, negativ = gibst, 0 = nur andere offen. */
  mine: number;
  transfers: Transfer[];
}

export function openPlans(rows: readonly BalanceRow[], userId: string): { plans: OpenPlan[]; total: number } {
  const byPlan = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (row.balance_cents === 0) continue;
    const plan = byPlan.get(row.plan_id) ?? new Map<string, number>();
    plan.set(row.user_id, (plan.get(row.user_id) ?? 0) + row.balance_cents);
    byPlan.set(row.plan_id, plan);
  }
  const plans: OpenPlan[] = [];
  let total = 0;
  for (const [planId, balance] of byPlan) {
    const transfers = settleBalances(balance);
    if (transfers.length === 0) continue;
    const mine = balance.get(userId) ?? 0;
    total += mine;
    plans.push({ planId, mine, transfers });
  }
  return { plans, total };
}
