import { Dialog as HeadlessDialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { IconCalendarPlus, IconClose, IconSparkles, IconSpinner, IconTimer, IconVote } from "@/components/icons";
import { Avatar, type Person } from "@/components/ui/Avatar";
import { Button, ButtonLink, IconButton } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { myRole, type CrewWithMembers } from "@/features/crews/api";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { qk } from "@/lib/query";
import { useRealtime } from "@/lib/realtime";
import { crewsFreeToAsk, formatLeft, minutesLeft, summarizeAsk, type SpontaneousAnswerValue, type SpontaneousAsk } from "@/lib/spontaneous";
import { supabase } from "@/lib/supabase";

const tx = t.home.spontaneous;
const CREW_KEY = "afterhours.spontaneous.crew";

/** Laufende Fragen aller eigenen Crews (RLS: nur Mitglieder sehen sie). Abgelaufenes filtert der Server. */
export function useSpontaneousAsks(enabled: boolean) {
  const client = useQueryClient();
  useRealtime(enabled ? "spontaneous" : null, [{ table: "spontaneous_asks" }, { table: "spontaneous_answers" }], () => void client.invalidateQueries({ queryKey: qk.spontaneous }));
  return useQuery({
    queryKey: qk.spontaneous,
    enabled,
    // Ablauf nach 2 Stunden: auch ohne Realtime verschwindet die Frage spätestens nach einer Minute.
    refetchInterval: 60_000,
    queryFn: async (): Promise<SpontaneousAsk[]> => {
      const { data, error } = await supabase
        .from("spontaneous_asks")
        .select("*, answers:spontaneous_answers(ask_id, user_id, answer, answered_at)")
        .is("closed_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SpontaneousAsk[];
    },
  });
}

function rememberedCrew(): string | null {
  try {
    return localStorage.getItem(CREW_KEY);
  } catch {
    return null;
  }
}

/**
 * S4 · Knopf „Heute noch wer?“ neben „Was geht?“. Öffnet ein kleines Sheet: optional ein Stichwort,
 * bei mehreren Crews die Crew – dann bekommt die Crew Bescheid. Crews mit laufender Frage fallen weg.
 */
export function SpontaneousLauncher({ crews, asks, now }: { crews: CrewWithMembers[]; asks: SpontaneousAsk[]; now: Date }) {
  const [open, setOpen] = useState(false);
  const free = crewsFreeToAsk(crews, asks, now);
  if (free.length === 0) return null;
  return (
    <>
      <Button variant="secondary" size="sm" icon={<IconSparkles className="size-4" aria-hidden />} onClick={() => setOpen(true)} aria-haspopup="dialog" data-testid="spontaneous-launcher">
        {tx.launcher}
      </Button>
      {open && <SpontaneousSheet crews={free} onClose={() => setOpen(false)} />}
    </>
  );
}

function SpontaneousSheet({ crews, onClose }: { crews: CrewWithMembers[]; onClose: () => void }) {
  const [note, setNote] = useState("");
  const [crewId, setCrewId] = useState<string | null>(() => {
    const saved = rememberedCrew();
    return crews.some((c) => c.id === saved) ? saved : (crews[0]?.id ?? null);
  });
  const noteId = useId();
  const toast = useToast();
  const client = useQueryClient();
  const crew = crews.find((c) => c.id === crewId) ?? crews[0] ?? null;

  const ask = useMutation({
    mutationFn: async () => {
      if (!crew) throw new Error("no_crew");
      const { error } = await supabase.rpc("ask_spontaneous", { p_crew_id: crew.id, p_note: note.trim() || null });
      if (error) throw error;
    },
    onSuccess: () => {
      try {
        localStorage.setItem(CREW_KEY, crew?.id ?? "");
      } catch {
        // nur Komfort
      }
      void client.invalidateQueries({ queryKey: qk.spontaneous });
      toast.success(tx.sent);
      onClose();
    },
    onError: (error) => {
      void client.invalidateQueries({ queryKey: qk.spontaneous });
      toast.error(error);
    },
  });

  return (
    <HeadlessDialog open onClose={() => !ask.isPending && onClose()} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="fixed inset-0 flex items-end justify-center sm:items-center sm:p-6">
        <DialogPanel className="glass flex max-h-[92dvh] w-full flex-col overflow-y-auto rounded-t-[36px] border border-white/10 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-6 shadow-2xl shadow-black/70 sm:max-w-lg sm:rounded-[36px] sm:px-7">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="display text-[22px] text-fg">{tx.sheetTitle}</DialogTitle>
            <IconButton label={t.actions.close} onClick={onClose} className="-mr-1">
              <IconClose className="size-5" aria-hidden />
            </IconButton>
          </div>
          <p className="mt-2 text-sm text-muted">{tx.sheetBody}</p>
          <form
            className="mt-5 flex flex-col gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (crew && !ask.isPending) ask.mutate();
            }}
          >
            <div className="flex flex-col gap-2">
              <label htmlFor={noteId} className="text-[13px] font-semibold text-muted">
                {tx.noteLabel}
              </label>
              <input
                id={noteId}
                data-autofocus
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={tx.notePlaceholder}
                maxLength={80}
                autoComplete="off"
                enterKeyHint="send"
                className="h-14 rounded-[20px] border-[1.5px] border-white/15 bg-white/[0.06] px-5 text-[17px] font-semibold text-fg placeholder:font-normal placeholder:text-faint focus:border-lime focus:outline-none focus-visible:ring-2 focus-visible:ring-lime/40"
              />
            </div>
            {crews.length > 1 && (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-[13px] font-semibold text-muted">{tx.crew}</legend>
                <div className="scroll-row">
                  {crews.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={c.id === crew?.id}
                      onClick={() => setCrewId(c.id)}
                      className={cn("h-10 shrink-0 rounded-full border px-4 text-sm font-semibold", c.id === crew?.id ? "border-lime bg-lime text-lime-ink" : "border-white/15 text-muted hover:text-fg")}
                    >
                      {c.emoji} {c.name}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
            <Button type="submit" size="lg" disabled={!crew} loading={ask.isPending} className="h-15 font-display text-[16px] font-black uppercase">
              {ask.isPending ? tx.submitting : tx.submit}
            </Button>
          </form>
        </DialogPanel>
      </div>
    </HeadlessDialog>
  );
}

const ANSWERS: { value: SpontaneousAnswerValue; label: string }[] = [
  { value: "in", label: tx.in },
  { value: "out", label: tx.out },
];

/**
 * Die Frage als Karte im neuen Stil: dunkles Glas ohne Antwort, ganz in Lime bei „Bock“, rot bei
 * „heute nicht“ (wie die Plan-Karten). Darunter, wer Bock hat, die Restzeit und – ab drei Zusagen –
 * „Ihr seid eine Runde“ mit dem Weg zum Plan bzw. zur Abstimmung.
 */
export function SpontaneousCard({
  ask,
  crew,
  userId,
  lookup,
  now,
}: {
  ask: SpontaneousAsk;
  crew: CrewWithMembers | undefined;
  userId: string;
  lookup: (id: string | null | undefined) => Person | null;
  now: Date;
}) {
  const toast = useToast();
  const client = useQueryClient();
  const [chosen, setChosen] = useState<SpontaneousAnswerValue | null>(null);
  const summary = summarizeAsk(ask, userId, crew?.members.map((m) => m.user_id));
  const mine = chosen ?? summary.mine;
  const left = formatLeft(minutesLeft(ask, now));
  const crewName = crew ? `${crew.emoji ?? ""} ${crew.name}`.trim() : "";
  const role = myRole(crew, userId);
  const canClose = ask.created_by === userId || role === "owner" || role === "admin";
  const asker = lookup(ask.created_by);

  const answer = useMutation({
    mutationFn: async (value: SpontaneousAnswerValue) => {
      const { error } = await supabase.rpc("answer_spontaneous", { p_ask_id: ask.id, p_answer: value });
      if (error) throw error;
      return value;
    },
    onMutate: (value) => setChosen(value),
    onSuccess: (value) => {
      toast.success(value === "in" ? tx.savedIn : tx.savedOut);
      void client.invalidateQueries({ queryKey: qk.spontaneous }).then(() => setChosen(null));
    },
    onError: (error) => {
      setChosen(null);
      toast.error(error);
      void client.invalidateQueries({ queryKey: qk.spontaneous });
    },
  });

  const close = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("close_spontaneous", { p_ask_id: ask.id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(tx.closed);
      void client.invalidateQueries({ queryKey: qk.spontaneous });
    },
    onError: (error) => toast.error(error),
  });

  const people = summary.inIds.map((id) => lookup(id));

  return (
    <article className="ask-card" data-answer={mine ?? undefined} data-testid="spontaneous-card" aria-labelledby={`ask-${ask.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-muted">{ask.created_by === userId ? tx.askedByMe(crewName) : tx.asked(asker?.display_name ?? t.states.formerMember, crewName)}</p>
          <h3 id={`ask-${ask.id}`} className="display mt-1 text-[24px] leading-tight text-fg sm:text-[28px]">
            {tx.title}
          </h3>
          {ask.note && <p className="mt-1 break-words text-[17px] font-semibold text-fg">{ask.note}</p>}
        </div>
        <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-raised px-3 text-[13px] font-semibold text-fg" title={tx.leftLabel(left)}>
          <IconTimer className="size-4" aria-hidden />
          <span aria-hidden>{tx.left(left)}</span>
          <span className="sr-only">{tx.leftLabel(left)}</span>
        </span>
      </div>

      <div className="mt-4 flex items-center gap-3">
        {people.length > 0 && (
          <span className="flex -space-x-2" aria-hidden>
            {people.slice(0, 6).map((person, i) => (
              <Avatar key={summary.inIds[i]} person={person} size="sm" decorative className="ring-2 ring-[var(--ask-ring)]" />
            ))}
          </span>
        )}
        <p className="min-w-0 text-sm font-semibold text-fg" data-testid="spontaneous-count">
          {tx.count(summary.inIds.length)}
          {summary.outIds.length > 0 && <span className="font-medium text-muted"> · {tx.outCount(summary.outIds.length)}</span>}
        </p>
      </div>
      {summary.inIds.length > 0 && <p className="sr-only">{summary.inIds.map((id) => lookup(id)?.display_name ?? t.states.formerMember).join(", ")}</p>}

      <p className="mt-2 text-[13px] font-medium text-muted" aria-live="polite">
        {summary.matched ? tx.matched : tx.missing(summary.missing)}
      </p>

      <div role="group" aria-label={tx.answerGroup(crewName)} className="mt-4 grid grid-cols-2 gap-2">
        {ANSWERS.map(({ value, label }) => {
          const busy = answer.isPending && answer.variables === value;
          const active = mine === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              disabled={answer.isPending}
              aria-busy={busy || undefined}
              onClick={() => answer.mutate(value)}
              className={cn(
                "inline-flex h-12 items-center justify-center gap-1.5 rounded-full border text-[15px] font-bold transition-[background-color,border-color,color,transform] duration-200 active:scale-[0.96] disabled:opacity-60",
                active ? "ask-answer-active" : value === "in" ? "border-lime text-lime hover:bg-lime/10" : "border-line-strong text-fg hover:border-danger hover:text-danger",
              )}
            >
              {busy && <IconSpinner className="size-4 animate-spin" aria-hidden />}
              {label}
            </button>
          );
        })}
      </div>

      {(summary.matched || canClose) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {summary.matched && crew && (
            <>
              <ButtonLink to={`/plans/new?crew=${crew.id}`} size="sm" variant="secondary" icon={<IconCalendarPlus className="size-4" aria-hidden />}>
                {tx.matchedAction}
              </ButtonLink>
              <ButtonLink to={`/polls/new?crew=${crew.id}`} size="sm" variant="secondary" icon={<IconVote className="size-4" aria-hidden />}>
                {tx.pollAction}
              </ButtonLink>
            </>
          )}
          {canClose && (
            <Button size="sm" variant="ghost" loading={close.isPending} onClick={() => close.mutate()} className="ml-auto">
              {tx.close}
            </Button>
          )}
        </div>
      )}
    </article>
  );
}
