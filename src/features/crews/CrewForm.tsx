import { useState, type FormEvent } from "react";
import { IconCrews, IconSparkles } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { FormMessage, TextField } from "@/components/ui/Field";
import { FormCard } from "@/components/ui/FormCard";
import { CREW_EMOJIS } from "@/data/options";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { crewWorld } from "@/lib/crewWorld";

interface CrewFormProps {
  initial?: { name: string; emoji: string };
  /** Beim Bearbeiten: die Crew, damit die Vorschau in ihrer Farbwelt leuchtet. Neue Crews haben noch keine. */
  crewId?: string;
  submitLabel: string;
  pending: boolean;
  error?: string | null;
  onSubmit: (values: { name: string; emoji: string }) => void;
  /** Im Dialog: Abschnitte ohne eigene Karte. */
  flat?: boolean;
}

/**
 * Name und Symbol einer Crew – für Anlegen und Bearbeiten. Seit V2 Etappe 3m oben eine Vorschau der
 * Crew-Zeile (Symbol auf der Kachel, Name in der Display-Schrift), die beim Tippen mitwächst; die Symbole
 * sind runde Glas-Kacheln, das gewählte leuchtet in Lime.
 */
export function CrewForm({ initial, crewId, submitLabel, pending, error, onSubmit, flat = false }: CrewFormProps) {
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
    <form onSubmit={submit} noValidate className={flat ? "space-y-5" : "space-y-4"}>
      <CrewPreview name={name.trim()} emoji={emoji} crewId={crewId} />
      <FormCard title={t.crews.form.nameSection} icon={<IconCrews className="size-[18px]" />} tone="pink" flat={flat}>
        <TextField label={t.crews.name} name="crew_name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.crews.namePlaceholder} maxLength={40} error={nameError} required autoComplete="off" />
      </FormCard>
      <FormCard title={t.crews.emoji} icon={<IconSparkles className="size-[18px]" />} tone="lime" flat={flat}>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(48px,1fr))] gap-2" role="radiogroup" aria-label={t.crews.emoji}>
          {emojis.map((option) => {
            const on = emoji === option;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={option}
                onClick={() => setEmoji(option)}
                className={cn(
                  "flex aspect-square items-center justify-center rounded-full border text-[22px] transition-[transform,background-color,border-color] motion-safe:active:scale-90",
                  on ? "border-lime bg-lime/20 shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-lime)_25%,transparent)]" : "border-white/10 bg-white/[0.04] hover:border-white/25",
                )}
              >
                <span aria-hidden>{option}</span>
              </button>
            );
          })}
        </div>
      </FormCard>
      {error && <FormMessage>{error}</FormMessage>}
      <Button type="submit" size="lg" block loading={pending}>
        {submitLabel}
      </Button>
    </form>
  );
}

/**
 * So sieht die Crew gleich in der Liste aus. Eine neue Crew bekommt ihre Farbwelt erst mit ihrer ID
 * (src/lib/crewWorld.ts) – bis dahin bleibt die Vorschau neutrales Glas, statt eine Farbe zu versprechen.
 */
function CrewPreview({ name, emoji, crewId }: { name: string; emoji: string; crewId?: string }) {
  return (
    <div
      aria-hidden
      data-testid="crew-form-preview"
      data-world={crewId ? crewWorld(crewId) : undefined}
      className={cn("flex items-center gap-3.5 rounded-[28px] border border-white/[0.08] p-3", crewId ? "crew-world" : "deck-card")}
    >
      <span className={cn("grid size-14 shrink-0 place-items-center rounded-[18px] text-[28px]", crewId ? "crew-world-tile" : "border border-white/15 bg-white/[0.06]")}>{emoji}</span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-muted">{t.crews.form.preview}</span>
        <span className={cn("display block truncate text-[19px]", name ? "text-fg" : "text-muted")}>{name || t.crews.namePlaceholder.replace(/^z\. B\. /, "")}</span>
      </span>
    </div>
  );
}
