import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { FormMessage, TextField } from "@/components/ui/Field";
import { CREW_EMOJIS } from "@/data/options";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";

interface CrewFormProps {
  initial?: { name: string; emoji: string };
  submitLabel: string;
  pending: boolean;
  error?: string | null;
  onSubmit: (values: { name: string; emoji: string }) => void;
}

/** Name und Symbol einer Crew – für Anlegen und Bearbeiten. */
export function CrewForm({ initial, submitLabel, pending, error, onSubmit }: CrewFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [emoji, setEmoji] = useState(initial?.emoji ?? CREW_EMOJIS[0] ?? "🌙");
  const [nameError, setNameError] = useState<string | null>(null);
  const emojis = initial && !CREW_EMOJIS.includes(initial.emoji) ? [initial.emoji, ...CREW_EMOJIS] : CREW_EMOJIS;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim().length < 2) {
      setNameError(t.errors.codes.invalid_name);
      return;
    }
    setNameError(null);
    onSubmit({ name: name.trim(), emoji });
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <TextField label={t.crews.name} name="crew_name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.crews.namePlaceholder} maxLength={40} error={nameError} required autoComplete="off" />
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-fg">{t.crews.emoji}</legend>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-1.5" role="radiogroup" aria-label={t.crews.emoji}>
          {emojis.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={emoji === option}
              aria-label={option}
              onClick={() => setEmoji(option)}
              className={cn("flex aspect-square items-center justify-center rounded-control border text-xl transition-colors", emoji === option ? "border-lime bg-lime/15" : "border-line hover:border-line-strong")}
            >
              <span aria-hidden>{option}</span>
            </button>
          ))}
        </div>
      </fieldset>
      {error && <FormMessage>{error}</FormMessage>}
      <Button type="submit" size="lg" block loading={pending}>
        {submitLabel}
      </Button>
    </form>
  );
}
