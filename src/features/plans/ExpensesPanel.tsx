import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { IconCheck, IconForward, IconPlus, IconTrash } from "@/components/icons";
import { Avatar, type Person } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { Chip, SwitchRow } from "@/components/ui/Controls";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { ErrorState, Notice, Skeleton } from "@/components/ui/Feedback";
import { controlClass, FormMessage, SelectField, TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { centsToInput, formatEuro, parseEuroInput } from "@/lib/format";
import { balances, isCustomSplit, settle, splitCustom, splitEvenly, type Transfer } from "@/lib/settle";
import { formatDateTime } from "@/lib/time";
import { PANEL_ITEM } from "./PlanPanel";
import { useAddExpense, useDeleteExpense, usePlanExpenses, useRecordSettlement, type AddExpenseInput, type PlanExpenseWithShares, type PlanWithParticipants } from "./api";

const tx = t.plans.expenses;

interface ExpensesPanelProps {
  plan: PlanWithParticipants;
  userId: string;
  /** Aktuelle Mitglieder der Crew (zahlen und beteiligt sein können nur sie). */
  memberIds: string[];
  /** Owner/Admin der Crew – darf jeden Eintrag löschen (wie der Server). */
  canManageCrew: boolean;
  lookup: (id: string | null | undefined) => Person | null;
}

/** P3 · Kosten aufteilen: Einträge, Stand, „Wer gibt wem?“ mit „Erledigt“. Bezahlt wird außerhalb der App. */
export function ExpensesPanel({ plan, userId, memberIds, canManageCrew, lookup }: ExpensesPanelProps) {
  const toast = useToast();
  const expenses = usePlanExpenses(plan.id);
  const add = useAddExpense(plan.id);
  const record = useRecordSettlement(plan.id);
  const remove = useDeleteExpense(plan.id);
  const [open, setOpen] = useState(false);
  const [settling, setSettling] = useState<Transfer | null>(null);
  const [deleting, setDeleting] = useState<PlanExpenseWithShares | null>(null);

  const name = (id: string) => (id === userId ? tx.you : (lookup(id)?.display_name ?? t.states.formerMember));
  const summary = useMemo(() => {
    const list = expenses.data ?? [];
    const real = list.filter((e) => e.kind === "expense");
    return {
      total: real.reduce((sum, e) => sum + e.amount_cents, 0),
      mine: real.reduce((sum, e) => sum + (e.shares.find((s) => s.user_id === userId)?.amount_cents ?? 0), 0),
      balance: balances(list).get(userId) ?? 0,
      transfers: settle(list),
    };
  }, [expenses.data, userId]);

  // P3 Etappe 3: Von „Offene Beträge“ der Crew kommt man mit #kosten – nach dem Laden dorthin springen.
  const loaded = expenses.isSuccess;
  useEffect(() => {
    if (loaded && window.location.hash === "#kosten") document.getElementById("kosten")?.scrollIntoView({ block: "start" });
  }, [loaded]);

  if (expenses.isPending) return <Skeleton className="h-28" />;
  if (expenses.isError) return <ErrorState error={expenses.error} onRetry={() => void expenses.refetch()} />;

  const list = expenses.data;
  const transferText = (transfer: Transfer) =>
    transfer.from === userId ? tx.youPay(name(transfer.to)) : transfer.to === userId ? tx.paysYou(name(transfer.from)) : tx.pays(name(transfer.from), name(transfer.to));
  const canDelete = (e: PlanExpenseWithShares) =>
    canManageCrew || e.created_by === userId || e.paid_by === userId || (e.kind === "settlement" && e.shares.some((s) => s.user_id === userId));

  return (
    <div className="space-y-4">
      {list.length === 0 ? (
        <p className="max-w-prose text-[15px] text-muted">{tx.intro}</p>
      ) : (
        <>
          {/* Stand auf einen Blick: Zahlen in Display-Schrift, der eigene Saldo in Lime bzw. Gelb.
              V2 Etappe 3g: die Karte trägt den Schein deines Saldos – Lime, wenn du bekommst, Gelb, wenn du gibst. */}
          <div
            data-testid="expense-balance"
            data-balance={summary.balance > 0 ? "gets" : summary.balance < 0 ? "owes" : "even"}
            className={cn(
              PANEL_ITEM,
              "p-4 sm:p-5",
              summary.balance > 0 && "border-lime/50 bg-lime/[0.04]",
              summary.balance < 0 && "border-amber/50",
            )}
          >
            <dl className="grid grid-cols-3 gap-3">
              <Stat label={tx.total} value={formatEuro(summary.total)} />
              <Stat label={tx.yourShare} value={formatEuro(summary.mine)} />
              <Stat
                label={tx.balance}
                value={`${summary.balance > 0 ? "+" : summary.balance < 0 ? "−" : "±"}${formatEuro(Math.abs(summary.balance))}`}
                tone={summary.balance > 0 ? "lime" : summary.balance < 0 ? "amber" : undefined}
              />
            </dl>
            <p className="mt-3 border-t border-white/10 pt-3 text-sm font-semibold text-fg">
              {summary.balance > 0 ? tx.balanceGets(formatEuro(summary.balance)) : summary.balance < 0 ? tx.balanceOwes(formatEuro(-summary.balance)) : tx.balanceEven}
            </p>
          </div>

          <div>
            <h3 className="mb-2 text-[15px] font-bold text-fg">{tx.whoPaysWhom}</h3>
            {summary.transfers.length === 0 ? (
              <Notice tone="lime" icon={<IconCheck aria-hidden />}>
                {tx.allSettled}
              </Notice>
            ) : (
              <ul className={cn(PANEL_ITEM, "divide-y divide-line overflow-hidden")}>
                {summary.transfers.map((transfer) => {
                  const text = transferText(transfer);
                  const amount = formatEuro(transfer.cents);
                  const involved = transfer.from === userId || transfer.to === userId;
                  return (
                    <li key={`${transfer.from}-${transfer.to}`} className={cn("flex items-center gap-2 px-3 py-3 sm:gap-3 sm:px-5", involved && "bg-lime/[0.04]")}>
                      <span className="flex shrink-0 items-center gap-1" aria-hidden>
                        <Avatar person={lookup(transfer.from)} size="sm" decorative />
                        <IconForward className="size-3.5 text-faint" />
                        <Avatar person={lookup(transfer.to)} size="sm" decorative />
                      </span>
                      <span className="min-w-0 flex-1 text-[15px] font-semibold text-fg">{text}</span>
                      <span className="display shrink-0 text-[16px] leading-none text-fg">{amount}</span>
                      {involved && (
                        <Button size="sm" variant="secondary" aria-label={tx.markSettledLabel(text, amount)} onClick={() => setSettling(transfer)}>
                          {tx.markSettled}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-2 text-[13px] leading-snug text-faint">{tx.simplified}</p>
          </div>

          <div>
            <h3 className="mb-2 text-[15px] font-bold text-fg">{tx.entries}</h3>
            <ul className="space-y-2">
              {list.map((e) => {
                const amount = formatEuro(e.amount_cents);
                const myShare = e.kind === "expense" ? e.shares.find((s) => s.user_id === userId)?.amount_cents : undefined;
                // „für dich, Alice und Carol“ – ich zuerst.
                const people = e.shares.map((s) => s.user_id).sort((a, b) => Number(b === userId) - Number(a === userId) || name(a).localeCompare(name(b), "de"));
                const title = e.kind === "expense" ? (e.description ?? "") : tx.settlementTitle;
                // Ungleich aufgeteilt (P3 Etappe 2): Betrag je Person in Klammern – „für dich (12 €) und Bob (18 €)“.
                const custom = e.kind === "expense" && isCustomSplit(e.shares);
                const shareOf = (id: string) => formatEuro(e.shares.find((s) => s.user_id === id)?.amount_cents ?? 0);
                const label = (id: string) => (id === userId ? tx.youAccusative : name(id));
                const split =
                  people.length > 4
                    ? custom
                      ? tx.entrySplitCustom(people.length)
                      : tx.entrySplit(people.length)
                    : tx.entrySplitNames(listNames(people.map((id) => (custom ? tx.nameWithAmount(label(id), shareOf(id)) : label(id)))));
                const detail =
                  e.kind === "expense"
                    ? `${tx.entryPaid(name(e.paid_by), amount)} · ${split}`
                    : tx.settlementEntry(name(e.paid_by), people[0] === userId ? tx.youDative : name(people[0] ?? ""), amount);
                return (
                  <li key={e.id} className={cn(PANEL_ITEM, "flex items-start gap-3 px-4 py-3", e.kind === "settlement" && "border-dashed")}>
                    <Avatar person={lookup(e.paid_by)} size="sm" decorative />
                    <div className="min-w-0 flex-1">
                      <p className={cn("font-semibold", e.kind === "expense" ? "text-fg" : "text-muted")}>{title}</p>
                      <p className="mt-0.5 text-sm text-muted">{detail}</p>
                      {myShare != null && <p className="mt-1 text-sm font-semibold text-fg">{tx.yourShareValue(formatEuro(myShare))}</p>}
                      <p className="mt-0.5 text-[13px] text-faint">{formatDateTime(e.created_at)}</p>
                    </div>
                    <p className="display shrink-0 pt-0.5 text-[16px] leading-none text-fg">{amount}</p>
                    {canDelete(e) && (
                      <IconButton label={tx.delete(title)} className="-my-1 -mr-2 size-10 text-muted" onClick={() => setDeleting(e)}>
                        <IconTrash className="size-4" aria-hidden />
                      </IconButton>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}

      <Button variant="secondary" onClick={() => setOpen(true)} icon={<IconPlus className="size-4" aria-hidden />}>
        {tx.add}
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} title={tx.addTitle} description={tx.addBody} size="sm">
        {open && (
          <ExpenseForm
            plan={plan}
            userId={userId}
            memberIds={memberIds}
            name={name}
            pending={add.isPending}
            onSubmit={(values, fail) =>
              add.mutate(values, {
                onSuccess: () => {
                  setOpen(false);
                  toast.success(tx.added);
                },
                onError: (error) => fail(errorMessage(error)),
              })
            }
          />
        )}
      </Dialog>

      <ConfirmDialog
        open={settling != null}
        onClose={() => setSettling(null)}
        title={tx.settleTitle}
        description={settling ? tx.settleBody(transferText(settling), formatEuro(settling.cents)) : ""}
        confirmLabel={tx.markSettled}
        loading={record.isPending}
        error={record.isError ? errorMessage(record.error) : null}
        onConfirm={() =>
          settling &&
          record.mutate(settling, {
            onSuccess: () => {
              setSettling(null);
              toast.success(tx.settled);
            },
          })
        }
      />
      <ConfirmDialog
        open={deleting != null}
        onClose={() => setDeleting(null)}
        title={tx.deleteTitle}
        description={tx.deleteBody}
        confirmLabel={tx.deleteConfirm}
        destructive
        loading={remove.isPending}
        error={remove.isError ? errorMessage(remove.error) : null}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              setDeleting(null);
              toast.success(tx.deleted);
            },
          })
        }
      />
    </div>
  );
}

/** „Alice“, „Alice und Bob“, „dich, Alice und Carol“ */
function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} ${tx.and} ${names[names.length - 1]}`;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "lime" | "amber" }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] font-medium text-muted">{label}</dt>
      <dd className={cn("display mt-1 truncate text-[19px] leading-none sm:text-[23px]", tone === "lime" ? "text-lime" : tone === "amber" ? "text-amber" : "text-fg")}>{value}</dd>
    </div>
  );
}

interface ExpenseFormProps {
  plan: PlanWithParticipants;
  userId: string;
  memberIds: string[];
  name: (id: string) => string;
  pending: boolean;
  onSubmit: (values: AddExpenseInput, fail: (message: string) => void) => void;
}

function ExpenseForm({ plan, userId, memberIds, name, pending, onSubmit }: ExpenseFormProps) {
  // Ich zuerst, dann die übrigen Mitglieder in der Reihenfolge der Crew.
  const members = useMemo(() => [userId, ...memberIds.filter((id) => id !== userId)], [memberIds, userId]);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState(userId);
  // Vorauswahl: wer zugesagt hat, plus wer bezahlt. Ohne Zusagen: alle Mitglieder.
  const [split, setSplit] = useState<Set<string>>(() => {
    const going = plan.participants.filter((p) => p.attendance_status === "going" && memberIds.includes(p.user_id)).map((p) => p.user_id);
    return new Set(going.length > 0 ? [...going, userId] : members);
  });
  const [error, setError] = useState<string | null>(null);
  // P3 Etappe 2: Beträge je Person. Eingaben bleiben erhalten, wenn jemand ab- und wieder angewählt wird.
  const [custom, setCustom] = useState(false);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const groupId = useId();

  const cents = parseEuroInput(amount);
  const total = typeof cents === "number" && cents > 0 ? cents : null;
  const selected = members.filter((id) => split.has(id));
  const shares = total != null ? splitEvenly(total, split.size) : [];
  const preview =
    shares.length === 0
      ? null
      : shares[0] === shares[shares.length - 1]
        ? tx.perPerson(formatEuro(shares[0] ?? 0), shares.length)
        : tx.perPersonRange(formatEuro(shares[shares.length - 1] ?? 0), formatEuro(shares[0] ?? 0), shares.length);

  const entries = selected.map((id) => parseEuroInput(amounts[id] ?? ""));
  const badInput = entries.some((value) => value === undefined);
  const customSplit = total != null && !badInput ? splitCustom(total, entries as (number | null)[]) : null;
  // Leere Felder zeigen als Platzhalter, was sie bekommen würden.
  const placeholders = new Map<string, string>();
  if (customSplit && customSplit.fill.length > 0) {
    let next = 0;
    selected.forEach((id, index) => {
      if (entries[index] == null) placeholders.set(id, centsToInput(customSplit.fill[next++] ?? 0));
    });
  }
  const customStatus: { text: string; tone: "muted" | "lime" | "amber" } = (() => {
    if (badInput) return { text: tx.invalidShareInput, tone: "amber" };
    if (total == null || customSplit == null) return { text: tx.customNeedsTotal, tone: "muted" };
    const { status, rest, entered, fill } = customSplit;
    if (status === "zero") return { text: tx.customZero, tone: "amber" };
    if (status === "over") return { text: tx.customOver(formatEuro(-rest), formatEuro(entered), formatEuro(total)), tone: "amber" };
    if (status === "open") return { text: tx.customOpen(formatEuro(rest)), tone: "amber" };
    if (status === "nothing_left") return { text: tx.customNothingLeft, tone: "amber" };
    if (fill.length === 0) return { text: tx.customOk(formatEuro(total)), tone: "lime" };
    const min = fill[fill.length - 1] ?? 0;
    const max = fill[0] ?? 0;
    return { text: min === max ? tx.customFill(formatEuro(max), fill.length) : tx.customFillRange(formatEuro(min), formatEuro(max), fill.length), tone: "muted" };
  })();

  function toggle(id: string) {
    setSplit((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = description.trim().replace(/\s+/g, " ");
    if (text.length < 2) return setError(tx.invalidDescription);
    if (typeof cents !== "number" || cents < 1 || cents > 1_000_000) return setError(tx.invalidAmount);
    if (split.size === 0) return setError(tx.invalidSplit);
    if (custom) {
      if (customSplit?.status !== "ok" || !customSplit.shares) return setError(customStatus.text);
      setError(null);
      return onSubmit({ description: text, amountCents: cents, paidBy, splitWith: selected, shares: customSplit.shares }, setError);
    }
    setError(null);
    onSubmit({ description: text, amountCents: cents, paidBy, splitWith: selected }, setError);
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <TextField label={tx.description} name="expense_description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={tx.descriptionPlaceholder} maxLength={80} required autoComplete="off" />
      <div className="grid grid-cols-2 gap-3">
        <TextField label={tx.amount} name="expense_amount" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={tx.amountPlaceholder} inputMode="decimal" required autoComplete="off" />
        <SelectField label={tx.paidBy} name="expense_paid_by" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
          {members.map((id) => (
            <option key={id} value={id}>
              {id === userId ? tx.me : name(id)}
            </option>
          ))}
        </SelectField>
      </div>
      <div role="group" aria-labelledby={`${groupId}-label`} aria-describedby={custom ? undefined : `${groupId}-hint`} className="space-y-1.5">
        <p id={`${groupId}-label`} className="text-sm font-medium text-fg">
          {tx.splitWith}
        </p>
        <div className="flex flex-wrap gap-2">
          {members.map((id) => (
            <Chip key={id} selected={split.has(id)} onToggle={() => toggle(id)}>
              {name(id)}
            </Chip>
          ))}
        </div>
        {!custom && (
          <p id={`${groupId}-hint`} aria-live="polite" className="text-[13px] leading-snug text-muted">
            {preview ?? tx.splitHint}
          </p>
        )}
      </div>
      <div className="border-t border-line">
        <SwitchRow label={tx.customToggle} description={tx.customToggleHint} checked={custom} onChange={setCustom} />
      </div>
      {custom && selected.length > 0 && (
        // Ein Feld je ausgewählter Person; die Summenzeile darunter sagt sofort, ob es aufgeht.
        <div className="space-y-2">
          <ul className="divide-y divide-line rounded-card border border-line bg-surface">
            {selected.map((id) => {
              const inputId = `${groupId}-share-${id}`;
              return (
                <li key={id} className="flex items-center gap-3 py-1.5 pr-1.5 pl-4">
                  <label htmlFor={inputId} className="min-w-0 flex-1 truncate text-[15px] font-medium text-fg">
                    <span className="sr-only">{tx.shareFor(id === userId ? tx.youAccusative : name(id))}</span>
                    <span aria-hidden>{id === userId ? tx.me : name(id)}</span>
                  </label>
                  <div className="relative w-32 shrink-0">
                    <input
                      id={inputId}
                      name={`expense_share_${id}`}
                      value={amounts[id] ?? ""}
                      onChange={(e) => {
                        setAmounts((previous) => ({ ...previous, [id]: e.target.value }));
                        setError(null);
                      }}
                      placeholder={placeholders.get(id) ?? "0,00"}
                      inputMode="decimal"
                      autoComplete="off"
                      aria-describedby={`${groupId}-status`}
                      aria-invalid={parseEuroInput(amounts[id] ?? "") === undefined}
                      className={cn(controlClass, "h-11 pr-8 text-right tabular-nums")}
                    />
                    <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted">
                      €
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
          <p
            id={`${groupId}-status`}
            aria-live="polite"
            className={cn("text-[13px] leading-snug font-medium", customStatus.tone === "lime" ? "text-lime" : customStatus.tone === "amber" ? "text-amber" : "text-muted")}
          >
            {customStatus.text}
          </p>
        </div>
      )}
      {error && <FormMessage>{error}</FormMessage>}
      <Button type="submit" block loading={pending}>
        {tx.submit}
      </Button>
    </form>
  );
}
