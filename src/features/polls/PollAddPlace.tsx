import { IconClose, IconPin, IconSearch } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { DemoBadge } from "@/components/ui/Feedback";
import { TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { useActivity } from "@/features/discover/api";
import { priceLabel } from "@/features/discover/display";
import { t } from "@/i18n";
import { canSuggestPlace, cleanPlaceTitle, placeProblem, placesFull } from "@/lib/pollplace";
import { categoryWorld } from "@/lib/stage";
import { formatPlainDate, formatPlainTime } from "@/lib/time";
import type { Activity } from "@/lib/types";
import { useState, type FormEvent } from "react";
import { ActivityPicker } from "./ActivityPicker";
import { useAddPollPlace } from "./api";
import type { PollWithDetails } from "./logic";

/** Termin, den alle Vorschläge teilen (S1 „… fr 20 uhr“, „Und wo?“) – den bekommt der neue Ort auf dem Server auch. */
function sharedWhen(poll: PollWithDetails): string | null {
  const [first, ...rest] = poll.options;
  if (!first?.proposed_date) return null;
  const same = rest.every((o) => o.proposed_date === first.proposed_date && (o.proposed_time ?? "").slice(0, 5) === (first.proposed_time ?? "").slice(0, 5));
  if (!same) return null;
  const day = formatPlainDate(first.proposed_date, "long");
  return first.proposed_time ? `${day}, ${formatPlainTime(first.proposed_time)}` : day;
}

/**
 * P40 Etappe 2 · „Und das Kino?“ – unter den Vorschlägen einer laufenden Orts-Abstimmung schlägt jedes Mitglied
 * einen weiteren Ort vor: aus Discover (gleiche Suche wie beim Anlegen) oder als eigenen Vorschlag. Geprüft wird
 * wie in `add_poll_place`, damit der Fehler am Feld steht, bevor der Server gefragt wird.
 */
export function PollAddPlace({ poll, now }: { poll: PollWithDetails; now: Date }) {
  const toast = useToast();
  const add = useAddPollPlace();
  const tx = t.pollSlot.place;
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [picked, setPicked] = useState<Activity | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Die Suche beginnt in der Stadt des ersten Orts der Abstimmung (sonst in der aus dem Profil).
  const seed = useActivity(open ? poll.options.find((o) => o.activity_id)?.activity_id : null);
  if (!canSuggestPlace(poll, now)) return null;
  if (placesFull(poll)) return <p className="mt-4 text-[13px] leading-snug text-faint">{tx.full}</p>;

  const when = sharedWhen(poll);

  function reset() {
    setOpen(false);
    setPicked(null);
    setTitle("");
    setError(null);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const input = { activityId: picked?.id ?? null, title: picked ? picked.name : title };
    const problem = placeProblem(poll, input);
    if (problem) {
      setError(tx.problems[problem]);
      return;
    }
    setError(null);
    const label = cleanPlaceTitle(input.title);
    add.mutate(
      { pollId: poll.id, activityId: input.activityId, title: picked ? null : label },
      {
        onSuccess: () => {
          toast.success(tx.done(label));
          reset();
        },
        onError: (err) => toast.error(err),
      },
    );
  }

  if (!open) {
    return (
      <div className="mt-4">
        <Button variant="secondary" size="sm" data-testid="poll-add-place" onClick={() => setOpen(true)} icon={<IconPin className="size-4" aria-hidden />}>
          {tx.open}
        </Button>
      </div>
    );
  }

  return (
    <>
      <form className="mt-4 rounded-card border border-line bg-surface p-4" data-testid="poll-add-place-form" onSubmit={submit} noValidate>
        <h3 className="text-[15px] font-semibold text-fg">{tx.title}</h3>
        <p className="mt-1 text-[13px] leading-snug text-muted">{tx.lead}</p>
        {poll.auto_decide && <p className="mt-1 text-[13px] leading-snug text-muted">{tx.auto}</p>}
        {when && <p className="mt-1 text-[13px] leading-snug text-muted">{tx.sameDate(when)}</p>}

        {picked ? (
          <div className="cat-world mt-3 flex items-center gap-3 rounded-[20px] border border-white/10 p-3.5" data-world={categoryWorld(picked.category)} data-testid="poll-add-place-picked">
            <IconPin className="size-5 shrink-0 text-fg" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate font-semibold text-fg">{picked.name}</span>
                {picked.is_demo && <DemoBadge />}
              </span>
              <span className="block truncate text-[13px] text-muted">
                {t.enums.category[picked.category]}
                {picked.city ? `, ${picked.city}` : ""} – {priceLabel(picked)}
              </span>
            </span>
            <button
              type="button"
              aria-label={tx.remove}
              onClick={() => {
                setPicked(null);
                setError(null);
              }}
              className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:text-fg"
            >
              <IconClose className="size-5" aria-hidden />
            </button>
          </div>
        ) : (
          <>
            <div className="mt-3">
              <Button type="button" variant="secondary" size="sm" onClick={() => setPickerOpen(true)} icon={<IconSearch className="size-4" aria-hidden />}>
                {tx.search}
              </Button>
            </div>
            <p className="mt-3 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">{tx.or}</p>
            <div className="mt-2">
              <TextField
                label={tx.own}
                name="place-title"
                value={title}
                maxLength={120}
                placeholder={tx.ownHint}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setError(null);
                }}
                error={error ?? undefined}
              />
            </div>
          </>
        )}
        {picked && error && (
          <p className="mt-2 text-[13px] leading-snug text-danger" role="alert">
            {error}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="submit" size="sm" loading={add.isPending} icon={<IconPin className="size-4" aria-hidden />}>
            {tx.submit}
          </Button>
          {picked && (
            <Button type="button" variant="secondary" size="sm" disabled={add.isPending} onClick={() => setPickerOpen(true)} icon={<IconSearch className="size-4" aria-hidden />}>
              {tx.change}
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" disabled={add.isPending} onClick={reset}>
            {t.actions.cancel}
          </Button>
        </div>
      </form>
      {/* Genau ein Ort – antippen wählt ihn und schließt die Suche (wie der feste Ort bei „Wann könnt ihr?“). */}
      <ActivityPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        initialCity={seed.data?.city}
        selectedIds={new Set(picked ? [picked.id] : [])}
        onToggle={(activity) => {
          const off = activity.id === picked?.id;
          setPicked(off ? null : activity);
          setError(null);
          if (!off) setPickerOpen(false);
        }}
      />
    </>
  );
}
