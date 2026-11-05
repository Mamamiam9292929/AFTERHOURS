import { useState } from "react";
import { IconChat, IconClose, IconEdit, IconPlus } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { t } from "@/i18n";
import type { AttendanceStatus } from "@/lib/types";
import { useSetPlanAnswerNote } from "./api";

type Answer = Exclude<AttendanceStatus, "invited">;
/** Speichert den Zusatz (null = entfernen) und liefert den gespeicherten Stand. */
type SaveNote = (note: string | null, callbacks: { onSuccess: (saved: string | null) => void; onError: (error: unknown) => void }) => void;

const MAX = 60;

/**
 * P24 · Zusatz zur eigenen Antwort („Bin dabei – komme später“). Sitzt unten in der Antwortkarte der
 * Planseite, nur mit Antwort und solange der Plan offen ist. Vorschläge passend zur Antwort speichern mit
 * einem Tipp; eigener Text bis 60 Zeichen. Die Crew sieht den Zusatz bei „Wer kommt mit?“.
 * Ändert sich die Antwort, löscht der Server den Zusatz (Trigger) – hier reicht es, den Stand anzuzeigen.
 */
export function AnswerNote({ planId, answer, note }: { planId: string; answer: Answer; note: string | null }) {
  const save = useSetPlanAnswerNote(planId);
  return <NoteEditor answer={answer} note={note} pending={save.isPending} save={(value, callbacks) => save.mutate(value, callbacks)} />;
}

/**
 * P24 Etappe 2: dieselbe Bedienung für Gäste ohne Konto unter dem Teilen-Link (W10) – dort speichert
 * `guest_note_shared_plan` mit dem Geheimnis des Geräts.
 */
export function NoteEditor({ answer, note, pending, save }: { answer: Answer; note: string | null; pending: boolean; save: SaveNote }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const texts = t.plans.detail.attendance.note;

  function store(value: string | null) {
    save(value, {
      onSuccess: (saved) => {
        setEditing(false);
        toast.success(saved ? texts.saved : texts.removed);
      },
      onError: (error) => toast.error(error),
    });
  }

  function submit() {
    store(draft.trim() || null);
  }

  if (editing) {
    return (
      // Kein eigenes <form>: Unter dem Teilen-Link sitzt der Zusatz in der Antwortkarte, die schon ein Formular ist.
      <div className="mt-4 space-y-3 border-t border-line pt-4" data-testid="answer-note-form">
        <div className="flex flex-wrap gap-2" role="group" aria-label={texts.label}>
          {texts.presets[answer].map((preset) => (
            <button
              key={preset}
              type="button"
              disabled={pending}
              onClick={() => store(preset)}
              className="inline-flex min-h-9 items-center rounded-full border border-line-strong px-3.5 text-[13px] font-semibold text-fg transition-colors hover:bg-surface disabled:opacity-50"
            >
              {preset}
            </button>
          ))}
        </div>
        <TextField
          label={texts.label}
          hint={texts.hint}
          value={draft}
          maxLength={MAX}
          placeholder={texts.placeholder}
          autoComplete="off"
          enterKeyHint="done"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (draft.trim() || note) submit();
            }
          }}
          data-testid="answer-note-input"
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" loading={pending} onClick={submit} disabled={!draft.trim() && !note}>
            {texts.save}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            {texts.cancel}
          </Button>
        </div>
      </div>
    );
  }

  if (note) {
    return (
      <div className="mt-3 flex items-center gap-2 border-t border-line pt-3" data-testid="answer-note">
        <IconChat className="size-4 shrink-0 text-muted" aria-hidden />
        <p className="min-w-0 flex-1 text-sm font-semibold break-words text-fg">
          <span className="sr-only">{texts.mine(note)}</span>
          <span aria-hidden>{texts.quoted(note)}</span>
        </p>
        <button
          type="button"
          aria-label={texts.edit}
          title={texts.edit}
          onClick={() => {
            setDraft(note);
            setEditing(true);
          }}
          className="grid size-10 shrink-0 place-items-center rounded-full text-fg hover:bg-surface"
        >
          <IconEdit className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={texts.remove}
          title={texts.remove}
          disabled={pending}
          onClick={() => store(null)}
          className="grid size-10 shrink-0 place-items-center rounded-full text-fg hover:bg-surface disabled:opacity-50"
        >
          <IconClose className="size-4" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft("");
        setEditing(true);
      }}
      data-testid="answer-note-add"
      className="mt-3 flex min-h-10 w-fit items-center gap-1.5 text-sm font-semibold text-fg underline decoration-line-strong underline-offset-4 hover:decoration-lime"
    >
      <IconPlus className="size-4" aria-hidden />
      {texts.add}
    </button>
  );
}
