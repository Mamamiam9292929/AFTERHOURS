import { IconClock } from "@/components/icons";
import { loadTexts, t } from "@/i18n";
import { answerByOptions } from "@/lib/answerby";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/time";

// Texte der Antwortfrist liegen bei den Karten der Planseite (F10). Der Router lädt sie mit „Plan erstellen“ und
// der Abstimmung; hier zur Sicherheit, falls das Formular zuerst da ist.
await loadTexts("planCards");

/**
 * P47 · Antwortfrist gleich beim Erstellen: dieselben Pillen wie unter „Organisieren“ (Keine, 1/2/3 Tage, 1 Woche
 * vorher; nur, was zum eingetragenen Beginn noch passt). Gespeichert wird erst mit dem Plan. Passt die gewählte
 * Frist nach einer Änderung von Tag oder Uhrzeit nicht mehr, steht wieder „Keine“ da – ehrlich statt still falsch.
 */
export function AnswerByPicker({ startsAt, days, onChange, now = new Date() }: { startsAt: Date | null; days: number | null; onChange: (days: number | null) => void; now?: Date }) {
  const texts = t.planCards.answerBy;
  const future = startsAt && startsAt.getTime() > now.getTime() ? startsAt : null;
  const options = future ? answerByOptions(future.toISOString(), now) : [];
  const selected = options.some((o) => o.days === days) ? days : null;
  const chosen = selected == null ? null : options.find((o) => o.days === selected)?.at ?? null;

  const chip = "inline-flex h-10 items-center justify-center rounded-full border px-4 text-[14px] font-semibold transition-colors";
  const tone = (on: boolean) => (on ? "border-lime bg-lime text-lime-ink" : "border-line-strong text-fg hover:border-white/25");
  return (
    <div role="group" aria-labelledby="answer-by-form-label" className="space-y-2" data-testid="plan-form-answer-by">
      <p id="answer-by-form-label" className="flex items-center gap-2 text-sm font-semibold text-fg">
        <IconClock className="size-4 text-muted" aria-hidden />
        {texts.form.title}
      </p>
      <p className="text-[13px] leading-snug text-muted">{texts.form.hint}</p>
      {!future ? (
        <p className="text-[13px] leading-snug text-faint" data-testid="plan-form-answer-by-empty">{texts.form.needStart}</p>
      ) : options.length === 0 ? (
        <p className="text-[13px] leading-snug text-faint" data-testid="plan-form-answer-by-empty">{texts.card.tooLate}</p>
      ) : (
        <div role="radiogroup" aria-label={texts.card.label} className="flex flex-wrap gap-2">
          <button type="button" role="radio" aria-checked={selected == null} aria-label={texts.card.noneLabel} onClick={() => onChange(null)} className={cn(chip, tone(selected == null))}>
            {texts.card.none}
          </button>
          {options.map((option) => {
            const on = selected === option.days;
            const label = texts.card.option(option.days);
            return (
              <button
                key={option.days}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={texts.card.optionLabel(label, formatDateTime(option.at))}
                onClick={() => onChange(option.days)}
                className={cn(chip, tone(on))}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
      {chosen && (
        <p className="text-[13px] font-semibold leading-snug text-lime" data-testid="plan-form-answer-by-chosen">
          {texts.form.chosen(formatDateTime(chosen))}
        </p>
      )}
    </div>
  );
}
