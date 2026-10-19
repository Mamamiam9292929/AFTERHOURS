import { Dialog as HeadlessDialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router-dom";
import { IconClose, IconPlus } from "@/components/icons";
import { Button, IconButton } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { qk } from "@/lib/query";
import { parseQuickPoll } from "@/lib/quickpoll";
import { pollShare, shareOrCopy } from "@/lib/share";
import { supabase } from "@/lib/supabase";
import { formatDateTime } from "@/lib/time";
import type { Crew } from "@/lib/types";

const CREW_KEY = "afterhours.quickpoll.crew";

function rememberedCrew(): string | null {
  try {
    return localStorage.getItem(CREW_KEY);
  } catch {
    return null;
  }
}

/**
 * Morph (V2): Knopf und Sheet tragen nacheinander denselben View-Transition-Namen – der Browser lässt
 * den Lime-Knopf zum Eingabe-Sheet aufgehen und beim Schließen zurück. Ohne die API: sofort.
 */
function morph(update: () => void) {
  if (typeof document !== "undefined" && typeof document.startViewTransition === "function" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.startViewTransition(() => flushSync(update));
  } else update();
}

/**
 * S1 · Ein Satz, eine Abstimmung. Der Lime-Knopf „Was geht?“ geht zu einem Sheet auf; der Satz wird im
 * Browser zerlegt (src/lib/quickpoll.ts) und als Vorschau gezeigt. „Los“ startet die Abstimmung, schaltet
 * Gäste-Stimmen ein (S2: Freunde ohne App stimmen über den Link ab), öffnet das Teilen-Menü und führt
 * zur Abstimmung. Die Abstimmung entscheidet sich zum angezeigten Zeitpunkt wie jede andere.
 */
export function QuickPollLauncher({ crews, className }: { crews: Crew[]; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => morph(() => setOpen(true))}
        className={cn(
          "group flex h-16 w-full items-center justify-center gap-3 rounded-full bg-lime px-6 text-lime-ink shadow-[0_18px_40px_-14px_var(--color-lime)] transition-transform duration-200 hover:bg-lime-press active:scale-[0.97]",
          !open && "vt-quickpoll",
          className,
        )}
        aria-haspopup="dialog"
      >
        <IconPlus className="size-6 transition-transform duration-300 group-hover:rotate-90" aria-hidden />
        <span className="font-display text-[19px] font-black uppercase tracking-tight">{t.polls.quick.launcher}</span>
      </button>
      <QuickPollSheet open={open} onClose={() => morph(() => setOpen(false))} crews={crews} />
    </>
  );
}

function QuickPollSheet({ open, onClose, crews }: { open: boolean; onClose: () => void; crews: Crew[] }) {
  const [text, setText] = useState("");
  const [crewId, setCrewId] = useState<string | null>(() => {
    const saved = rememberedCrew();
    return crews.some((c) => c.id === saved) ? saved : (crews[0]?.id ?? null);
  });
  const inputId = useId();
  const toast = useToast();
  const navigate = useNavigate();
  const client = useQueryClient();
  const parsed = useMemo(() => parseQuickPoll(text), [text]);
  const crew = crews.find((c) => c.id === crewId) ?? crews[0] ?? null;

  const start = useMutation({
    mutationFn: async () => {
      if (!crew) throw new Error("no_crew");
      const { data, error } = await supabase.rpc("create_poll", {
        p_crew_id: crew.id,
        p_title: parsed.title,
        p_ends_at: parsed.endsAt,
        p_options: parsed.options,
        p_description: null,
        p_meeting_point: null,
        p_budget_cents: null,
        p_min_participants: null,
      });
      if (error) throw error;
      const pollId = data as string;
      // S2: Gäste dürfen mitstimmen – sonst müssten Freunde erst die App holen. Schlägt das fehl, läuft die Abstimmung trotzdem.
      await supabase.rpc("set_poll_guests", { p_poll_id: pollId, p_allowed: true });
      // S5: Bei klarer Mehrheit steht der Plan von selbst – niemand muss hinterherräumen.
      await supabase.rpc("set_poll_auto_decide", { p_poll_id: pollId, p_enabled: true });
      const token = await supabase.rpc("poll_share_token", { p_poll_id: pollId });
      return { pollId, token: (token.data as string | null) ?? null };
    },
    onSuccess: async ({ pollId, token }) => {
      try {
        localStorage.setItem(CREW_KEY, crew?.id ?? "");
      } catch {
        // nur Komfort
      }
      void client.invalidateQueries({ queryKey: qk.polls });
      const outcome = await shareOrCopy(pollShare({ id: pollId, title: parsed.title, ends_at: parsed.endsAt }, token));
      toast.success(outcome === "copied" ? t.polls.quick.copied : t.polls.quick.created);
      setText("");
      onClose();
      navigate(`/polls/${pollId}`);
    },
    onError: (error) => toast.error(error),
  });

  const ready = parsed.options.length > 0 && crew !== null;

  return (
    <HeadlessDialog open={open} onClose={() => !start.isPending && onClose()} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="fixed inset-0 flex items-end justify-center sm:items-center sm:p-6">
        <DialogPanel className="vt-quickpoll glass flex max-h-[92dvh] w-full flex-col overflow-y-auto rounded-t-[36px] border border-white/10 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-6 shadow-2xl shadow-black/70 sm:max-w-lg sm:rounded-[36px] sm:px-7">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="display text-[22px] text-fg">{t.polls.quick.title}</DialogTitle>
            <IconButton label={t.actions.close} onClick={onClose} className="-mr-1">
              <IconClose className="size-5" aria-hidden />
            </IconButton>
          </div>

          <form
            className="mt-5 flex flex-col gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (ready && !start.isPending) start.mutate();
            }}
          >
            <div className="flex flex-col gap-2">
              <label htmlFor={inputId} className="text-[13px] font-semibold text-muted">
                {t.polls.quick.label}
              </label>
              <input
                id={inputId}
                data-autofocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t.polls.quick.placeholder}
                maxLength={200}
                autoComplete="off"
                enterKeyHint="go"
                className="h-15 rounded-[20px] border-[1.5px] border-lime bg-white/[0.06] px-5 text-[17px] font-semibold text-fg placeholder:font-normal placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-lime/40"
              />
              {text.trim() === "" && (
                <div className="flex flex-wrap gap-2">
                  {t.polls.quick.examples.map((ex) => (
                    <button key={ex} type="button" onClick={() => setText(ex)} aria-label={`${t.polls.quick.exampleLabel}: ${ex}`} className="h-9 rounded-full border border-white/12 bg-white/[0.05] px-3.5 text-[13px] font-medium text-muted hover:text-fg">
                      {ex}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <section aria-live="polite" className="flex flex-col gap-2.5">
              <span className="text-[13px] font-semibold text-muted">{t.polls.quick.preview}</span>
              {parsed.options.length === 0 ? (
                <p className="text-sm text-muted">{t.polls.quick.empty}</p>
              ) : (
                <>
                  <p className="display text-[19px] text-fg">{parsed.title}</p>
                  <ul className="flex flex-wrap gap-2" aria-label={t.polls.quick.preview}>
                    {parsed.activities.map((a, i) => (
                      <li key={`a-${a}`} className={cn("rounded-full px-3.5 py-2 text-sm font-bold text-white", i % 2 ? "bg-[#c2246f]" : "bg-[#5b3fe0]")}>
                        {a}
                      </li>
                    ))}
                    {parsed.days.map((d) => (
                      <li key={`d-${d.date}`} className="rounded-full bg-white/[0.1] px-3.5 py-2 text-sm font-bold text-fg">
                        {d.label}
                      </li>
                    ))}
                    {parsed.time && <li className="rounded-full bg-white/[0.1] px-3.5 py-2 text-sm font-bold text-fg">{parsed.time}</li>}
                  </ul>
                  <p className="text-sm text-muted">
                    {t.polls.quick.options(parsed.options.length)} · {t.polls.quick.endsAt(formatDateTime(parsed.endsAt))}
                  </p>
                  <p className="text-[13px] text-faint">{t.polls.quick.guests}</p>
                  <p className="text-[13px] text-faint">{t.polls.quick.auto}</p>
                </>
              )}
            </section>

            {crews.length > 1 && (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-[13px] font-semibold text-muted">{t.polls.quick.crew}</legend>
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

            <Button type="submit" size="lg" disabled={!ready} loading={start.isPending} className="h-15 font-display text-[16px] font-black uppercase">
              {start.isPending ? t.polls.quick.submitting : t.polls.quick.submit}
            </Button>
            <button type="button" onClick={() => { onClose(); navigate("/polls/new"); }} className="-mt-2 h-10 self-center text-sm font-semibold text-muted underline-offset-4 hover:text-fg hover:underline">
              {t.polls.quick.more}
            </button>
          </form>
        </DialogPanel>
      </div>
    </HeadlessDialog>
  );
}
